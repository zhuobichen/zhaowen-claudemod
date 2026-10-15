/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  amountOf,
  ageOf,
  hourlyOf,
  hourlyTextOf,
  lineOf,
  readingOf,
  samplesOf,
  withSample,
} from '../hooks/balance'

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65', granted_balance: '0.00', topped_up_balance: '16.65' }],
})

const answerWith = (total: string) =>
  JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: total, granted_balance: '0.00', topped_up_balance: total }],
  })

const AT = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 3_600_000

/** The start of the hour that holds AT: the strip is built on these edges. */
const EDGE = Math.floor(AT / HOUR) * HOUR

const answered = { value: { status: 200, ok: true, headers: {}, text: ANSWER } }

/** The environment of a session pointed at DeepSeek, which is the one it speaks for. */
const DEEPSEEK = { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }

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

/** Waits for a later frame to carry the text: the answer lands after the first draw. */
const push = async (
  ui: { redraw: () => Promise<void>; find: (query: { text: RegExp }) => Promise<{ text?: string } | undefined> },
  re: RegExp,
) => {
  for (let i = 0; i < 20; i += 1) {
    const drawn = await ui.find({ text: re })

    if (drawn !== undefined) return drawn

    await Promise.resolve()
    await ui.redraw()
  }

  return undefined
}

describe('what one answer comes to', () => {
  test('a balance with its currency, and the number behind it', () => {
    const reading = readingOf(ANSWER, AT)

    expect(reading.kind).toBe('ok')
    expect(reading.amount).toBe('¥16.65')
    expect(reading.total).toBe(16.65)
    expect(reading.atMs).toBe(AT)
  })

  test('an account that reports nothing available is a reason, not a number', () => {
    const reading = readingOf(JSON.stringify({ is_available: false }), AT)

    expect(reading.kind).toBe('refused')
    expect(reading.amount).toBe(null)
    expect(reading.note).toContain('no available balance')
  })

  test('body that is not JSON is said to be that, never read as zero', () => {
    const reading = readingOf('<html>502 Bad Gateway</html>', AT)

    expect(reading.kind).toBe('failed')
    expect(reading.amount).toBe(null)
    expect(reading.note).toContain('not JSON')
  })

  test('a balance that is not a number is a reason too', () => {
    const reading = readingOf(answerWith('not-a-number'), AT)

    expect(reading.kind).toBe('failed')
    expect(reading.total).toBe(null)
    expect(reading.note).toContain('no balance')
  })

  test('an unknown currency keeps its code rather than guessing a symbol', () => {
    expect(amountOf('JPY', '1200')).toBe('1200 JPY')
    expect(amountOf(undefined, '5')).toBe('5')
  })
})

describe('the readings behind the strip', () => {
  test('junk in the store is dropped rather than summed', () => {
    expect(samplesOf('nonsense')).toEqual([])
    expect(samplesOf([{ atMs: 1, total: 2 }, { atMs: 'x' }, null, { atMs: 3 }])).toEqual([{ atMs: 1, total: 2 }])
  })

  test('a reading replaces one at the same moment, and old ones fall away', () => {
    const kept = withSample(
      [
        { atMs: AT - 30 * HOUR, total: 1 },
        { atMs: AT - MINUTE, total: 2 },
      ],
      { atMs: AT - MINUTE, total: 9 },
    )

    expect(kept).toEqual([{ atMs: AT - MINUTE, total: 9 }])
  })
})

describe('the hourly strip', () => {
  const now = EDGE + 5 * MINUTE

  test('an hour is the balance at its start less the balance at its end', () => {
    const samples = [
      { atMs: EDGE - 70 * MINUTE, total: 25 },
      { atMs: EDGE - 10 * MINUTE, total: 20 },
      { atMs: EDGE + 5 * MINUTE, total: 17.5 },
    ]

    // the last whole hour spent 5.00; the four before it were never watched
    expect(hourlyOf(samples, now)).toEqual([null, null, null, null, 5])
  })

  test('an unwatched hour is unknown, not zero', () => {
    const samples = [
      { atMs: EDGE - 5 * MINUTE, total: 30 },
      { atMs: EDGE + 5 * MINUTE, total: 28 },
    ]

    expect(hourlyOf(samples, now).at(-1)).toBe(null)
  })

  test('a reading too far from an edge does not stand for it', () => {
    const samples = [
      { atMs: EDGE - 80 * MINUTE, total: 30 },
      { atMs: EDGE - 5 * MINUTE, total: 28 },
    ]

    expect(hourlyOf(samples, now).at(-1)).toBe(null)
  })

  test('a top-up reads as the balance rising, not as negative spending', () => {
    const samples = [
      { atMs: EDGE - 70 * MINUTE, total: 5 },
      { atMs: EDGE - 10 * MINUTE, total: 20 },
    ]

    expect(hourlyOf(samples, now).at(-1)).toBe(-15)
    expect(hourlyTextOf(hourlyOf(samples, now))).toContain('+15.00')
  })

  test('the strip spells out what it does not know', () => {
    expect(hourlyTextOf([null, 0, 0.34, -15, 5])).toBe('· 5h ? 0.00 0.34 +15.00 5.00')
    expect(hourlyTextOf([])).toBe('')
  })
})

