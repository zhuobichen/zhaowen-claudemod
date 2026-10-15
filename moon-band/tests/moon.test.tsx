/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

import { instantsOf, lineOf, moonAt, poemAt, poemIndexAt, poemsOf, POEMS, POEM_SLOT_MS } from '../hooks/moon'

const HOUR = 3_600_000
const DAY = 86_400_000

const TABLE = instantsOf()
const FIRST = TABLE[0]
const LAST = TABLE[TABLE.length - 1]
/** The new moon and the first quarter that follow it — the two the tests lean on. */
const NEW_MOON = TABLE[1]
const FIRST_QUARTER = TABLE[2]

/**
 * The engine answers `ui.render` for a quiet line; a test has to stand in for
 * it, or the mod's `next(e)` lands on nothing.
 */
const standIn = (on: Parameters<Parameters<typeof test>[1]>[1]): void => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>the prompt's own row</Text>
  })
}

describe('the phase table', () => {
  test('steps a quarter of a cycle at a time, forward, with gaps a lunation has', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(12)

    for (let i = 1; i < TABLE.length; i += 1) {
      const gapDays = (TABLE[i] - TABLE[i - 1]) / DAY

      expect(gapDays).toBeGreaterThan(6.5)
      expect(gapDays).toBeLessThan(8.5)
    }
  })

  test('is read as quarters, so it can only be edited whole', () => {
    TABLE.forEach((at, i) => {
      const moon = moonAt(at)

      expect(moon.isEstimated).toBe(false)
      expect(Math.abs(moon.fraction - ((0.75 + i / 4) % 1))).toBeLessThan(1e-9)
    })
  })
})

describe('the phase', () => {
  test('names the instant it was published for', () => {
    expect(moonAt(NEW_MOON).name).toBe('新月')
    expect(moonAt(FIRST_QUARTER).name).toBe('上弦月')
    expect(moonAt(TABLE[3]).name).toBe('满月')
  })

  test('is a crescent halfway between the new moon and the first quarter', () => {
    const between = moonAt(NEW_MOON + (FIRST_QUARTER - NEW_MOON) / 2)

    expect(between.name).toBe('娥眉月')
    expect(between.ageDays).toBeGreaterThan(3)
    expect(between.ageDays).toBeLessThan(5)
  })

  test('the age is the days since the new moon, not a share of a mean month', () => {
    // this lunation runs long — 8.0 days from new moon to first quarter — so a
    // share of the mean month would read 4.1 where the calendar reads 4.5
    const fourAndAHalfDaysIn = NEW_MOON + 4.5 * DAY
    const moon = moonAt(fourAndAHalfDaysIn)

    expect(moon.ageDays).toBeGreaterThan(4.4)
    expect(moon.ageDays).toBeLessThan(4.6)
    expect(moon.name).toBe('娥眉月')
  })

  test('the age counts from the last new moon, so it keeps growing all month', () => {
    const ages = [0, 3, 7, 14, 21].map(days => moonAt(NEW_MOON + days * DAY).ageDays)

    for (let i = 1; i < ages.length; i += 1) expect(ages[i]).toBeGreaterThan(ages[i - 1])
  })

  test('outside the table it says it is estimating, rather than passing a mean off as the moon', () => {
    expect(moonAt(FIRST - 7 * DAY).isEstimated).toBe(true)
    expect(moonAt(LAST + 7 * DAY).isEstimated).toBe(true)
    expect(lineOf(FIRST - 7 * DAY).startsWith('≈')).toBe(true)
    expect(lineOf(NEW_MOON).startsWith('≈')).toBe(false)
  })

  test('keeps moving past the end of the table', () => {
    const early = moonAt(LAST + 3 * DAY)
    const later = moonAt(LAST + 10 * DAY)

    expect(later.fraction).not.toBe(early.fraction)
    expect(Math.abs(later.fraction - early.fraction)).toBeGreaterThan(0.1)
  })
})

