// The reading itself — wrapping, paging, keys, the place — with no engine calls
// in them, so a test can hold them to account without a session.

import type { Page } from '../types'

/** How many rows a page holds, never less than one. */
const rowsOf = (rows: number): number => Math.max(1, Math.floor(rows))

/** One line of a page, and how wide it draws. */
const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

/**
 * How many cells a character takes. A Chinese character is two cells in a
 * terminal, so wrapping by code point would overflow every other line — the one
 * thing a reader notices first.
 */
export const cellsOf = (character: string): number => {
  const point = character.codePointAt(0) ?? 0

  return WIDE.some(([from, to]) => point >= from && point <= to) ? 2 : 1
}

/** How many cells a string takes. */
export const widthOf = (text: string): number =>
  [...text].reduce((cells, character) => cells + cellsOf(character), 0)

/**
 * The text as lines that fit `columns`: paragraphs kept, blank lines kept (a
 * novel's paragraphing is half its rhythm), nothing invented to fill a row.
 */
export const wrapText = (text: string, columns: number): string[] => {
  // the width it is given, not a comfortable one: a caller that passes fewer
  // columns than fit gets lines that overflow the pane instead of a silent fix
  const width = Math.max(1, Math.floor(columns))
  const lines: string[] = []

  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')

      continue
    }

    let line = ''
    let used = 0

    for (const character of paragraph) {
      const cells = cellsOf(character)

      if (used + cells > width && line !== '') {
        lines.push(line)
        line = ''
        used = 0
      }

      line += character
      used += cells
    }

    lines.push(line)
  }

  return lines
}

/** The lines of one page, `rows` of them, from `line`. */
export const pageOf = (lines: string[], line: number, rows: number): string[] =>
  lines.slice(line, line + Math.max(1, Math.floor(rows)))

/** The first line of the last page: past it the pane would scroll into blank. */
export const lastLineOf = (total: number, rows: number): number =>
  Math.max(0, total - Math.max(1, Math.floor(rows)))

/** Where the page sits, in pages and percent. */
export const progressOf = (line: number, rows: number, total: number): string => {
  const perPage = Math.max(1, Math.floor(rows))
  const pages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(pages, Math.floor(line / perPage) + 1)
  const percent = total === 0 ? 100 : Math.min(100, Math.round(((line + perPage) / total) * 100))

  return `第 ${page}/${pages} 页 · ${percent}%`
}

/**
 * The row of the pane the controls take, before the text. The body is drawn as
 * the header and then exactly as much text as the pane has room for, so the tree
 * is no taller than the window over it: the engine's window never has anywhere
 * to move, the wheel is answered by the plugin moving its own rows, and the
 * controls cannot scroll out of sight the way they did when the text was drawn
 * as one long chunk.
 */
export const HEADER_ROWS = 1

/** The rows of text a pane of `rows` rows has room for, under the header. */
export const textRowsOf = (rows: number): number => Math.max(1, rowsOf(rows) - HEADER_ROWS)

/** The text lines a pane shows from `line`: one windowful, no more. */
export const windowOf = (lines: string[], line: number, rows: number): string[] =>
  pageOf(lines, line, textRowsOf(rows))

/**
 * How far into the book the reader is, in the unit a scroll thinks in. The line
 * is the one under the top of the window, so it is where they are, not how far
 * the chunk they were given reaches.
 */
export const readoutOf = (seen: number, total: number): string => {
  if (total <= 0) return '读到 100%'

  const line = Math.min(Math.max(0, seen) + 1, total)
  const percent = Math.min(100, Math.round((line / total) * 100))

  return `读到 ${percent}%　第 ${line}/${total} 行`
}

/** How the pane reads: a scroll that keeps going, or one screen at a time. */
export type Mode = 'scroll' | 'page'

export const MODES: readonly Mode[] = ['scroll', 'page']

export const modeOf = (raw: unknown): Mode => (raw === 'page' ? 'page' : 'scroll')

/** What the mode is called, in the button that switches it and in the pinned line. */
export const modeNameOf = (mode: Mode): string => (mode === 'scroll' ? '卷轴' : '整屏')

