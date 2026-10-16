import { describe, expect, test } from 'claude-code/testing'

import {
  BUTTONS,
  bookFilesOf,
  cellsOf,
  HEADER_ROWS,
  labelOf,
  lastLineOf,
  modeNameOf,
  modeOf,
  moveOf,
  pageFor,
  pageOf,
  positionOf,
  progressOf,
  clipTo,
  readoutOf,
  rowWidthOf,
  shelfLabelOf,
  shelfPrintOf,
  shelfStatusOf,
  shelfTopOf,
  shelfWindowOf,
  screenOf,
  statusOf,
  textRowsOf,
  widthOf,
  windowOf,
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

describe('the body the pane draws', () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `L${i}`)

  test('one windowful of text, under the header, so the window has nowhere to move', () => {
    // a pane of 21 rows draws the header and 20 rows of text: nothing to scroll,
    // which is what keeps the controls on screen
    expect(textRowsOf(21)).toBe(21 - HEADER_ROWS)
    expect(windowOf(lines, 0, 21)).toHaveLength(20)
    expect(windowOf(lines, 100, 21)[0]).toBe('L100')
  })

  test('a pane too short for even one line of text still draws one', () => {
    expect(textRowsOf(1)).toBe(1)
    expect(textRowsOf(0)).toBe(1)
    expect(windowOf(lines, 0, 1)).toHaveLength(1)
  })

  test('a book shorter than the window draws as far as the book goes', () => {
    expect(windowOf(lines.slice(0, 5), 0, 21)).toHaveLength(5)
  })

  test('the readout says how far in the book the reader is', () => {
    expect(readoutOf(0, 1000)).toBe('读到 0%　第 1/1000 行')
    expect(readoutOf(499, 1000)).toBe('读到 50%　第 500/1000 行')
    expect(readoutOf(999, 1000)).toBe('读到 100%　第 1000/1000 行')
    expect(readoutOf(0, 0)).toBe('读到 100%')
  })
})

describe('the two modes', () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `L${i}`)

  test('the mode changes how far a key moves the reading, not what is drawn', () => {
    // a screen is how far the buttons move the place, in either mode
    expect(screenOf(20)).toBe(20)
    // and what a pane draws is the same windowful either way
    expect(windowOf(lines, 0, 21)).toHaveLength(20)
  })

  test('every mode draws from where the reader is', () => {
    expect(windowOf(lines, 100, 21)[0]).toBe('L100')
    expect(windowOf(lines, 100, 21)[0]).toBe('L100')
  })

  test('a mode the store does not know is the scroll', () => {
    expect(modeOf('page')).toBe('page')
    expect(modeOf('nonsense')).toBe('scroll')
    expect(modeOf(undefined)).toBe('scroll')
    expect(modeNameOf('scroll')).toBe('卷轴')
    expect(modeNameOf('page')).toBe('整屏')
  })
})

describe('the row of buttons in the pane', () => {
  test('no two buttons share a key, and none carries a digit', () => {
    expect(new Set(BUTTONS.map(button => button.key)).size).toBe(BUTTONS.length)
    // a digit on a band Button would press from an empty composer; these are in
    // the pane, and presses come from clicks and from `Esc`
    expect(BUTTONS.some(button => 'hotkey' in button)).toBe(false)
  })

  test('the whole row stays inside the dock the engine gives the pane', () => {
    // The row is drawn inside the pane, and a docked pane is as wide as the
    // engine made it — 40 columns is the narrow end of what that is. A row wider
    // than the pane is clipped, and a clipped button is one nobody can click, so
    // the budget is smaller than the dock, not equal to it.
    expect(rowWidthOf()).toBeLessThanOrEqual(36)

    // and the mode button's own label is part of it, not an afterthought
    expect(rowWidthOf(BUTTONS, 'page')).toBe(rowWidthOf(BUTTONS, 'scroll'))
  })

  test('the mode button says the mode it is in, so its label is the state', () => {
    const modeButton = BUTTONS.find(button => button.key === 'mode')

    expect(labelOf(modeButton as never, 'scroll')).toBe('⇄ 卷轴')
    expect(labelOf(modeButton as never, 'page')).toBe('⇄ 整屏')
  })

  test('the others say the same thing in either mode', () => {
    for (const button of BUTTONS.filter(one => one.key !== 'mode')) {
      expect(labelOf(button, 'scroll')).toBe(labelOf(button, 'page'))
    }
  })
})

