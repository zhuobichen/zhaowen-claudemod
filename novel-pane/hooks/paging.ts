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