/**
 * What the pane's buttons carry as keys and what each says. The labels are as
 * short as they can be because these are drawn in the band above the prompt,
 * whose rows are shared with every other plugin drawing there — a wide row wraps
 * into a second one and pushes theirs out of the band's window.
 *
 * There are no digits on them, though the band would take them: a digit on a
 * band Button presses from an empty composer, so while a book was open the
 * person could not begin a line with `1` without turning a page instead.
 */
export const BUTTONS = [
  { key: 'mode', label: '⇄ 卷轴' },
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'top', label: '⌂' },
  { key: 'close', label: '✕' },
] as const

/** What each button's label is, the mode button naming the mode it is in. */
export const labelOf = (button: (typeof BUTTONS)[number], mode: Mode): string =>
  button.key === 'mode' ? `⇄ ${modeNameOf(mode)}` : button.label

/** Where the reader is, as short as it can be said. */
export const positionOf = (seen: number, rows: number, total: number, mode: Mode): string => {
  const lines = Math.max(1, total)

  return mode === 'scroll' ? `${Math.min(Math.max(0, seen) + 1, lines)}/${lines}` : progressOf(seen, rows, total)
}

/**
 * The line this plugin pins under the prompt (`$.ui.status`): how the pane
 * reads, and where the reader is.
 *
 * It is pinned rather than drawn in the band because the band's rows are a
 * budget (its `maxRows`, shared with every other plugin drawing there): a second
 * row of this plugin's own is what squeezed the other mods out once already. The
 * status line is the engine's own place for a plugin's line, beside its notices.
 */
export const statusOf = (seen: number, rows: number, total: number, mode: Mode): string =>
  `${modeNameOf(mode)} ${positionOf(seen, rows, total, mode)} · ${mode === 'scroll' ? '滚轮往下滚' : '点 ↓ 翻屏'}`

/** How far a screen is, for a button that moves by one. */
export const screenOf = (rows: number): number => Math.max(1, Math.floor(rows))

/** What a key does to the place. */
export type Move = { line: number } | { close: true } | null

/**
 * The keys this reader answers. Space and the page keys turn a page, j/k and the
 * arrows move a line, g/G go to an end, q closes.
 */
export const moveOf = (key: string, line: number, rows: number, total: number): Move => {
  const perPage = Math.max(1, Math.floor(rows))
  const last = lastLineOf(total, rows)
  const land = (next: number): Move => ({ line: Math.min(last, Math.max(0, next)) })

  switch (key) {
    case ' ':
    case 'pagedown':
    case 'f':
      return land(line + perPage)
    case 'b':
    case 'pageup':
      return land(line - perPage)
    case 'j':
    case 'down':
      return land(line + 1)
    case 'k':
    case 'up':
      return land(line - 1)
    case 'd':
      return land(line + Math.floor(perPage / 2))
    case 'u':
      return land(line - Math.floor(perPage / 2))
    case 'g':
    case 'home':
      return land(0)
    case 'G':
    case 'end':
      return land(last)
    case 'q':
      return { close: true }
    default:
      return null
  }
}

/**
 * The key a click in the pane stands for, by the row it landed on: the lower
 * half turns forward, the upper half back — the way tapping a phone page does.
 * One key, so a click and a keystroke cannot drift apart.
 */
export const clickKeyOf = (y: number, rows: number): string => (y >= rowsOf(rows) / 2 ? ' ' : 'b')

export const KEYS = '点下半屏/空格 下一页 · 点上半屏/b 上一页 · j/k 逐行 · q 收起'

/** The page the pane draws. */
export const pageFor = (lines: string[], line: number, rows: number): Page => ({
  lines: pageOf(lines, line, rows),
  rows: rowsOf(rows),
  progress: progressOf(line, rows, lines.length),
  keys: KEYS,
})

/** What `/novel n` answers: how to ask for the next one without the pane's keys. */
export const PRINT_HINT = '↑ 回车 = 下一页 · `/novel n` 下一页 · `/novel p` 上一页 · `/novel 12` 跳到第 12 页'

/** The page as lines a command can print into the conversation. */
export const printedOf = (lines: string[], line: number, rows: number): string => {
  const page = pageFor(lines, line, rows)

  return [...page.lines, '', `${page.progress}　${PRINT_HINT}`].join('\n')
}

