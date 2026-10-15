import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { lastLineOf, moveOf, pageFor, wrapText } from './paging'
import type { Page } from '../types'

// novel-pane: a pane that reads a book in the session. `/novel <path>` opens it,
// `/novel` again closes it.
//
// The book lives here, not in the drawing: a Client's props are capped at 100,000
// characters, so the pane's module is handed one page at a time and posts each key
// back for the next one. The place is kept per file in the plugin's store, so
// closing the pane — or quitting Claude Code — does not lose the page.

const PANE_ID = 'novel'
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
const openOn = async ($: EngineInterface, path: string, columns: number): Promise<string> => {
  if (book === null || book.path !== path) {
    const text = await quietly(() => $.fs.read(path))

    if (text === null) return `读不到这个文件：${path}`

    const places = await placesOf($)
    const lines = wrapped(text, columns)

    book = { path, text, columns, lines, line: Math.min(lastLineOf(lines.length, lastRows), places[path] ?? 0) }
  }

  await update($, isOpen, () => true)
  await quietly(() => $.ui.open({ id: PANE_ID, title: titleOf(path) }))

  // recorded on open, not only on a move or a close: `/novel` with no argument
  // means "the book I was reading", and a book left open was being read
  await remember($)

  return `${titleOf(path)} · ${pagePropsOf(lastRows).progress}`
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
    if (await read($, isOpen)) {
      await closePane($)

      return { text: 'novel pane closed' }
    }

    const asked = (e.args ?? '').trim()
    const last = await quietly(() => $.store.get(LAST_KEY))
    const path = asked !== '' ? asked : typeof last === 'string' ? last : ''

    if (path === '') return { text: '`/novel <文件路径>` 打开一本书；不带参数则回到上一次读的那本' }

    return { text: await openOn($, path, columnsOf(undefined)) }
  })

  // The pane's module posts each key here; answering `{ props }` hands that
  // instance the next page, with no render hook run in between.
  on('ui.message', async ($, e, next) => {
    if (book === null) return next(e)

    const key = (e.data as { key?: unknown } | undefined)?.key

    if (typeof key !== 'string') return next(e)

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
        <Client key="novel" module="./client.tsx" props={pagePropsOf(lastRows)} />
      </Box>
    )
  })
}
