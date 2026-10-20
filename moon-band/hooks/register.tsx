import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { ABOUT_LIMIT, aboutEvictionsOf, aboutKeyOf, aboutParse, aboutPromptOf } from './about'
import type { PoemAbout } from './about'
import { dynastyOf } from './dynasty'
import { lineOf, poemAt, poemsOf, POEMS, sourceParts } from './moon'
import type { Poem } from './moon'

// moon-band: the moon's phase and a line of poetry as one dim row above the
// prompt. Nothing here is load-bearing — it is decoration, and `/moon` takes it
// away for a while when a screen of prose is wanted instead.
//
// 除了装饰，现在还有两件事：
//   1. **朝代**：那一行末尾补一个「唐」「宋」这样的字。语料没有朝代字段，靠
//      ./dynasty 里那张按出现频率挑出来的作者表；表外不显示，不猜。
//   2. **详解按钮**：点一下给出这句诗的意思与创作背景。答案按**诗句**存进插件的
//      store，同一句第二次点开直接读缓存，不再问模型。
//
// It wraps what `next(e)` resolved to rather than drawing the row itself, so
// whatever else draws at this spot (the context meter, the balance meter) is
// kept underneath it.

/**
 * Twenty seconds against a one-minute slot: the line turns over within twenty
 * seconds of the minute rather than up to a minute late. A redraw is cheap and
 * the engine folds sooner ones.
 */
const REFRESH_MS = 20 * 1000
const HIDDEN_KEY = 'isHidden'
const CORPUS_PATH = 'data/poems.txt'

const isHidden = atom({ plugin: 'moon-band', key: 'isHidden' } as const, false)

/** 详解面板。只对「当前这一句」有效——换句之后 render 那边就不会画它了。 */
type Panel = { line: string; busy: boolean; about: PoemAbout | null }

const panel = atom({ plugin: 'moon-band', key: 'panel' } as const, null as Panel | null)

/** Runs `work`, and answers null when it throws. */
const quietly = async <T,>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work()
  } catch {
    return null
  }
}

let corpus: Poem[] | null = null

/**
 * The corpus the mod ships, read once. It is the whole point of the thing, so a
 * read that fails — or comes back with less than the built-ins would have given —
 * says so out loud and falls back: a quietly smaller corpus would look exactly
 * like a working one.
 */
const loadCorpus = async ($: EngineInterface): Promise<Poem[]> => {
  if (corpus !== null) return corpus

  const text = await quietly(() => $.fs.read(`${$.plugin.root}/${CORPUS_PATH}`))
  const read = text === null ? [] : poemsOf(text)

  if (read.length > POEMS.length) {
    corpus = read

    return corpus
  }

  try {
    $.ui.toast(`moon-band: ${CORPUS_PATH} 没读到，先用内置 8 句`)
  } catch {
    // the toast is a courtesy; the fallback still holds
  }

  return POEMS
}

/** 这一句已经问过模型了吗。 */
const cachedAboutOf = async ($: EngineInterface, line: string): Promise<PoemAbout | null> => {
  const raw = await quietly(() => $.store.get(aboutKeyOf(line)))

  if (raw === null || typeof raw !== 'object') return null

  const about = raw as PoemAbout

  return typeof about.meaning === 'string' && typeof about.background === 'string' ? about : null
}

/**
 * 记进缓存，并把超出上限的旧条目清掉。
 *
 * store 一共 4 MiB、一条详解约 300 字节，留 300 条既够用又离上限很远。
 * `keys()` 是插入顺序，所以最早的先走。
 */
const remember = async ($: EngineInterface, line: string, about: PoemAbout): Promise<void> => {
  await quietly(() => $.store.set(aboutKeyOf(line), about))

  const keys = (await quietly(() => $.store.keys())) ?? []

  for (const key of aboutEvictionsOf(keys, ABOUT_LIMIT)) {
    await quietly(() => $.store.delete(key))
  }
}

/** 让那一行重画一次。 */
const redraw = ($: EngineInterface): void => {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // the next redraw takes it
  }
}

/**
 * 按钮按下：已展开就收起；缓存里有就直接显示；都没有才问一次模型。
 *
 * 全程只改 `panel` 这个 atom —— 画不画、画什么由 render 那边看着 `panel` 和
 * 「当前是哪一句」决定，所以换句之后旧面板不会赖着不走。
 */
