import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  bookFilesOf,
  BUTTONS,
  clipTo,
  isStepOf,
  labelOf,
  modeOf,
  positionOf,
  printedOf,
  shelfLabelOf,
  shelfPrintOf,
  shelfStatusOf,
  shelfTopOf,
  shelfWindowOf,
  textRowsOf,
  statusOf,
  steppedBy,
  windowOf,
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
const SHELF_KEY = 'shelfDir'

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

/**
 * The list of books, when it is up instead of a book: the directory it comes
 * from, the names worth offering, where the list is scrolled to, and which of
 * them the reader has a place in. `null` means the pane is reading.
 */
let shelf: { dir: string; names: string[]; at: number; hasPlace: Set<string> } | null = null

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

/**
 * Where a line number lands in the book, ends taken into account. Nothing but a
 * real line ever comes of it: a move that arrives without a distance (`e.by`
 * absent, an event raised by a plugin's own `scroll`) would otherwise be `NaN`,
 * and a `NaN` place draws an empty pane under a `NaN/60` readout — a silent
 * break, where the reader's place is worth more than the move.
 */
const clampLine = (line: number): number => {
  if (book === null) return 0

  const last = Math.max(0, book.lines.length - 1)

  return Number.isFinite(line) ? Math.min(last, Math.max(0, Math.floor(line))) : book.seen
}

/**
 * Pins this plugin's line under the prompt: how the pane reads and where the
 * reader is. It does not go in the band above the prompt — those rows are a
 * shared budget, and a second row of this plugin's own pushed the other mods out
 * of it. `undefined` takes the line away again once the pane is closed, even
 * though the book stays where it was.
 */
const pin = async ($: EngineInterface): Promise<void> => {
  const open = await read($, isOpen)

  let line: string | undefined

  if (!open) line = undefined
  else if (shelf !== null) line = shelfStatusOf(shelf.dir, shelf.at, shelf.names.length, pageRowsOf())
  else if (book !== null) line = statusOf(book.seen, pageRowsOf(), book.lines.length, mode)

  await quietly(() => $.ui.status(line))
}

// ── the shelf ────────────────────────────────────────────────────────────────
//
// Entered by command, switched by click. Nothing is added to the pane's control
// row: that row is drawn inside the pane, the pane is docked at a width the
// engine chose, and a row wider than the pane is clipped — a clipped button is
// one nobody can click.

/** The directory part of a path, whichever separator it came with. */
const dirOf = (path: string): string => {
  const cut = path.replace(/[/\\]+$/, '')
  const at = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\'))

  return at <= 0 ? cut : cut.slice(0, at)
}

/** A name inside a directory, keeping the separator that directory already uses. */
const joinPath = (dir: string, name: string): string =>
  dir.includes('/') && !dir.includes('\\')
    ? `${dir.replace(/\/+$/, '')}/${name}`
    : `${dir.replace(/[/\\]+$/, '')}\\${name}`

/**
 * Where the shelf looks: the directory set for it, else the one the open book
 * lies in, else the one the last book lay in.
 */
const shelfDirOf = async ($: EngineInterface): Promise<string> => {
  const set = await quietly(() => $.store.get(SHELF_KEY))

  if (typeof set === 'string' && set !== '') return set
  if (book !== null) return dirOf(book.path)

  const last = await quietly(() => $.store.get(LAST_KEY))

  return typeof last === 'string' ? dirOf(last) : ''
}

/**
 * Puts the list up in place of the reading. A directory that cannot be listed is
 * not worth a sentence in the conversation: the list comes up empty and the
 * pinned line says which directory it looked in.
 */
const openShelf = async ($: EngineInterface, asked?: string): Promise<void> => {
  const dir = asked !== undefined && asked !== '' ? asked : await shelfDirOf($)
  const places = await placesOf($)
  const listed = dir === '' ? [] : await quietly(() => $.fs.list(dir))
  const names = bookFilesOf(listed ?? [])

  shelf = {
    dir,
    names,
    at: 0,
    hasPlace: new Set(names.filter(name => places[joinPath(dir, name)] !== undefined)),
  }

  if (asked !== undefined && asked !== '') await quietly(() => $.store.set(SHELF_KEY, asked))
}

