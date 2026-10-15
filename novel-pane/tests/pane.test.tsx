/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

const BOOK = [
  '第一章　夜航',
  '',
  '船在雾里走，灯是唯一的方向。',
  '他把书翻到下一页，风从舷窗进来。',
  ...Array.from({ length: 56 }, (_, i) => `第${i + 5}行`),
].join('\n')

const PATH = 'D:\\books\\试验小说.txt'

type Engine = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

/** The pane mounted as the surface draws it, with the room the engine would report. */
const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'novel-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'novel',
    props: {},
  })

const openBook = async ($: Engine, on: On, args = PATH): Promise<{ text: string }> => {
  on('fs.read', () => ({ value: BOOK }))

  return $.command.run({ command: 'novel', args })
}

describe('the pane', () => {
  test('draws the book and its buttons, with no client and no focus to ask for', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)

    expect((await ui.find({ text: /第一章/ }))?.text).toContain('第一章　夜航')

    // four buttons, in the pane's own tree where a click needs no focus
    const buttons = await ui.findAll({ type: 'Button' })

    expect(buttons.map(one => one.text)).toEqual(expect.arrayContaining(['↑ 上一屏', '↓ 下一屏', '⌂ 回到开头', '✕ 收起']))
    expect(await ui.find({ text: /滚轮/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('a click on 下一屏 moves down a screenful', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)
    expect(await ui.find({ text: /第一章/ })).not.toBe(undefined)

    await ui.press({ key: 'down' })

    expect(await ui.find({ text: /第一章/ })).toBe(undefined)
    await ui.unmount()
  })

  test('a click on 回到开头 comes back to the first line', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)
    await ui.press({ key: 'down' })
    await ui.press({ key: 'top' })

    expect(await ui.find({ text: /第一章/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('a click on 收起 closes it and keeps the place', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)
    await ui.press({ key: 'down' })
    await ui.press({ key: 'close' })
    await new Promise(resolve => setTimeout(resolve, 0))

    const reopened = await $.command.run({ command: 'novel', args: '' })

    expect(reopened.text).toContain('试验小说.txt')
    await ui.unmount()
  })

  test('where the window was scrolled to is what gets remembered', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    // a pane whose window stands eleven rows into the chunk: the place is that
    // line, not the top of the chunk
    const scrolled = await $.ui.mount({
      plugin: 'novel-pane',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'novel',
      props: { scroll: { offset: 11 } } as never,
    })

    await scrolled.unmount()

    const said = await $.command.run({ command: 'novel', args: 'read' })

    // the chunk starts at line 0 and the window stands eleven rows in, so the
    // place is line 11 — the book's «第12行» (its lines are numbered from one)
    expect(said.text).toContain('第12行')
    expect(said.text).toContain('第 1/')
  })
})

describe('the command still turns pages', () => {
  test('/novel n prints the next page and moves the place', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await openBook($, on)

    const first = await $.command.run({ command: 'novel', args: 'read' })
    const next = await $.command.run({ command: 'novel', args: 'n' })

    expect(first.text).toContain('第一章')
    expect(next.text).not.toContain('第一章')
    expect(next.text).toContain('第 2/')
    expect(next.text).toContain('↑ 回车')
  })

  test('/novel <number> jumps, /novel read stays put', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await openBook($, on)

    expect((await $.command.run({ command: 'novel', args: '3' })).text).toContain('第 3/')
    expect((await $.command.run({ command: 'novel', args: 'read' })).text).toContain('第 3/')
  })

  test('a fresh session turns the page of the book last read, on `/novel n` alone', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, { lastPath: PATH, places: { [PATH]: 0 } })
    on('fs.read', () => ({ value: BOOK }))

    const said = await $.command.run({ command: 'novel', args: 'n' })

    expect(said.text).not.toContain('读不到')
    expect(said.text).toContain('第 2/')
  })

  test('with nothing ever read, a bare page word says what to do first', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    expect((await $.command.run({ command: 'novel', args: 'n' })).text).toContain('先打开一本')
  })

  test('a book left open is the one /novel with no argument reopens', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, { lastPath: PATH, places: { [PATH]: 2 } })
    on('fs.read', () => ({ value: BOOK }))

    const said = await $.command.run({ command: 'novel', args: '' })

    expect(said.text).toContain('试验小说.txt')
  })
})

describe('the paths it is given', () => {
  test('a path copied with quotes around it still opens', async ($, on) => {
    const asked: string[] = []

    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', ($h, e) => {
      asked.push(e.path)

      return { value: BOOK }
    })

    const opened = await $.command.run({ command: 'novel', args: `"${PATH}"` })

    expect(asked[0]).toBe(PATH)
    expect(opened.text).toContain('试验小说.txt')
  })

  test('a stray /novel on the end of the path is left off, since it opens the file', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', ($h, e) => {
      if (e.path !== PATH) throw new Error('no such file')

      return { value: BOOK }
    })

    const opened = await $.command.run({ command: 'novel', args: `${PATH}/novel` })

    expect(opened.text).toContain('试验小说.txt')
    expect(opened.text).toContain('忽略了')
  })

  test('a file whose name really ends in novel is not second-guessed', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', ($h, e) => {
      if (e.path !== 'D:\\books\\novel') throw new Error('no such file')

      return { value: BOOK }
    })

    const opened = await $.command.run({ command: 'novel', args: 'D:\\books\\novel' })

    expect(opened.text).toContain('novel')
    expect(opened.text).not.toContain('忽略了')
  })

  test('an empty file is called that, not opened as a blank pane', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => ({ value: '   \n\n  ' }))

    expect((await $.command.run({ command: 'novel', args: PATH })).text).toContain('是空的')
  })

  test('a file that cannot be read says so, rather than opening an empty pane', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => {
      throw new Error('no such file')
    })

    expect((await $.command.run({ command: 'novel', args: 'D:\\books\\没有这本.txt' })).text).toContain('读不到')
  })

  test('with nothing remembered and no path it says how to use it', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    expect((await $.command.run({ command: 'novel', args: '' })).text).toContain('/novel')
  })
})
