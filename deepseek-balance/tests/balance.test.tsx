/* @jsx h */
import { describe, expect, mock, test } from 'claude-code/testing'

import { amountOf, ageOf, lineOf, readingOf } from '../hooks/balance'

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65', granted_balance: '0.00', topped_up_balance: '16.65' }],
})

const AT = 1_700_000_000_000
const MINUTE = 60_000

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

describe('what one answer comes to', () => {
  test('a balance with its currency', () => {
    const reading = readingOf(ANSWER, AT)

    expect(reading.kind).toBe('ok')
    expect(reading.amount).toBe('¥16.65')
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

  test('an unknown currency keeps its code rather than guessing a symbol', () => {
    expect(amountOf('JPY', '1200')).toBe('1200 JPY')
    expect(amountOf(undefined, '5')).toBe('5')
  })
})

describe('the line above the prompt', () => {
  test('carries the amount and how old the reading is', () => {
    expect(lineOf(readingOf(ANSWER, AT), AT + 3 * MINUTE)).toBe('DeepSeek ¥16.65 · 3m ago')
  })

  test('says a reading is too fresh to age', () => {
    expect(ageOf(AT, AT + 20_000)).toBe('just now')
  })

  test('keeps the last good number when a refresh fails, and ages it honestly', () => {
    const kept = { ...readingOf(ANSWER, AT), kind: 'failed' as const, note: 'HTTP 500' }
    const line = lineOf(kept, AT + 12 * MINUTE)

    expect(line).toContain('¥16.65')
    expect(line).toContain('12m ago')
    expect(line).toContain('HTTP 500')
  })

  test('with no key it names the variables it looked in', () => {
    const note = 'no key in DEEPSEEK_API_KEY or ANTHROPIC_AUTH_TOKEN'
    const line = lineOf({ kind: 'no-key', amount: null, atMs: AT, note }, AT)

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
    let drawn = await ui.find({ text: /¥16\.65/ })

    for (let i = 0; i < 20 && drawn === undefined; i += 1) {
      await Promise.resolve()
      await ui.redraw()
      drawn = await ui.find({ text: /¥16\.65/ })
    }

    expect(drawn?.text).toContain('¥16.65')

    // the row that was already there is kept, not swallowed: this is what lets
    // another meter draw at the same spot
    expect(await ui.find({ text: /the prompt's own row/ })).not.toBe(undefined)
    await ui.unmount()
  })

  test('draws whatever the answer said, not a figure of its own', async ($, on) => {
    mock.clock(on, { now: AT })
    mock.env(on, { ...DEEPSEEK, ANTHROPIC_AUTH_TOKEN: 'sk-test-key' })
    on('http.fetch', () => ({
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: 'USD', total_balance: '4.20', granted_balance: '0.00', topped_up_balance: '4.20' }],
        }),
      },
    }))
    standIn(on)

    const ui = await $.ui.mount({
      plugin: 'deepseek-balance',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {},
    })

    let drawn = await ui.find({ text: /\$4\.20/ })

    for (let i = 0; i < 20 && drawn === undefined; i += 1) {
      await Promise.resolve()
      await ui.redraw()
      drawn = await ui.find({ text: /\$4\.20/ })
    }

    expect(drawn?.text).toContain('$4.20')
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

    let drawn = await ui.find({ text: /DEEPSEEK_API_KEY/ })

    for (let i = 0; i < 20 && drawn === undefined; i += 1) {
      await Promise.resolve()
      await ui.redraw()
      drawn = await ui.find({ text: /DEEPSEEK_API_KEY/ })
    }

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