/** Puts the reading back, leaving the open book where it was. */
const closeShelf = (): void => {
  shelf = null
}

/** Opens the pane on the list rather than on a book. */
const openShelfInPane = async ($: EngineInterface): Promise<string | undefined> => {
  await update($, isOpen, () => true)

  const opened = await quietly(() => $.ui.open({ id: PANE_ID, title: '书单', closeOnEscape: true }))

  await pin($)
  await repaint($)

  if (opened === null) return '打开了书单，但引擎没接受这次开窗（窗格不会出现）'

  return undefined
}

/** Fills the list, puts it up, and answers the one sentence when it could not be. */
const openShelfOn = async ($: EngineInterface, dir?: string): Promise<string | undefined> => {
  await openShelf($, dir)

  return openShelfInPane($)
}

/**
 * A page of reading: the rows of text the pane shows under its controls. One
 * fewer than the pane, because the controls take one — a `↓` that moved by the
 * whole pane would skip a line on every page.
 */
const pageRowsOf = (): number => textRowsOf(lastRows)

/**
 * Opens the pane on a book, reading the file when it is not the open one, and
 * answers what the conversation should be told: nothing at all when it worked —
 * the pane and the pinned line already say where the reader is, and a book
 * opened is not worth a line in the transcript — or the one sentence that says
 * why it did not.
 */
const openOn = async (
  $: EngineInterface,
  asked: string,
  columns: number,
): Promise<string | undefined> => {
  let path = asked

  if (book === null || book.path !== path) {
    const outcome = await readBook($, path)

    if (!outcome.ok) {
      return outcome.why === 'empty' ? `这个文件是空的：${asked}` : `读不到这个文件：${asked}`
    }

    path = outcome.path

    const places = await placesOf($)
    const lines = wrapped(outcome.text, columns)
    const seen = Math.min(Math.max(0, places[path] ?? 0), Math.max(0, lines.length - 1))

    mode = modeOf(await quietly(() => $.store.get(MODE_KEY)))
    book = { path, text: outcome.text, columns, lines, line: seen, seen }
  }

  // a book opened from the list takes the pane back from the list
  closeShelf()
  await update($, isOpen, () => true)

  const opened = await quietly(() =>
    $.ui.open({ id: PANE_ID, title: titleOf(path), closeOnEscape: true }),
  )

  await remember($)
  await pin($)
  await repaint($)

  if (opened === null) return `打开了 ${titleOf(path)}，但引擎没接受这次开窗（窗格不会出现）`
  if (!opened.isPlaced) return `打开了 ${titleOf(path)}，但窗格没能摆出来：${opened.reason ?? '原因没说'}`

  return undefined
}

const closePane = async ($: EngineInterface): Promise<void> => {
  await remember($)
  await update($, isOpen, () => false)
  await quietly(() => $.ui.close({ id: PANE_ID }))
  await pin($)
}

/** Moves the place by whole screens, the way the buttons do. */
const moveBy = async ($: EngineInterface, lines: number): Promise<void> => {
  if (book === null) return

  const next = clampLine(book.seen + lines)

  book = { ...book, line: next, seen: next }
  await remember($)
  await pin($)
  await repaint($)
}

/**
 * Runs one of the pane's buttons. Declared at the top of the file on purpose:
 * the loader refuses a `$` handed to a function made inside a hook, so the
 * Button's closure calls this rather than doing the work itself.
 */
