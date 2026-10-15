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
type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

/** The pane mounted as the surface draws it, with the room the engine would report. */
const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'novel-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'novel',
    props: {},
  })

/** The band above the prompt, where the controls live. */
const mountBand = ($: Engine) =>
  $.ui.mount({
    plugin: 'novel-pane',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {},
  })

/**
 * The line this plugin pins under the prompt, as it is asked for: every
 * `$.ui.status` reaches a test, since the harness has no status line of its own
 * to write it to. Answering is also what gives that call an implementation.
 */
const pinned = (on: On): (string | undefined)[] => {
  const lines: (string | undefined)[] = []

  on('ui.status', ((_h: Engine, e: { text?: string }) => {
    lines.push(e.text)

    return { value: undefined }
  }) as never)

  return lines
}

/**
 * A pane that gets placed. Left alone the harness refuses `$.ui.open`, and every
 * open would answer with the warning it deserves — true of a headless run, and
 * not what a terminal does.
 */
const placed = (on: On): void => {
  on('ui.open', (() => ({ value: { isPlaced: true } })) as never)
}

const lastPin = (lines: (string | undefined)[]): string => lines[lines.length - 1] ?? ''

/** The line number the pinned line is showing. */
const pinnedLine = (lines: (string | undefined)[]): number =>
  Number(/(?:第 )?(\d+)\//.exec(lastPin(lines))?.[1] ?? 0)

/**
 * Something else's row in the band, a pane that gets placed, and then the book.
 * All before the test's first `$` call: a hook registered after that one is
 * refused, as it should be — the modules beneath the plugins register theirs in
 * `register()`.
 */
const setUp = async ($: Engine, on: On, inner = 'another meter’s row') => {
  on('ui.render', { component: 'AbovePrompt' }, ($h, e) => {
    const { Text } = ($h as Engine).ui.resolve(e)

    return <Text>{inner}</Text>
  })
  placed(on)
  on('fs.read', () => ({ value: BOOK }))

  return $.command.run({ command: 'novel', args: PATH })
}

describe('the pane', () => {
  test('draws the book, and nothing of its own to scroll away', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => ({ value: BOOK }))

    await $.command.run({ command: 'novel', args: PATH })

    const ui = await mountPane($)

    expect((await ui.find({ text: /第一章/ }))?.text).toContain('第一章　夜航')
    // no controls in here: the pane's window scrolls, so they would scroll away
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  })

  test('the controls are in the band, one row, each with its digit', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await setUp($, on)

    const band = await mountBand($)
    const buttons = await band.findAll({ type: 'Button' })

    expect(buttons.map(one => one.text)).toEqual(['⇄ 卷轴', '↑', '↓', '⌂', '✕'])
    await band.unmount()
  })

  test('the buttons share the band row with whatever else draws there', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await setUp($, on, 'deepseek 余额 ¥16.65')

    const band = await mountBand($)

    // the other row is kept, and not pushed out of the band's window
    expect(await band.find({ text: /deepseek 余额/ })).not.toBe(undefined)
    expect(await band.find({ text: /⇄ 卷轴/ })).not.toBe(undefined)
    await band.unmount()
  })

  test('no band row while no book is open', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('ui.render', { component: 'AbovePrompt' }, ($h, e) => {
      const { Text } = ($h as Engine).ui.resolve(e)

      return <Text>another meter’s row</Text>
    })

    const band = await mountBand($)

    // the row beneath is there, so the band itself was drawn
    expect(await band.find({ text: /another meter/ })).not.toBe(undefined)
    expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
    await band.unmount()
  })

  test('a book opened says nothing in the conversation', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    const said = await setUp($, on)

    expect(said.text).toBe(undefined)

    // silence, not a failure: the controls are up
    const band = await mountBand($)

    expect(await band.findAll({ type: 'Button' })).toHaveLength(5)
    await band.unmount()
  })

  test('the pinned line says where the reader is, and follows the buttons', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    const lines = pinned(on)

    await setUp($, on)

    expect(lastPin(lines)).toContain('卷轴 1/60')

    // the rows the pane reports are a screenful, so the pane is mounted as well
    const ui = await mountPane($)
    const band = await mountBand($)

    await band.press({ key: 'novel-down' })
    expect(pinnedLine(lines)).toBe(21)

    await band.press({ key: 'novel-top' })
    expect(pinnedLine(lines)).toBe(1)
    expect(await ui.find({ text: /第一章/ })).not.toBe(undefined)

    await ui.unmount()
    await band.unmount()
  })

  test('the mode button flips its own label and the pinned line with it', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    const lines = pinned(on)

    await setUp($, on)

    expect(lastPin(lines)).toContain('卷轴')

    const band = await mountBand($)
    await band.press({ key: 'novel-mode' })

    expect(await band.find({ text: /⇄ 整屏/ })).not.toBe(undefined)
    expect(await band.find({ text: /⇄ 卷轴/ })).toBe(undefined)
    expect(lastPin(lines)).toContain('整屏')
    await band.unmount()
  })

  test('the mode is remembered across sessions', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, { mode: 'page' })

    await setUp($, on)

    const band = await mountBand($)

    expect(await band.find({ text: /⇄ 整屏/ })).not.toBe(undefined)
    await band.unmount()
  })

  test('a click on 收起 closes it, takes the pinned line away, and keeps the place', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    const lines = pinned(on)

    await setUp($, on)

    const ui = await mountPane($)
    const band = await mountBand($)

    await band.press({ key: 'novel-down' })
    await band.press({ key: 'novel-close' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(lastPin(lines)).toBe('')

    // and `/novel` with no argument opens it again, saying nothing
    const reopened = await $.command.run({ command: 'novel', args: '' })

    expect(reopened.text).toBe(undefined)
    expect(lastPin(lines)).toContain('卷轴')

    await ui.unmount()
    await band.unmount()
  })

  test('where the window was scrolled to is what gets remembered', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => ({ value: BOOK }))

    await $.command.run({ command: 'novel', args: PATH })

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
    on('fs.read', () => ({ value: BOOK }))
    await $.command.run({ command: 'novel', args: PATH })

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
    on('fs.read', () => ({ value: BOOK }))
    await $.command.run({ command: 'novel', args: PATH })

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
    placed(on)
    on('fs.read', () => ({ value: BOOK }))

    const said = await $.command.run({ command: 'novel', args: '' })

    expect(said.text).toBe(undefined)
  })
})

