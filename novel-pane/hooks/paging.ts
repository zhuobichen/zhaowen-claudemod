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
 * How much of the book the pane draws in scroll mode: about sixty screens of a
 * long scroll, and still under the 100,000 characters a tree may carry (1,500
 * lines of a Chinese novel is ~60,000). The scroll does not end here — when the
 * reader nears the bottom the chunk is re-based on where they are — this is only
 * how far ahead they can see without that happening.
 */
export const CHUNK_LINES = 1500

/**
 * How close to the end of the drawn chunk counts as near it. Two screens of
 * room left: enough that the reader never meets an end before the next chunk is
 * already under them.
 */
export const rebaseAt = (rows: number, chunk = CHUNK_LINES): number =>
  Math.max(1, chunk - 2 * screenOf(rows))

/**
 * Where the drawn chunk should start, given the row the window stands on:
 * re-based onto the reader when they are near the chunk's end, so scrolling down
 * does not stop at a wall. Answering `line` means the chunk stands as it is.
 */
export const chunkStartFor = (
  line: number,
  offset: number,
  rows: number,
  total: number,
  chunk = CHUNK_LINES,
): number => {
  if (offset < rebaseAt(rows, chunk)) return line

  return Math.min(Math.max(0, total - 1), Math.max(0, line + offset))
}

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

/** What the other mode is called, for the button that switches to it. */
export const otherModeLabel = (mode: Mode): string => (mode === 'scroll' ? '⇄ 翻到整屏' : '⇄ 换成卷轴')

/** The lines the pane draws from `line`, as far as the chunk and the book go. */
export const chunkOf = (lines: string[], line: number, chunk = CHUNK_LINES): string[] =>
  lines.slice(Math.max(0, line), Math.max(0, line) + chunk)

/** The lines a pane in this mode draws: a long scroll, or exactly one screen. */
export const chunkFor = (lines: string[], line: number, rows: number, mode: Mode): string[] =>
  chunkOf(lines, line, mode === 'page' ? screenOf(rows) : CHUNK_LINES)

/** What the pane's buttons carry as keys, and what each says. */
export const BUTTONS = [
  { key: 'mode', label: '⇄' },
  { key: 'up', label: '↑ 上一屏' },
  { key: 'down', label: '↓ 下一屏' },
  { key: 'top', label: '⌂ 开头' },
  { key: 'close', label: '✕ 收起' },
] as const

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