const explain = async ($: EngineInterface): Promise<void> => {
  const lines = await loadCorpus($)
  const nowMs = (await quietly(() => $.clock.now())) ?? Date.now()
  const poem = poemAt(nowMs, lines)
  const current = await read($, panel)

  // 同一句已经展开着 → 收起
  if (current !== null && current.line === poem.line && current.about !== null) {
    await update($, panel, () => null)
    redraw($)

    return
  }

  const cached = await cachedAboutOf($, poem.line)

  if (cached !== null) {
    await update($, panel, () => ({ line: poem.line, busy: false, about: cached }))
    redraw($)

    return
  }

  await update($, panel, () => ({ line: poem.line, busy: true, about: null }))
  redraw($)

  try {
    const { system, prompt } = aboutPromptOf(poem.line, poem.from)
    // `haiku` 是引擎的小号模型别名，解析成本会话配置的那个（这里是 DeepSeek-flash）
    // ——不用自己碰 key，也不用管 base URL。
    const reply = await $.model.complete({ model: 'haiku', prompt, system, maxTokens: 700 })
    const about = aboutParse(reply, Date.now())

    if (about === null) throw new Error('模型没有给出可用的解读')

    await remember($, poem.line, about)
    await update($, panel, () => ({ line: poem.line, busy: false, about }))
  } catch (error) {
    await update($, panel, () => null)

    try {
      $.ui.toast(`moon-band: 详解失败 — ${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // toast 只是通知，失败也不影响下一拍
    }
  } finally {
    redraw($)
  }
}

export const register: Register = on => {
  let tick: Timer | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await quietly(() => $.command.register({ name: 'moon', description: 'Hide or show the moon line (moon-band)' }))
    await loadCorpus($)

    const wasHidden = await quietly(() => $.store.get(HIDDEN_KEY))

    if (wasHidden === true) await update($, isHidden, () => true)

    if (tick === null) {
      try {
        // keeps a long session's moon and line from going stale
        tick = $.clock.every(REFRESH_MS, () => {
          try {
            $.ui.invalidate('ui.render')
          } catch {
            // the next redraw takes it
          }
        })
      } catch {
        // without the tick the line still redraws on every turn
      }
    }

    return result
  })

  on('command.run', { command: 'moon' }, async ($, e, next) => {
    const wasHidden = await read($, isHidden)

    await update($, isHidden, () => !wasHidden)
    await quietly(() => $.store.set(HIDDEN_KEY, !wasHidden))

    return { text: wasHidden ? 'moon line shown' : 'moon line hidden' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (await read($, isHidden)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const nowMs = (await quietly(() => $.clock.now())) ?? Date.now()
    const lines = await loadCorpus($)
    const poem = poemAt(nowMs, lines)
    const { author } = sourceParts(poem.from)
    const cached = await cachedAboutOf($, poem.line)
    // 缓存里的朝代优先：表里没有的作者，问过一次之后就知道了
    const dynasty = cached?.dynasty ?? dynastyOf(author)
    const shown = await read($, panel)
    // 只画「当前这一句」的面板：换句之后旧的自然消失
    const here = shown !== null && shown.line === poem.line ? shown : null
    const about = here?.about ?? null
    const inner = await next(e)

    const label = here?.busy === true ? '生成中…' : about !== null ? '收起' : cached !== null ? '详解（已缓存）' : '详解'

    return (
      <Box flexDirection="column">
        {inner}
        <Box flexDirection="row" flexShrink={0}>
          <Text dimColor wrap="truncate-end">
            {lineOf(nowMs, lines)}
          </Text>
          {dynasty === null ? null : <Text dimColor>{`  ${dynasty}  `}</Text>}
          <Button
            label={label}
            dimColor
            onPress={() => {
              void explain($)
            }}
          />
        </Box>
        {about === null ? null : (
          <Box flexDirection="column">
            {about.dynasty === null && about.year === null ? null : (
              <Text dimColor wrap="truncate-end">
                {[about.dynasty, about.year].filter(Boolean).join(' · ')}
              </Text>
            )}
            <Text dimColor wrap="truncate-end">
              {`诗意：${about.meaning}`}
            </Text>
            <Text dimColor wrap="truncate-end">
              {`背景：${about.background}`}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
