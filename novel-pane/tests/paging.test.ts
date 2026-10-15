import { describe, expect, test } from 'claude-code/testing'

import {
  cellsOf,
  CHUNK_LINES,
  chunkFor,
  lastLineOf,
  modeOf,
  moveOf,
  otherModeLabel,
  pageFor,
  pageOf,
  progressOf,
  widthOf,
  wrapText,
} from '../hooks/paging'

describe('how wide a character draws', () => {
  test('a Chinese character takes two cells, a Latin one takes one', () => {
    expect(cellsOf('中')).toBe(2)
    expect(cellsOf('a')).toBe(1)
    expect(cellsOf('，')).toBe(2)
  })

  test('a string is the sum of its characters', () => {
    expect(widthOf('中文abc')).toBe(7)
  })
})

describe('wrapping', () => {
  test('never lets a line past the width', () => {
    const lines = wrapText('一二三四五六七八九十', 10)

    for (const line of lines) expect(widthOf(line)).toBeLessThanOrEqual(10)
    expect(lines.join('')).toBe('一二三四五六七八九十')
  })

  test('keeps the paragraph breaks and the blank lines between them', () => {
    const lines = wrapText('第一段\n\n第二段', 20)

    expect(lines).toEqual(['第一段', '', '第二段'])
  })

  test('breaks on a width a Latin line fits in', () => {
    expect(wrapText('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('a paragraph that fits stays one line', () => {
    expect(wrapText('短句', 20)).toEqual(['短句'])
  })

  test('carriage returns count as newlines, not as characters to read', () => {
    expect(wrapText('甲\r\n乙', 20)).toEqual(['甲', '乙'])
  })
})

describe('paging', () => {
  const lines = ['1', '2', '3', '4', '5', '6', '7']

  test('a page is the rows from the place', () => {
    expect(pageOf(lines, 2, 3)).toEqual(['3', '4', '5'])
  })

  test('the last page starts where a full page still fits', () => {
    expect(lastLineOf(7, 3)).toBe(4)
    expect(pageOf(lines, lastLineOf(7, 3), 3)).toEqual(['5', '6', '7'])
  })

  test('a book shorter than a page never scrolls into blank', () => {
    expect(lastLineOf(2, 10)).toBe(0)
  })

  test('progress counts pages and percent', () => {
    expect(progressOf(0, 3, 7)).toBe('第 1/3 页 · 43%')
    expect(progressOf(4, 3, 7)).toBe('第 2/3 页 · 100%')
    expect(progressOf(0, 10, 0)).toBe('第 1/1 页 · 100%')
  })
})

describe('the keys', () => {
  const rows = 10
  const total = 100

  test('a space turns a page, j a line', () => {
    expect(moveOf(' ', 0, rows, total)).toEqual({ line: 10 })
    expect(moveOf('j', 0, rows, total)).toEqual({ line: 1 })
    expect(moveOf('k', 5, rows, total)).toEqual({ line: 4 })
  })

  test('the arrows and the page keys do what they say', () => {
    expect(moveOf('down', 0, rows, total)).toEqual({ line: 1 })
    expect(moveOf('up', 5, rows, total)).toEqual({ line: 4 })
    expect(moveOf('pageup', 20, rows, total)).toEqual({ line: 10 })
    expect(moveOf('b', 20, rows, total)).toEqual({ line: 10 })
  })

  test('g and G go to the ends', () => {
    expect(moveOf('g', 42, rows, total)).toEqual({ line: 0 })
    expect(moveOf('G', 0, rows, total)).toEqual({ line: 90 })
    expect(moveOf('home', 42, rows, total)).toEqual({ line: 0 })
    expect(moveOf('end', 0, rows, total)).toEqual({ line: 90 })
  })

  test('never before the first line nor past the last page', () => {
    expect(moveOf('k', 0, rows, total)).toEqual({ line: 0 })
    expect(moveOf('b', 3, rows, total)).toEqual({ line: 0 })
    expect(moveOf(' ', 95, rows, total)).toEqual({ line: 90 })
  })

  test('q asks to close, and a key it does not know asks for nothing', () => {
    expect(moveOf('q', 0, rows, total)).toEqual({ close: true })
    expect(moveOf('x', 0, rows, total)).toBe(null)
    expect(moveOf('space', 0, rows, total)).toBe(null)
  })
})

describe('the two modes', () => {
  const lines = Array.from({ length: 500 }, (_, i) => `L${i}`)

  test('the scroll draws a long chunk, the whole screen exactly one screen', () => {
    expect(chunkFor(lines, 0, 20, 'scroll')).toHaveLength(CHUNK_LINES)
    expect(chunkFor(lines, 0, 20, 'page')).toHaveLength(20)
  })

  test('both start where the reader is', () => {
    expect(chunkFor(lines, 100, 20, 'scroll')[0]).toBe('L100')
    expect(chunkFor(lines, 100, 20, 'page')[0]).toBe('L100')
  })

  test('near the end a chunk is as long as the book still is', () => {
    expect(chunkFor(lines, 490, 20, 'scroll')).toHaveLength(10)
  })

  test('a mode the store does not know is the scroll, and the button says the other one', () => {
    expect(modeOf('page')).toBe('page')
    expect(modeOf('nonsense')).toBe('scroll')
    expect(modeOf(undefined)).toBe('scroll')
    expect(otherModeLabel('scroll')).toContain('整屏')
    expect(otherModeLabel('page')).toContain('卷轴')
  })
})

describe('the page the pane draws', () => {
  test('carries its rows, so a short last page keeps the footer at the bottom', () => {
    const page = pageFor(['1', '2', '3'], 0, 5)

    expect(page.rows).toBe(5)
    expect(page.lines).toEqual(['1', '2', '3'])
    expect(page.progress).toContain('第 1/1 页')
    expect(page.keys.length).toBeGreaterThan(6)
  })
})
