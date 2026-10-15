import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { clickKeyOf, lastLineOf, moveOf, pageFor, wrapText } from './paging'
import type { Page } from '../types'

// novel-pane: a pane that reads a book in the session. `/novel <path>` opens it,
// `/novel` again closes it.
//
// The book lives here, not in the drawing: a Client's props are capped at 100,000
// characters, so the pane's module is handed one page at a time and posts each key
// back for the next one. The place is kept per file in the plugin's store, so
// closing the pane — or quitting Claude Code — does not lose the page.

const PANE_ID = 'novel'

/** The key the pane's own element is drawn under: what `$.ui.focus` aims at. */
const KEY_OF_PANE = 'novel'

const PLACES_KEY = 'places'
const LAST_KEY = 'lastPath'

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
 * The open book: the text as read, the wrapped lines, and where in them the
 * reader is. `columns` is kept so a redraw rewraps only when the width really
 * changed — rewrapping a novel is not something to do once a frame.
 */
let book: { path: string; text: string; columns: number; lines: string[]; line: number } | null = null

/** The rows the pane last reported, for the keys that arrive between renders. */
let lastRows = DEFAULT_ROWS

const rowsOf = (props: unknown): number => {
  const withScroll = props as { scroll?: { bodyRows?: number }; bodyRows?: number } | undefined
  const rows = withScroll?.scroll?.bodyRows ?? withScroll?.bodyRows ?? lastRows

  return Math.max(1, Math.floor(rows))
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
type Read =
  | { ok: true; path: string; text: string }
  | { ok: false; why: 'unreadable' | 'empty'; path: string }

/**
 * The file's text, from the path as given or from the path with its tail off.
 * A file that reads as nothing — empty, or whitespace — is reported as exactly
 * that: a blank pane is a worse answer than a sentence saying so.
 */
const readBook = async ($: EngineInterface, path: string): Promise<Read> => {
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

/** Rewraps the open book when the pane's width changed. */
const fitTo = (columns: number): void => {
  if (book === null || book.columns === columns) return

  book = { ...book, columns, lines: wrapped(book.text, columns) }
}

const placesOf = async ($: EngineInterface): Promise<Record<string, number>> => {
  const raw = await quietly(() => $.store.get(PLACES_KEY))

  return raw !== null && typeof raw === 'object' ? (raw as Record<string, number>) : {}
}

const remember = async ($: EngineInterface): Promise<void> => {
  if (book === null) return

  const places = await placesOf($)
  const at = book

  await quietly(() => $.store.set(PLACES_KEY, { ...places, [at.path]: at.line }))
  await quietly(() => $.store.set(LAST_KEY, at.path))
}

const pagePropsOf = (rows: number): Page =>
  book === null ? pageFor([], 0, rows) : pageFor(book.lines, book.line, rows)

/** Opens the pane on a book, reading the file when it is not the open one. */
const openOn = async ($: EngineInterface, asked: string, columns: number): Promise<string> => {
  let path = asked
  let note = ''

  if (book === null || book.path !== path) {
    const read = await readBook($, path)

    if (!read.ok) {
      return read.why === 'empty' ? `这个文件是空的：${asked}` : `读不到这个文件：${asked}`
    }

    path = read.path
    note = path === asked ? '' : `（路径末尾的 /novel 我忽略了）`

    const places = await placesOf($)
    const lines = wrapped(read.text, columns)

    book = { path, text: read.text, columns, lines, line: Math.min(lastLineOf(lines.length, lastRows), places[path] ?? 0) }
  }

  await update($, isOpen, () => true)

  // read the answer rather than hoping: a pane that was not placed would
  // otherwise look exactly like one that was, and the person is the only one who
  // can see the difference
  const opened = await quietly(() =>
    $.ui.open({ id: PANE_ID, title: titleOf(path), focus: true, closeOnEscape: true }),
  )
  const placed =
    opened === null
      ? ' · 引擎没接受这次开窗（窗格不会出现）'
      : opened.isPlaced
        ? ''
        : ` · 窗格没能摆出来：${opened.reason ?? '原因没说'}`

  // recorded on open, not only on a move or a close: `/novel` with no argument
  // means "the book I was reading", and a book left open was being read
  await remember($)

  return `${titleOf(path)} · ${pagePropsOf(lastRows).progress}${note}${placed}`
}

const closePane = async ($: EngineInterface): Promise<void> => {
  await remember($)
  await update($, isOpen, () => false)
  await quietly(() => $.ui.close({ id: PANE_ID }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await quietly(() =>
      $.command.register({
        name: 'novel',
        description: 'Read a book in a pane: /novel <path> opens it, /novel again closes it (novel-pane)',
      }),
    )

    return result
  })

  on('command.run', { command: 'novel' }, async ($, e, next) => {
    const asked = cleanPath(e.args ?? '')

    // Already open, and no path asked for: hand the keys back to it. Typing in
    // the prompt takes them, and this is how they come back without the mouse.
    // Closing is Escape, `q` in the pane, or the engine's own mark.
    if ((await read($, isOpen)) && asked === '') {
      const focused = await quietly(() => $.ui.focus({ requestId: PANE_ID, key: KEY_OF_PANE }))

      return { text: focused === null ? '窗格开着，但焦点没能交还给它' : '翻页键已交给窗格（Esc 或 q 收起）' }
    }

    if (await read($, isOpen)) {
      await closePane($)

      return { text: 'novel pane closed' }
    }

    const last = await quietly(() => $.store.get(LAST_KEY))
    const path = asked !== '' ? asked : typeof last === 'string' ? last : ''

    if (path === '') return { text: '`/novel <文件路径>` 打开一本书；不带参数则回到上一次读的那本' }

    return { text: await openOn($, path, columnsOf(undefined)) }
  })

  // The pane's module posts each key here; answering `{ props }` hands that
  // instance the next page, with no render hook run in between.
  on('ui.message', async ($, e, next) => {
    if (book === null) return next(e)

    const posted = e.data as { key?: unknown; clickY?: unknown; rows?: unknown } | undefined
    const key =
      typeof posted?.key === 'string'
        ? posted.key
        : typeof posted?.clickY === 'number'
          ? clickKeyOf(posted.clickY, typeof posted.rows === 'number' ? posted.rows : lastRows)
          : null

    if (key === null) return next(e)

    const rows = rowsOf(e.element?.props)
    const move = moveOf(key, book.line, rows, book.lines.length)

    if (move === null) return { props: pagePropsOf(rows) }

    if ('close' in move) {
      await closePane($)

      return { props: pagePropsOf(rows) }
    }

    book = { ...book, line: move.line }
    await remember($)

    return { props: pagePropsOf(rows) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (book === null) return next(e)

    lastRows = rowsOf(e.props)
    fitTo(columnsOf(e.props))

    const { Box, Client } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" width="100%">
        <Client key={KEY_OF_PANE} module="./client.tsx" props={pagePropsOf(lastRows)} />
      </Box>
    )
  })
}
