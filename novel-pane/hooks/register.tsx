import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  BUTTONS,
  chunkFor,
  chunkStartFor,
  isStepOf,
  modeOf,
  otherModeLabel,
  printedOf,
  progressOf,
  readoutOf,
  screenOf,
  steppedBy,
  wrapText,
} from './paging'
import type { Mode } from './paging'

// novel-pane: a pane that reads a book in the session, and a command that turns
// its pages without one.
//
// The pane draws the text and its buttons straight into its own tree. Nothing
// here needs keyboard focus: a click on a button raises `ui.press`, and the
// pane's own window — which the engine moves with the wheel — is the scroll. The
// place is kept by line, so `offset` into the drawn chunk is where the reader
// actually is, and closing or quitting resumes there.

const PANE_ID = 'novel'
const PLACES_KEY = 'places'
const LAST_KEY = 'lastPath'
const MODE_KEY = 'mode'

const DEFAULT_ROWS = 20
const DEFAULT_COLUMNS = 80

const isOpen = atom({ plugin: 'novel-pane', key: 'isOpen' } as const, false)

/** Runs `work`, and answers null when it throws. */
const quietly = async <T,>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work()
  } catch {
    return null
  }
}

/**
 * The open book: the text as read, the wrapped lines, where the drawn chunk
 * starts, and the line the reader has actually scrolled to — the last of these
 * is what gets remembered.
 */
let book: { path: string; text: string; columns: number; lines: string[]; line: number; seen: number } | null = null

/** The rows the pane last reported, for the buttons and the command path. */
let lastRows = DEFAULT_ROWS

/** How the pane reads: the long scroll, or a screen at a time. Kept in the store. */
let mode: Mode = 'scroll'

const rowsOf = (props: unknown): number => {
  const withScroll = props as { scroll?: { bodyRows?: number }; bodyRows?: number } | undefined

  return Math.max(1, Math.floor(withScroll?.scroll?.bodyRows ?? withScroll?.bodyRows ?? lastRows))
}

const columnsOf = (props: unknown): number => {
  const columns = (props as { bodyColumns?: number } | undefined)?.bodyColumns

  return Math.max(8, Math.floor(columns ?? DEFAULT_COLUMNS))
}

const titleOf = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? path