describe('the paths it is given', () => {
  test('a path copied with quotes around it still opens', async ($, on) => {
    const asked: string[] = []

    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    placed(on)
    on('fs.read', ($h, e) => {
      asked.push(e.path)

      return { value: BOOK }
    })

    const opened = await $.command.run({ command: 'novel', args: `"${PATH}"` })

    expect(asked[0]).toBe(PATH)
    expect(opened.text).toBe(undefined)
  })

  test('a stray /novel on the end of the path is left off, since it opens the file', async ($, on) => {
    const asked: string[] = []

    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    placed(on)
    on('fs.read', ($h, e) => {
      asked.push(e.path)

      if (e.path !== PATH) throw new Error('no such file')

      return { value: BOOK }
    })

    const opened = await $.command.run({ command: 'novel', args: `${PATH}/novel` })

    // the path as given was tried first (whatever the harness makes of its
    // separators), and the file was read from the path with the tail off
    expect(asked).toHaveLength(2)
    expect(asked[0]).not.toBe(PATH)
    expect(asked[1]).toBe(PATH)
    expect(opened.text).toBe(undefined)
  })

  test('a file whose name really ends in novel is not second-guessed', async ($, on) => {
    const asked: string[] = []

    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    placed(on)
    on('fs.read', ($h, e) => {
      asked.push(e.path)

      if (e.path !== 'D:\\books\\novel') throw new Error('no such file')

      return { value: BOOK }
    })

    expect((await $.command.run({ command: 'novel', args: 'D:\\books\\novel' })).text).toBe(undefined)
    // read once, as given: nothing was cut off its tail
    expect(asked).toEqual(['D:\\books\\novel'])
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