describe('the poem', () => {
  const COUNT = POEMS.length
  const cycleOf = (cycle: number): number[] =>
    Array.from({ length: COUNT }, (_, i) => poemIndexAt(cycle * COUNT + i, COUNT))

  test('the same line all minute, a different one the next', () => {
    const slot = Math.floor(NEW_MOON / POEM_SLOT_MS) * POEM_SLOT_MS
    const thisOne = poemAt(slot)

    expect(poemAt(slot)).toEqual(thisOne)
    expect(poemAt(slot + POEM_SLOT_MS - 1)).toEqual(thisOne)
    expect(poemAt(slot + POEM_SLOT_MS)).not.toEqual(thisOne)
  })

  test('one cycle shows every line exactly once, and the next does too', () => {
    for (const cycle of [0, 1, 7, 12345]) {
      const seen = [...cycleOf(cycle)].sort((a, b) => a - b)

      expect(seen).toEqual(Array.from({ length: COUNT }, (_, i) => i))
    }
  })

  test('the next cycle is a different order, not the same round again', () => {
    expect(cycleOf(1)).not.toEqual(cycleOf(0))
    expect(cycleOf(2)).not.toEqual(cycleOf(1))
  })

  test('inside a cycle no slot repeats the one before it', () => {
    for (const cycle of [0, 3, 999]) {
      const order = cycleOf(cycle)

      for (let i = 1; i < order.length; i += 1) expect(order[i]).not.toBe(order[i - 1])
    }
  })

  test('walks the corpus in a shuffled order rather than file order', () => {
    const order = cycleOf(0)

    expect(order.some((one, i) => one !== (order[0] + i) % COUNT)).toBe(true)
  })

  test('every built-in line carries its source', () => {
    for (const poem of POEMS) {
      expect(poem.line.length).toBeGreaterThan(4)
      expect(poem.from.length).toBeGreaterThan(2)
    }
  })
})

describe('the corpus that ships', () => {
  test('reads line and source, and drops what has neither', () => {
    const text = [
      '海上生明月，天涯共此时。\t张九龄《望月怀远》',
      '',
      '只有句子没有制表符',
      '有句子但没出处\t',
      '\t只有出处没有句子',
      '  ',
    ].join('\n')

    expect(poemsOf(text)).toEqual([{ line: '海上生明月，天涯共此时。', from: '张九龄《望月怀远》' }])
  })

  test('drops a line that appears twice, so a cycle keeps its promise', () => {
    const text = 'A\t甲《一》\nA\t乙《二》\nB\t丙《三》'

    expect(poemsOf(text).map(one => one.line)).toEqual(['A', 'B'])
  })

  test('a corpus of its own is what gets drawn', () => {
    const corpus = [
      { line: '甲句甲句甲句', from: '甲《一》' },
      { line: '乙句乙句乙句', from: '乙《二》' },
      { line: '丙句丙句丙句', from: '丙《三》' },
    ]
    const drawn = new Set([
      poemAt(NEW_MOON, corpus).line,
      poemAt(NEW_MOON + POEM_SLOT_MS, corpus).line,
      poemAt(NEW_MOON + 2 * POEM_SLOT_MS, corpus).line,
    ])

    expect(drawn.size).toBe(3)
  })

  test('an empty corpus falls back rather than drawing nothing', () => {
    expect(poemAt(NEW_MOON, []).line.length).toBeGreaterThan(4)
  })
})

describe('the line above the prompt', () => {
  test('carries the phase, its age and where the line comes from', () => {
    const text = lineOf(NEW_MOON)

    expect(text).toContain('🌑')
    expect(text).toContain('新月')
    expect(text).toContain('天 · 「')
    expect(text).toContain(poemAt(NEW_MOON).from)
  })
})

describe('in a session', () => {
  test('draws the line, and keeps the row that was already there', async ($, on) => {
    mock.clock(on, { now: NEW_MOON })
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'moon-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    const drawn = await ui.find({ text: /新月/ })

    expect(drawn?.text).toContain(poemAt(NEW_MOON).from)
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('/moon takes it away and brings it back', async ($, on) => {
    mock.clock(on, { now: NEW_MOON })
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'moon-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    expect(await ui.find({ text: /新月/ })).not.toBe(undefined)

    await $.command.run({ command: 'moon' })
    await ui.redraw()
    expect(await ui.find({ text: /新月/ })).toBe(undefined)
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)

    await $.command.run({ command: 'moon' })
    await ui.redraw()
    expect(await ui.find({ text: /新月/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('draws a line from the corpus it ships, not from the eight built in', async ($, on) => {
    let asked = ''

    mock.clock(on, { now: NEW_MOON })
    standIn(on)
    on('fs.read', ($hook, e) => {
      asked = e.path

      // ten lines, because a corpus smaller than the built-in eight is taken for
      // a broken read rather than a corpus
      return { value: Array.from({ length: 10 }, (_, i) => `假语料旁第${i}句\t甲《伪造》`).join('\n') }
    })

    const ui = await $.ui.mount({
      plugin: 'moon-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    const drawn = await ui.find({ text: /假语料/ })

    expect(drawn?.text).toContain('假语料')
    // the engine hands the path to the hook with this host's separator
    expect(asked.replace(/\\/g, '/').endsWith('data/poems.txt')).toBe(true)
    expect(asked.includes('moon-band')).toBe(true)
    await ui.unmount()
  })

  test('over a survey the engine draws its own row', async ($, on) => {
    mock.clock(on, { now: NEW_MOON })
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'moon-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: true },
    })

    expect(await ui.find({ text: /新月/ })).toBe(undefined)
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    await ui.unmount()
  })
})