describe('the line pinned under the prompt', () => {
  test('says the mode, where the reader is, and how to go on', () => {
    expect(statusOf(20, 20, 29657, 'scroll')).toBe('卷轴 21/29657 · 滚轮往下滚')
  })

  test('in the whole-screen mode it says the page, not the line', () => {
    expect(statusOf(0, 20, 60, 'page')).toBe('整屏 第 1/3 页 · 33% · 点 ↓ 翻屏')
  })

  test('it never claims a line the book has not got', () => {
    expect(positionOf(999, 20, 1000, 'scroll')).toBe('1000/1000')
    expect(positionOf(0, 20, 0, 'scroll')).toBe('1/1')
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

describe('the shelf of books', () => {
  test('offers the file kinds this reader can show, and no others', () => {
    const listed = [
      { name: '乙书.txt', kind: 'file' },
      { name: '甲书.md', kind: 'file' },
      { name: '封面.png', kind: 'file' },
      { name: '归档.zip', kind: 'file' },
      { name: '子目录.txt', kind: 'dir' },
      { name: '没有后缀', kind: 'file' },
    ]

    // sorted by collation, not by code point: 甲 before 乙 is pinyin order, which
    // is what a list of Chinese titles wants — and it is the same order every
    // time the list is opened
    expect(bookFilesOf(listed)).toEqual(['甲书.md', '乙书.txt'])
    expect(bookFilesOf([])).toEqual([])
  })

  test('a page of the list is the rows it has room for', () => {
    const names = Array.from({ length: 30 }, (_, i) => `第${i}本.txt`)

    expect(shelfWindowOf(names, 0, 10)).toHaveLength(10)
    expect(shelfWindowOf(names, 25, 10)[0]).toBe('第25本.txt')
    // the last page starts where a full page still fits, so the list ends full
    expect(shelfWindowOf(names, shelfTopOf(names.length, 10), 10)).toHaveLength(10)
    expect(shelfTopOf(4, 10)).toBe(0)
  })

  test('a book with a place in it is marked, and one without is not', () => {
    expect(shelfLabelOf('甲书.txt', true)).toBe('• 甲书.txt')
    expect(shelfLabelOf('甲书.txt', false)).toBe('甲书.txt')
  })

  test('the pinned line counts the list and says how to open one', () => {
    expect(shelfStatusOf('D:\\books', 0, 30, 10)).toBe('书单 D:\\books · 1-10/30 · 点书名打开')
    expect(shelfStatusOf('D:\\books', 20, 30, 10)).toBe('书单 D:\\books · 21-30/30 · 点书名打开')
    expect(shelfStatusOf('D:\\books', 0, 0, 10)).toBe('书单 D:\\books · 0-0/0 · 点书名打开')
  })
})

describe('the shelf as a line of the conversation', () => {
  test('names what it holds, and caps a long directory', () => {
    expect(shelfPrintOf('D:\\books', ['甲书.txt', '乙书.txt'])).toBe('书单 D:\\books（2 本）：甲书.txt、乙书.txt')
    expect(shelfPrintOf('D:\\books', ['一', '二', '三'], 2)).toContain('还有 1 本')
  })

  test('an empty shelf says so rather than printing nothing', () => {
    expect(shelfPrintOf('D:\\books', [])).toBe('书单 D:\\books：没有能读的文件')
  })
})

describe('clipping a label to the pane', () => {
  test('leaves text that fits exactly as it is', () => {
    expect(clipTo('甲书.txt', 20)).toBe('甲书.txt')
    expect(clipTo('abcd', 4)).toBe('abcd')
  })

  test('cuts to the budget in cells, an ellipsis at the end', () => {
    // a Chinese character is two cells: five of them are ten, plus the ellipsis
    expect(clipTo('一二三四五六七八', 11)).toBe('一二三四五…')
    expect(widthOf(clipTo('一二三四五六七八', 11))).toBeLessThanOrEqual(11)
    expect(clipTo('abcdefghij', 5)).toBe('abcd…')
  })

  test('a budget too small for anything still says it cut', () => {
    expect(clipTo('一二三', 2)).toBe('…')
    expect(clipTo('一二三', 0)).toBe('…')
  })
})