describe('the line above the prompt', () => {
  test('carries the amount and how old the reading is', () => {
    expect(lineOf(readingOf(ANSWER, AT), AT + 3 * MINUTE)).toBe('DeepSeek ¥16.65 · 3m ago')
  })

  test('says a reading is too fresh to age', () => {
    expect(ageOf(AT, AT + 20_000)).toBe('just now')
  })

  test('carries the strip when there are hours to show', () => {
    const reading = { ...readingOf(ANSWER, AT), hours: [null, 0.34, 0, null, 5] }

    expect(lineOf(reading, AT + 3 * MINUTE)).toBe('DeepSeek ¥16.65 · 3m ago · 5h ? 0.34 0.00 ? 5.00')
  })

  test('keeps the last good number and its hours when a refresh fails', () => {
    const kept = { ...readingOf(ANSWER, AT), kind: 'failed' as const, note: 'HTTP 500', hours: [null, null, 1, 2, 3] }
    const line = lineOf(kept, AT + 12 * MINUTE)

    expect(line).toContain('¥16.65')
    expect(line).toContain('12m ago')
    expect(line).toContain('HTTP 500')
    expect(line).toContain('· 5h ? ? 1.00 2.00 3.00')
  })

  test('with no key it names the variables it looked in', () => {
    const note = 'no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY'
    const line = lineOf({ kind: 'no-key', amount: null, total: null, atMs: AT, note, hours: [] }, AT)

    expect(line).toContain('DEEPSEEK_API_KEY')
    expect(line).toContain('ANTHROPIC_AUTH_TOKEN')
  })
})

describe('the meter in a session', () => {
  test('draws the balance it read', async ($, on) => {
    mock.clock(on, { now: AT })
    mock.env(on, { ...DEEPSEEK, ANTHROPIC_AUTH_TOKEN: 'sk-test-key' })
    on('http.fetch', () => answered)
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    // the first frame can land before the answer does; the state write redraws it
    const drawn = await push(ui, /¥16\.65/)

    expect(drawn?.text).toContain('¥16.65')

    // the row that was already there is kept, not swallowed: this is what lets
    // another meter draw at the same spot
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('draws the strip the kept readings add up to', async ($, on) => {
    mock.clock(on, { now: EDGE + 5 * MINUTE })
    mock.env(on, { ...DEEPSEEK, ANTHROPIC_AUTH_TOKEN: 'sk-test-key' })
    // readings from before this session: the store is how the strip survives one
    mock.store(on, {
      samples: [
        { atMs: EDGE - 70 * MINUTE, total: 25 },
        { atMs: EDGE - 10 * MINUTE, total: 20 },
        { atMs: EDGE + 5 * MINUTE, total: 17.5 },
      ],
    })
    on('http.fetch', () => ({ value: { ...answered.value, text: answerWith('17.50') } }))
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    const drawn = await push(ui, /· 5h/)

    expect(drawn?.text).toContain('¥17.50')
    expect(drawn?.text).toContain('· 5h ? ? ? ? 5.00')
    await ui.unmount()
  })

  test('says which variable is missing when no key is set', async ($, on) => {
    mock.clock(on, { now: AT })
    mock.env(on, DEEPSEEK)
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    const drawn = await push(ui, /DEEPSEEK_API_KEY/)

    expect(drawn?.text).toContain('DEEPSEEK_API_KEY')
    await ui.unmount()
  })

  test('over a survey the engine draws its own row', async ($, on) => {
    mock.clock(on, { now: AT })
    mock.env(on, { ...DEEPSEEK, ANTHROPIC_AUTH_TOKEN: 'sk-test-key' })
    on('http.fetch', () => answered)
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: true },
    })

    expect(await ui.find({ text: /DeepSeek/ })).toBe(undefined)
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('a session pointed elsewhere stays quiet, and asks DeepSeek nothing', async ($, on) => {
    let asked = false

    mock.clock(on, { now: AT })
    mock.env(on, {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_AUTH_TOKEN: 'sk-ant-something',
    })
    on('http.fetch', () => {
      asked = true

      return answered
    })
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    await ui.redraw()

    expect(await ui.find({ text: /DeepSeek/ })).toBe(undefined)
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    expect(asked).toBe(false)
    await ui.unmount()
  })
})
