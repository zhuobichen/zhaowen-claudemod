import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { BALANCE_URL, INITIAL, KEY_VARS, lineOf, readingOf, REFRESH_MS } from './balance'
import type { Reading } from '../types'

// deepseek-balance: the account's balance as one line above the prompt, read
// from DeepSeek's own endpoint every five minutes and by `/balance`.
//
// Claude Code's `session.usage()` carries the plan windows of a subscription;
// an API-key session pointed at DeepSeek reports none of them, which is why
// this meter asks DeepSeek instead. The key is the session's own: it is the
// Anthropic-compatible one Claude Code was configured with, read at call time
// and never kept, logged or drawn.

const reading = atom({ plugin: 'deepseek-balance', key: 'reading' } as const, INITIAL)

/** Runs `work`, and answers null when it throws. */
const quietly = async <T,>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work()
  } catch {
    return null
  }
}

/**
 * Whether this session is the one the meter speaks for.
 *
 * A session pointed at another endpoint has no DeepSeek balance to show, and
 * saying "no key found" there would be noise about a thing that was never
 * meant to work: it stays quiet instead, and makes no request.
 */
const speaksForSession = async ($: EngineInterface): Promise<boolean> => {
  const baseUrl = await quietly(() => $.env.get('ANTHROPIC_BASE_URL'))

  return /deepseek/i.test(baseUrl ?? '')
}

/**
 * The key, or null when none is set.
 *
 * The two names are spelled out rather than looped over: `$.env.get` takes a
 * literal at the call site, so that a module's reads can be listed. `KEY_VARS`
 * is the same list, for the wording.
 */
const keyOf = async ($: EngineInterface): Promise<string | null> => {
  const session = await quietly(() => $.env.get('ANTHROPIC_AUTH_TOKEN'))

  if (session !== null && session !== undefined && session !== '') return session

  const dedicated = await quietly(() => $.env.get('DEEPSEEK_API_KEY'))

  return dedicated === null || dedicated === undefined || dedicated === '' ? null : dedicated
}

let isSampling = false

/**
 * Reads the balance and keeps the reading. One sample at a time: the timer and
 * a render can both ask, and the second ask rides the first.
 */
async function sample($: EngineInterface): Promise<void> {
  if (isSampling) return
  if (!(await speaksForSession($))) return

  isSampling = true

  try {
    const nowMs = (await quietly(() => $.clock.now())) ?? 0
    const previous = await quietly(() => read($, reading))

    const key = await keyOf($)

    if (key === null) {
      await update($, reading, () => ({
        kind: 'no-key',
        amount: null,
        atMs: nowMs,
        note: `no key in ${KEY_VARS.join(' or ')}`,
      }))

      return
    }

    const response = await quietly(() =>
      $.http.fetch(BALANCE_URL, { headers: { Authorization: `Bearer ${key}` } }),
    )

    const next: Reading =
      response === null
        ? { kind: 'failed', amount: null, atMs: nowMs, note: 'the request failed' }
        : response.ok
          ? readingOf(response.text, nowMs)
          : { kind: 'failed', amount: null, atMs: nowMs, note: `HTTP ${response.status}` }

    // A refresh that fails never erases a number that was good: it keeps the
    // amount and the *time it was read*, so the age beside it says how old the
    // figure is rather than passing it off as fresh.
    await update($, reading, () =>
      next.kind === 'failed' && previous?.kind === 'ok'
        ? { ...next, amount: previous.amount, atMs: previous.atMs }
        : next,
    )
  } finally {
    isSampling = false
  }
}

/** The line as it stands now. */
const currentLineOf = async ($: EngineInterface, fallbackMs: number): Promise<string> =>
  lineOf(await read($, reading), (await quietly(() => $.clock.now())) ?? fallbackMs)

export const register: Register = on => {
  let tick: Timer | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    if (!(await speaksForSession($))) return result

    await quietly(() =>
      $.command.register({
        name: 'balance',
        description: 'DeepSeek balance: read it again now and show what the last answer said (deepseek-balance)',
      }),
    )

    await sample($)

    if (tick === null) {
      try {
        tick = $.clock.every(REFRESH_MS, () => {
          void sample($)
        })
      } catch {
        // without the timer the line still refreshes on every mount and on /balance
      }
    }

    return result
  })

  on('command.run', { command: 'balance' }, async ($, e, next) => {
    await sample($)

    return { text: await currentLineOf($, 0) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Nothing to say over a survey, and nothing before the first reading: the
    // line appears once there is a number or a reason there is not one. A
    // session whose `session.start` hook did not run a first sample (a reload,
    // or a host that starts the module another way) gets one here.
    if (e.props.hasSurvey) return next(e)
    if (!(await speaksForSession($))) return next(e)

    const readingNow = await read($, reading)

    if (readingNow.atMs === 0 && readingNow.kind === 'pending') {
      void sample($)

      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    // Another meter draws at this same spot (the context window, a turn's
    // counters). Returning a tree without `next(e)` would draw it instead of
    // that row and swallow it, so the plugins beneath are asked for their tree
    // and it is kept, with this line under it.
    const inner = await next(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Text dimColor>{lineOf(readingNow, (await quietly(() => $.clock.now())) ?? readingNow.atMs)}</Text>
      </Box>
    )
  })
}