/**
 * Whether the word is about the place rather than a file. Told apart before
 * anything is opened, because `/novel n` in a session that has not opened the
 * book yet must reopen it — not treat `n` as a path.
 */
export const isStepOf = (word: string): boolean => /^(n|next|p|prev|read|\d+)$/i.test(word.trim())

/**
 * Where the place goes for a word typed after `/novel`: a page forward or back,
 * a page number, or `read` for where it already is. `null` when the word is not
 * about the place at all — a path, say.
 */
export const steppedBy = (word: string, line: number, rows: number, total: number): number | null => {
  const asked = word.trim().toLowerCase()
  const land = (next: number): number => Math.min(lastLineOf(total, rows), Math.max(0, next))

  if (asked === 'read') return line
  if (/^\d+$/.test(asked)) return land((Number(asked) - 1) * rowsOf(rows))
  if (asked === 'n' || asked === 'next') return land(line + rowsOf(rows))
  if (asked === 'p' || asked === 'prev') return land(line - rowsOf(rows))

  return null
}

// The shelf: the books in a directory, as a list to read from and click in.
//
// Nothing here touches the control row. That row is drawn inside the pane, the
// pane is docked beside the transcript at a width the engine chose, and a row
// wider than the pane is clipped — a clipped button is one nobody can click. The
// shelf button that used to sit in it was taken back out for that reason: the
// list is entered by `/novel shelf` instead, and the switching itself is the click.

/** What a listed directory offers as a book: the kinds this reader can show. */
const BOOK_SUFFIXES = ['.txt', '.md', '.markdown', '.text', '.log']

export const bookFilesOf = (entries: readonly { name: string; kind: string }[]): string[] =>
  entries
    .filter(
      entry =>
        entry.kind === 'file' &&
        BOOK_SUFFIXES.some(suffix => entry.name.toLowerCase().endsWith(suffix)),
    )
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))

/** Where a list of books may start, so its last page stays full. */
export const shelfTopOf = (count: number, rows: number): number =>
  Math.max(0, count - Math.max(1, Math.floor(rows)))

/** The books one page of the list shows, from `at`. */
export const shelfWindowOf = (names: readonly string[], at: number, rows: number): string[] =>
  names.slice(Math.max(0, at), Math.max(0, at) + Math.max(1, Math.floor(rows)))

/** One book as a row: a dot when there is a place in it to come back to. */
export const shelfLabelOf = (name: string, hasPlace: boolean): string => (hasPlace ? `• ${name}` : name)

/**
 * The text cut to a budget of cells, with an ellipsis where it had to cut.
 *
 * A Button does not truncate itself the way a `Text` with `truncate-end` does:
 * its label is its width. One long name would widen the pane's whole tree, and a
 * tree wider than the dock is clipped.
 */
export const clipTo = (text: string, budget: number): string => {
  if (widthOf(text) <= budget) return text

  const room = Math.max(0, Math.floor(budget) - 1)
  let kept = ''
  let used = 0

  for (const character of [...text]) {
    const gap = cellsOf(character)

    if (used + gap > room) break

    kept += character
    used += gap
  }

  return `${kept}…`
}

/** The line under the prompt while the list is up. */
export const shelfStatusOf = (dir: string, at: number, count: number, rows: number): string => {
  const perPage = Math.max(1, Math.floor(rows))
  const from = count === 0 ? 0 : Math.max(0, at) + 1
  const to = Math.min(count, Math.max(0, at) + perPage)

  return `书单 ${dir} · ${from}-${to}/${count} · 点书名打开`
}

/**
 * The list as one line of the conversation, for `/novel list`: what the shelf
 * holds without opening the pane, and the only way to see a real listing where a
 * pane cannot be seen at all.
 */
export const shelfPrintOf = (dir: string, names: readonly string[], most = 20): string => {
  if (names.length === 0) return `书单 ${dir}：没有能读的文件`

  const shown = names.slice(0, Math.max(1, most))
  const rest = names.length - shown.length
  const tail = rest > 0 ? ` …（还有 ${rest} 本）` : ''

  return `书单 ${dir}（${names.length} 本）：${shown.join('、')}${tail}`
}