/** A path as a person types it: the quotes a copied path comes wrapped in, off. */
const cleanPath = (raw: string): string => raw.trim().replace(/^["']|["']$/g, '').trim()

/**
 * The same path with a stray command word off the end — `/novel <path>/novel`
 * happens when tab-completion or the history puts the command in twice. Only
 * ever tried when the path as given could not be read, so a real file whose name
 * ends in `novel` is never second-guessed.
 */
const withoutCommandTail = (path: string): string | null => {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = trimmed.replace(/[/\\]novel$/i, '')

  return cut === trimmed || cut === '' ? null : cut
}

/** What came of reading the path: the text, or which of the two ways it failed. */
type ReadOutcome =
  | { ok: true; path: string; text: string }
  | { ok: false; why: 'unreadable' | 'empty'; path: string }

/**
 * The file's text, from the path as given or from the path with its tail off.
 * A file that reads as nothing — empty, or whitespace — is reported as exactly
 * that: a blank pane is a worse answer than a sentence saying so.
 */
const readBook = async ($: EngineInterface, path: string): Promise<ReadOutcome> => {
  const tried = async (at: string): Promise<string | null> => {
    const text = await quietly(() => $.fs.read(at))

    return text === null || text.trim() === '' ? null : text
  }

  const text = await tried(path)

  if (text !== null) return { ok: true, path, text }

  const shorter = withoutCommandTail(path)

  if (shorter !== null) {
    const retried = await tried(shorter)

    if (retried !== null) return { ok: true, path: shorter, text: retried }
  }

  // told apart for the person reading the answer, not for the code
  const empty = await quietly(() => $.fs.read(path))

  return { ok: false, why: empty !== null ? 'empty' : 'unreadable', path }
}

const wrapped = (text: string, columns: number): string[] => wrapText(text, columns)

/** Rewraps the open book when the pane's width changed, keeping the line place. */
const fitTo = (columns: number): void => {
  if (book === null || book.columns === columns) return

  book = { ...book, columns, lines: wrapped(book.text, columns) }
}

const placesOf = async ($: EngineInterface): Promise<Record<string, number>> => {
  const raw = await quietly(() => $.store.get(PLACES_KEY))

  return raw !== null && typeof raw === 'object' ? (raw as Record<string, number>) : {}
}

/** Writes down where the reader is — the scrolled-to line, not the chunk's top. */
const remember = async ($: EngineInterface): Promise<void> => {
  if (book === null) return

  const places = await placesOf($)
  const at = book

  await quietly(() => $.store.set(PLACES_KEY, { ...places, [at.path]: at.seen }))
  await quietly(() => $.store.set(LAST_KEY, at.path))
  persisted = at.seen
}

/** How far the place may drift before it is worth a write: a wheel tick is not. */
const PLACE_WRITE_STEP = 25

let persisted = -1

/** Writes the place down, unless it has barely moved since the last write. */
const persist = async ($: EngineInterface): Promise<void> => {
  if (book === null) return
  if (Math.abs(book.seen - persisted) < PLACE_WRITE_STEP) return

  await remember($)
}

/** Repaints the pane after the place moved. */
const repaint = async ($: EngineInterface): Promise<void> => {
  await quietly(() => $.ui.invalidate('ui.render'))
}

/** Opens the pane on a book, reading the file when it is not the open one. */
const openOn = async ($: EngineInterface, asked: string, columns: number): Promise<string> => {
  let path = asked
  let note = ''

  if (book === null || book.path !== path) {
    const outcome = await readBook($, path)

    if (!outcome.ok) {
      return outcome.why === 'empty' ? `这个文件是空的：${asked}` : `读不到这个文件：${asked}`
    }

    path = outcome.path
    note = path === asked ? '' : `（路径末尾的 /novel 我忽略了）`

    const places = await placesOf($)
    const lines = wrapped(outcome.text, columns)
    const seen = Math.min(Math.max(0, places[path] ?? 0), Math.max(0, lines.length - 1))

    mode = modeOf(await quietly(() => $.store.get(MODE_KEY)))
    book = { path, text: outcome.text, columns, lines, line: seen, seen }
  }

  await update($, isOpen, () => true)

  const opened = await quietly(() =>
    $.ui.open({ id: PANE_ID, title: titleOf(path), closeOnEscape: true }),
  )
  const placed =
    opened === null
      ? ' · 引擎没接受这次开窗（窗格不会出现）'
      : opened.isPlaced
        ? ''
        : ` · 窗格没能摆出来：${opened.reason ?? '原因没说'}`

  await remember($)
  await repaint($)

  return `${titleOf(path)} · ${progressOfBook()}${note}${placed}`
}

const progressOfBook = (): string =>
  book === null
    ? ''
    : mode === 'scroll'
      ? readoutOf(book.seen, book.lines.length)
      : progressOf(book.seen, lastRows, book.lines.length)

const closePane = async ($: EngineInterface): Promise<void> => {
  await remember($)
  await update($, isOpen, () => false)
  await quietly(() => $.ui.close({ id: PANE_ID }))
}

/** Moves the place by whole screens, the way the buttons do. */
const moveBy = async ($: EngineInterface, lines: number): Promise<void> => {
  if (book === null) return

  const last = Math.max(0, book.lines.length - 1)
  const next = Math.min(last, Math.max(0, book.seen + lines))

  book = { ...book, line: next, seen: next }
  await remember($)
  await repaint($)
}

/**
 * Runs one of the pane's buttons. Declared at the top of the file on purpose:
 * the loader refuses a `$` handed to a function made inside a hook, so the
 * Button's closure calls this rather than doing the work itself.
 */
async function actOn($: EngineInterface, key: string): Promise<void> {
  if (book === null) return

  if (key === 'down') await moveBy($, screenOf(lastRows))
  else if (key === 'up') await moveBy($, -screenOf(lastRows))
  else if (key === 'top') await moveBy($, -book.seen)
  else if (key === 'close') await closePane($)
  else if (key === 'mode') {
    mode = mode === 'scroll' ? 'page' : 'scroll'
    await quietly(() => $.store.set(MODE_KEY, mode))
    await repaint($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await quietly(() =>
      $.command.register({
        name: 'novel',
        description:
          'Read a book in a pane, or turn its pages by command: /novel <path>, /novel n, /novel 12 (novel-pane)',
      }),
    )

    return result
  })

  on('command.run', { command: 'novel' }, async ($, e, next) => {
    const asked = cleanPath(e.args ?? '')

    // A word about the place, not a path: move there and print the page into the
    // conversation, where no focus is needed and ↑⏎ asks for the next one. The
    // pane, when it is open, follows.
    if (isStepOf(asked)) {
      if (book === null) {
        const last = await quietly(() => $.store.get(LAST_KEY))
        const remembered = typeof last === 'string' ? last : ''

        if (remembered === '') return { text: '还没读过书：`/novel <文件路径>` 先打开一本' }

        const reopened = await openOn($, remembered, columnsOf(undefined))

        if (book === null) return { text: reopened }
      }

      const at = book
      const stepped = steppedBy(asked, at.seen, lastRows, at.lines.length)

      if (stepped !== null) {
        book = { ...at, line: stepped, seen: stepped }
        await remember($)
        await repaint($)
      }

      return { text: printedOf(book.lines, book.seen, lastRows) }
    }

    if (await read($, isOpen)) {
      await closePane($)

      return { text: 'novel pane closed' }
    }

    const last = await quietly(() => $.store.get(LAST_KEY))
    const path = asked !== '' ? asked : typeof last === 'string' ? last : ''

    if (path === '') {
      return { text: '`/novel <文件路径>` 打开一本书 · `/novel n` 下一页 · `/novel 12` 跳到第 12 页' }
    }

    return { text: await openOn($, path, columnsOf(undefined)) }
  })

  // A click on one of this pane's buttons, or its chord. No keyboard focus is
  // involved, which is the whole reason the buttons exist.

  // The wheel, as it turns. A repaint goes out on every move: the readout is in
  // the band, whose own input value does not change as the pane scrolls, so
  // nothing else would ever redraw it. (The engine folds `invalidate` calls to
  // at most ten a second — thirty for the shown pane and the band — so a wheel
  // tick is not a redraw each.) This plugin's own re-base scrolls by zero and so
  // moves nothing, which is what keeps this from feeding itself.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (book === null) return next(e)

    const seen = Math.min(book.lines.length - 1, Math.max(0, book.line + e.offset))

    if (seen === book.seen) return next(e)

    book = { ...book, seen }
    await persist($)
    await repaint($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (book === null) return next(e)

    lastRows = rowsOf(e.props)
    fitTo(columnsOf(e.props))

    // the engine's window over the drawn chunk is the reader's scrolled place:
    // the first row it shows is where they are, whatever moved it there
    const offset = (e.props as { scroll?: { offset?: number } } | undefined)?.scroll?.offset ?? 0

    if (Number.isFinite(offset) && offset >= 0) {
      book = { ...book, seen: Math.min(book.lines.length - 1, book.line + Math.floor(offset)) }
    }

    // the chunk re-bases onto the reader when it is running out, and the window
    // is put back at its top in the same breath: the same lines stay on screen,
    // so the scroll never meets an end and the reader sees no jump
    const started = chunkStartFor(book.line, Math.max(0, offset), lastRows, book.lines.length)

    if (started !== book.line) {
      book = { ...book, line: started }
      await quietly(() => $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: 0 }))
    }

    const { Box, Text } = $.ui.resolve(e)
    const drawn = chunkFor(book.lines, book.line, lastRows, mode)

    return (
      <Box flexDirection="column" width="100%">
        {drawn.map((line, index) => (
          <Text key={`line-${index}`} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    )
  })

  // The controls live in the band above the prompt, not in the pane: the pane's
  // window scrolls with the reading, so anything drawn inside it is gone the
  // moment the reader scrolls past. The band does not scroll.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (book === null || !(await read($, isOpen))) return next(e)
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const inner = await next(e)

    return (
      <Box flexDirection="column" width="100%">
        {inner}
        <Box flexDirection="row">
          {BUTTONS.map(button => (
            <Button
              key={`novel-${button.key}`}
              label={button.key === 'mode' ? otherModeLabel(mode) : button.label}
              onPress={() => {
                void actOn($, button.key)
              }}
            />
          ))}
          <Text dimColor>
            {' '}
            {progressOfBook()}　{mode === 'scroll' ? '滚轮滚动' : '整屏'} · Esc 收起 · `/novel 12` 跳页
          </Text>
        </Box>
      </Box>
    )
  })
}
