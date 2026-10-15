/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

import { instantsOf, lineOf, moonAt, poemAt, POEMS } from '../hooks/moon'

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

  test('the age runs with the phase', () => {
    expect(moonAt(FIRST_QUARTER).ageDays).toBeGreaterThan(6)
    expect(moonAt(FIRST_QUARTER).ageDays).toBeLessThan(9)
    expect(moonAt(TABLE[3]).ageDays).toBeGreaterThan(14)
    expect(moonAt(TABLE[3]).ageDays).toBeLessThan(16)
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
  test('the same line all hour, a different one the next', () => {
    // from the top of an hour: the instants in the table sit at odd minutes,
    // and a sample ten minutes before the hour would cross it
    const top = Math.floor(NEW_MOON / HOUR) * HOUR
    const thisHour = poemAt(top)

    expect(poemAt(top)).toEqual(thisHour)
    expect(poemAt(top + HOUR - 1)).toEqual(thisHour)
    expect(poemAt(top + HOUR)).not.toEqual(thisHour)
  })

  test('comes round to every line', () => {
    const seen = new Set<string>()

    for (let i = 0; i < POEMS.length; i += 1) seen.add(poemAt(NEW_MOON + i * HOUR).line)

    expect(seen.size).toBe(POEMS.length)
  })

  test('every line carries its source', () => {
    for (const poem of POEMS) {
      expect(poem.line.length).toBeGreaterThan(4)
      expect(poem.from.length).toBeGreaterThan(2)
    }
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
