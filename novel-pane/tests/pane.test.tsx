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

/** The store's writes are awaited inside a hook, past what a key press resolves. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

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

const openBook = async ($: Engine, on: On): Promise<{ text: string }> => {
  on('fs.read', () => ({ value: BOOK }))

  return $.command.run({ command: 'novel', args: PATH })
}

describe('the reader', () => {
  test('opens the file it was pointed at and draws the first page', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    const asked = await openBook($, on)

    expect(asked.text).toContain('试验小说.txt')

    const ui = await mountPane($)

    expect((await ui.find({ text: /第一章/, in: 'novel' }))?.text).toContain('第一章　夜航')
    expect(await ui.find({ text: /第 1\//, in: 'novel' })).not.toBe(undefined)
    await ui.unmount()
  })

  test('a key pressed in the pane turns the page', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)
    expect(await ui.find({ text: /第一章/, in: 'novel' })).not.toBe(undefined)

    // the whole chain: the pane's onKey posts, the hooks module answers with props
    await ui.key({ key: 'j', in: 'novel' })

    expect(await ui.find({ text: /第一章/, in: 'novel' })).toBe(undefined)
    expect(await ui.find({ text: /船在雾里走/, in: 'novel' })).not.toBe(undefined)
    await ui.unmount()
  })

  test('opens asking for the keys, so a space reaches the pane', async ($, on) => {
    let asked: Record<string, unknown> | null = null

    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('ui.open', ($h, e) => {
      asked = e as unknown as Record<string, unknown>

      return { value: { isPlaced: true } }
    })

    await openBook($, on)

    expect(asked?.focus).toBe(true)
  })

  test('a click in the lower half turns forward, the upper half back', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await openBook($, on)

    const ui = await mountPane($)

    await ui.pointer({ type: 'down', x: 0, y: 18, button: 'left', in: 'novel' } as never)
    expect(await ui.find({ text: /第 2\//, in: 'novel' })).not.toBe(undefined)

    await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'novel' } as never)
    expect(await ui.find({ text: /第 1\//, in: 'novel' })).not.toBe(undefined)
    await ui.unmount()
  })

  test('/novel with no argument while it is open says what became of the keys', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await openBook($, on)

    const said = await $.command.run({ command: 'novel', args: '' })

    // a test session has no focus ring, so what can be held to here is that the
    // answer is about the pane either way — never a silent "done". The hand-back
    // itself needs a real session, where it was watched by hand.
    expect(said.text).toContain('窗格')
    expect(said.text.length).toBeGreaterThan(4)
  })

  test('a space turns a whole page', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    await openBook($, on)

    const ui = await mountPane($)
    await ui.key({ key: ' ', in: 'novel' })

    expect(await ui.find({ text: /第 2\//, in: 'novel' })).not.toBe(undefined)
    await ui.unmount()
  })

  test('closing keeps the place, and reopening comes back to it', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    await openBook($, on)

    const ui = await mountPane($)
    await ui.key({ key: 'j', in: 'novel' })
    await ui.key({ key: 'q', in: 'novel' })
    await settle()
    await ui.unmount()

    // the same store answers the next open, with no path given: the place is real
    const reopened = await $.command.run({ command: 'novel', args: '' })

    expect(reopened.text).toContain('试验小说.txt')

    const again = await mountPane($)

    expect(await again.find({ text: /第一章/, in: 'novel' })).toBe(undefined)
    expect(await again.find({ text: /船在雾里走/, in: 'novel' })).not.toBe(undefined)
    await again.unmount()
  })

  test('/novel with no argument reopens the book last read', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, { lastPath: PATH, places: { [PATH]: 2 } })
    on('fs.read', () => ({ value: BOOK }))

    const asked = await $.command.run({ command: 'novel', args: '' })

    expect(asked.text).toContain('试验小说.txt')

    const ui = await mountPane($)

    // where it was left: two lines in, so the title is off the top
    expect(await ui.find({ text: /第一章/, in: 'novel' })).toBe(undefined)
    expect(await ui.find({ text: /船在雾里走/, in: 'novel' })).not.toBe(undefined)
    await ui.unmount()
  })

  // The other half — that opening a book *writes* it down as the one to reopen —
  // cannot be watched from a test: `$.store` is not on the test's `$`, and the
  // mock's own `store.set` answers before a hook of the test's could. It is
  // checked against the real thing instead: `/novel <path>` in one session, then
  // `/novel` in another, which reopened the same book and left this in the store
  //
  //   {"places": {"<path>": 0}, "lastPath": "<path>"}

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

  test('says when the pane was not placed, rather than reporting a page nobody can see', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => ({ value: BOOK }))
    on('ui.open', () => ({ value: { isPlaced: false, reason: '窗口太窄' } }))

    const opened = await $.command.run({ command: 'novel', args: PATH })

    expect(opened.text).toContain('没能摆出来')
    expect(opened.text).toContain('窗口太窄')
  })

  test('an empty file is called that, not opened as a blank pane', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => ({ value: '   \n\n  ' }))

    const said = await $.command.run({ command: 'novel', args: PATH })

    expect(said.text).toContain('是空的')
  })

  test('says so when the file cannot be read, instead of opening an empty pane', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.read', () => {
      throw new Error('no such file')
    })

    const asked = await $.command.run({ command: 'novel', args: 'D:\\books\\没有这本.txt' })

    expect(asked.text).toContain('读不到')
  })

  test('with nothing remembered and no path it says how to use it', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    const asked = await $.command.run({ command: 'novel', args: '' })

    expect(asked.text).toContain('/novel')
  })
})
