import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { lineOf, poemsOf, POEMS } from './moon'
import type { Poem } from './moon'

// moon-band: the moon's phase and a line of poetry as one dim row above the
// prompt. Nothing here is load-bearing — it is decoration, and `/moon` takes it
// away for a while when a screen of prose is wanted instead.
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

    const { Box, Text } = $.ui.resolve(e)
    const nowMs = (await quietly(() => $.clock.now())) ?? Date.now()
    const lines = await loadCorpus($)
    const inner = await next(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Text dimColor wrap="truncate-end">
          {lineOf(nowMs, lines)}
        </Text>
      </Box>
    )
  })
}