async function actOn($: EngineInterface, key: string): Promise<void> {
  // While the list is up the same controls work it: up, down and home walk the
  // list, and a row's own button opens that book.
  if (shelf !== null) {
    if (key === 'close') {
      await closePane($)

      return
    }

    if (key === 'down') {
      const rows = pageRowsOf()

      shelf = { ...shelf, at: Math.min(shelfTopOf(shelf.names.length, rows), shelf.at + rows) }
    } else if (key === 'up') {
      shelf = { ...shelf, at: Math.max(0, shelf.at - pageRowsOf()) }
    } else if (key === 'top') {
      shelf = { ...shelf, at: 0 }
    } else if (key.startsWith('open:')) {
      const at = Number(key.slice('open:'.length))
      const name = Number.isInteger(at) ? shelf.names[at] : undefined

      if (name !== undefined) {
        await openOn($, joinPath(shelf.dir, name), columnsOf(undefined))

        return
      }
    }

    await pin($)
    await repaint($)

    return
  }

  if (book === null) return

  if (key === 'down') await moveBy($, pageRowsOf())
  else if (key === 'up') await moveBy($, -pageRowsOf())
  else if (key === 'top') await moveBy($, -book.seen)
  else if (key === 'close') await closePane($)
  else if (key === 'mode') {
    mode = mode === 'scroll' ? 'page' : 'scroll'
    await quietly(() => $.store.set(MODE_KEY, mode))
    await pin($)
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

    // The shelf. It is entered by a command rather than a button on the pane's
    // control row on purpose: that row is drawn inside the pane, the pane is
    // docked at a width the engine chose, and a row wider than the pane is
    // clipped — a clipped button is one nobody can click. The switching inside
    // the list is the click.
    if (asked === 'shelf' || asked.toLowerCase().startsWith('shelf ')) {
      const dir = cleanPath(asked.slice('shelf'.length))
      const problem = await openShelfOn($, dir === '' ? undefined : dir)

      return problem === undefined ? {} : { text: problem }
    }

    // the same list as a line of the conversation, for when a pane is not what
    // the person wants — or cannot be seen, as in a headless run
    if (asked === 'list' || asked.toLowerCase().startsWith('list ')) {
      const dir = cleanPath(asked.slice('list'.length))
      const where = dir !== '' ? dir : await shelfDirOf($)

      if (where === '') {
        return { text: '还没有书单目录：`/novel list <目录>` 或 `/novel shelf <目录>` 先指定一个' }
      }

      const listed = await quietly(() => $.fs.list(where))

      if (dir !== '') await quietly(() => $.store.set(SHELF_KEY, dir))

      return { text: shelfPrintOf(where, bookFilesOf(listed ?? [])) }
    }

    // A word about the place, not a path: move there and print the page into the
    // conversation, where no focus is needed and ↑⏎ asks for the next one. The
    // pane, when it is open, follows.
    if (isStepOf(asked)) {
      if (book === null) {
        const last = await quietly(() => $.store.get(LAST_KEY))
        const remembered = typeof last === 'string' ? last : ''

        if (remembered === '') return { text: '还没读过书：`/novel <文件路径>` 先打开一本' }

        const reopened = await openOn($, remembered, columnsOf(undefined))

        if (book === null) return { text: reopened ?? '读不到上次那本书' }
      }

      const at = book
      const stepped = steppedBy(asked, at.seen, pageRowsOf(), at.lines.length)

      if (stepped !== null) {
        book = { ...at, line: stepped, seen: stepped }
        await remember($)
        await pin($)
        await repaint($)
      }

      return { text: printedOf(book.lines, book.seen, pageRowsOf()) }
    }

    // opening, and closing, say nothing: the pane and the pinned line already
    // show where the reader is, and a line per `/novel` is a line in the
    // transcript every time. Only a failure is worth a sentence.
    if (await read($, isOpen)) {
      await closePane($)

      return {}
    }

    const last = await quietly(() => $.store.get(LAST_KEY))
    const path = asked !== '' ? asked : typeof last === 'string' ? last : ''

    if (path === '') {
      return { text: '`/novel <文件路径>` 打开一本书 · 打开后提示框下面那行说明按钮 · `/novel n` 下一页' }
    }

    return { text: await openOn($, path, columnsOf(undefined)) }
  })

  // A click on one of this pane's buttons, or its chord. No keyboard focus is
  // involved, which is the whole reason the buttons exist.

  // The wheel, as it turns. The engine asks before moving the site's window and
  // this hook answers for itself — no `next`, so nothing moves — because the
  // window must stay at the top for the controls to stay on screen. The reading
  // moves instead: the place goes by the rows the wheel asked for, and the pane
  // is redrawn one window further on.
  //
  // (The engine's own words for this: a hook drawing its own rows under a header
  // moves them by `e.by` and invalidates.)
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (book === null) return next(e)

    // how far the move asks for. `by` is the engine's for the person's wheel;
    // an event raised by a plugin's own `$.ui.scroll` carries the target offset
    // instead, and its window stands at the top (this pane draws one windowful),
    // so the offset is the distance
    const step = Number.isFinite(e.by) ? e.by : Number.isFinite(e.offset) ? e.offset : 0

    // the wheel over the list walks the list
    if (shelf !== null) {
      const rows = pageRowsOf()
      const by = mode === 'page' ? Math.sign(step) * rows : step
      const at = Number.isFinite(by)
        ? Math.min(shelfTopOf(shelf.names.length, rows), Math.max(0, shelf.at + by))
        : shelf.at

      if (at !== shelf.at) {
        shelf = { ...shelf, at }
        await pin($)
        await repaint($)
      }

      return {}
    }

    if (book === null) return next(e)

    // in the whole-screen mode a wheel tick turns the page it is over, rather
    // than creeping a line at a time
    const asked = mode === 'page' ? Math.sign(step) * pageRowsOf() : step
    const seen = clampLine(book.seen + asked)

    if (seen === book.seen) return {}

    book = { ...book, line: seen, seen }
    await persist($)
    await pin($)
    await repaint($)

    return {}
  })

  // The pane's body: the controls, then as much text as the pane has room for.
  // Exactly the window's height, so the engine has nowhere to scroll and the
  // header cannot be scrolled away from under the reader.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (book === null && shelf === null) return next(e)

    lastRows = rowsOf(e.props)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = pageRowsOf()

    // The tree is exactly one windowful, so the engine's window has nowhere to
    // move and this is 0. Should it ever be moved from outside (the pane is
    // focused and a key reaches it), the row it stands on is the reader's place.
    // The list does not read that offset: its own place is `shelf.at`.
    if (shelf === null) {
      fitTo(columnsOf(e.props))

      const offset = (e.props as { scroll?: { offset?: number } } | undefined)?.scroll?.offset ?? 0

      if (Number.isFinite(offset) && offset > 0 && book !== null) {
        book = { ...book, seen: clampLine(book.seen + offset) }
      }
    }

    const control = (
      <Box flexDirection="row" flexShrink={0}>
        {BUTTONS.map(button => (
          <Button
            key={`novel-${button.key}`}
            label={labelOf(button, mode)}
            onPress={() => {
              void actOn($, button.key)
            }}
          />
        ))}
        <Text dimColor wrap="truncate-end">
          {' '}
          {shelf !== null
            ? `${shelf.names.length} 本`
            : book === null
              ? ''
              : positionOf(book.seen, rows, book.lines.length, mode)}
        </Text>
      </Box>
    )

    if (shelf !== null) {
      const showing = shelfWindowOf(shelf.names, shelf.at, rows)
      // a button is as wide as its label, so a long name would widen the whole
      // tree: clipped to the pane, it cannot
      const room = Math.max(8, columnsOf(e.props) - 4)

      return (
        <Box flexDirection="column" width="100%">
          {control}
          {shelf.names.length === 0 ? (
            <Text dimColor wrap="truncate-end">
              （这个目录里没有能读的文件：{shelf.dir}）
            </Text>
          ) : (
            showing.map((name, index) => (
              <Button
                key={`novel-book-${shelf.at + index}`}
                label={clipTo(shelfLabelOf(name, shelf.hasPlace.has(name)), room)}
                onPress={() => {
                  void actOn($, `open:${(shelf as NonNullable<typeof shelf>).at + index}`)
                }}
              />
            ))
          )}
        </Box>
      )
    }

    const drawn = windowOf((book as NonNullable<typeof book>).lines, (book as NonNullable<typeof book>).seen, lastRows)

    return (
      <Box flexDirection="column" width="100%">
        {control}
        {drawn.map((line, index) => (
          <Text key={`line-${index}`} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    )
  })
}
