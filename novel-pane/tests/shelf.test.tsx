/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

// The shelf as a line of the conversation, rather than a pane: `/novel list`.
// Tested apart from the pane because it is the road that works where a pane
// cannot be seen at all — a headless run — and because it is what proves, on a
// real machine, that `$.fs.list` answers.

const DIR = 'D:\\books'

const LISTING = [
  { name: '乙书.txt', kind: 'file', size: 100 },
  { name: '甲书.txt', kind: 'file', size: 100 },
  { name: '封面.png', kind: 'file', size: 100 },
  { name: '子目录', kind: 'dir' },
]

type Engine = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]

const listing = (on: On, value: unknown = LISTING): void => {
  on('fs.list', ((() => ({ value })) as never))
}

describe('the shelf as a line', () => {
  test('names the readable files and leaves the rest out', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    listing(on)

    const asked = await $.command.run({ command: 'novel', args: `list ${DIR}` })

    expect(asked.text).toContain(`${DIR}（2 本）`)
    expect(asked.text).toContain('甲书.txt')
    expect(asked.text).toContain('乙书.txt')
    expect(asked.text).not.toContain('封面.png')
    expect(asked.text).not.toContain('子目录')
  })

  test('remembers the directory it was given, so the next list needs no argument', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    listing(on)

    await $.command.run({ command: 'novel', args: `list ${DIR}` })

    const again = await $.command.run({ command: 'novel', args: 'list' })

    expect(again.text).toContain(`${DIR}（2 本）`)
  })

  test('with no directory anywhere it says how to set one', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})

    const asked = await $.command.run({ command: 'novel', args: 'list' })

    expect(asked.text).toContain('/novel list <目录>')
  })

  test('a directory with nothing readable says that, and names it', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    listing(on, [{ name: '封面.png', kind: 'file' }])

    const asked = await $.command.run({ command: 'novel', args: `list ${DIR}` })

    expect(asked.text).toContain('没有能读的文件')
    expect(asked.text).toContain(DIR)
  })

  test('a directory that cannot be listed reads as empty rather than throwing', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('fs.list', (() => {
      throw new Error('no such directory')
    }) as never)

    const asked = await $.command.run({ command: 'novel', args: `list ${DIR}` })

    expect(asked.text).toContain('没有能读的文件')
  })
})
