// The numbers and the wording, with no engine calls in them, so a test can
// hold them to account without a session.
//
// Nothing here invents a figure: a reading the meter could not take comes back
// as the reason it could not, and the line says that.

import type { Reading } from '../types'

/** DeepSeek's own balance endpoint, the one its console reads. */
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * Where the key is looked for, in order. The session's own key is the one this
 * bills, so it comes first: a session pointed at DeepSeek keeps it in
 * `ANTHROPIC_AUTH_TOKEN` (Claude Code's variable, set in settings `env`), and
 * `DEEPSEEK_API_KEY` is the fallback for when only that one is set.
 */
export const KEY_VARS = ['ANTHROPIC_AUTH_TOKEN', 'DEEPSEEK_API_KEY'] as const

/** How long between refreshes: the balance moves slowly, and each one is a request. */
export const REFRESH_MS = 5 * 60 * 1000

export const INITIAL: Reading = { kind: 'pending', amount: null, atMs: 0, note: null }

/** What DeepSeek answers, to the extent this meter reads it. */
type Payload = {
  is_available?: boolean
  balance_infos?: { currency?: string; total_balance?: string }[]
}

/** The amount with its currency, as DeepSeek spells it; an unknown code keeps the code. */
export const amountOf = (currency: string | undefined, total: string): string => {
  if (currency === 'CNY') return `¥${total}`
  if (currency === 'USD') return `$${total}`

  return currency === undefined || currency === '' ? total : `${total} ${currency}`
}

/** What one answer comes to, or why it is not a balance. */
export const readingOf = (body: string, atMs: number): Reading => {
  let payload: Payload

  try {
    payload = JSON.parse(body) as Payload
  } catch {
    return { kind: 'failed', amount: null, atMs, note: 'the answer was not JSON' }
  }

  if (payload.is_available === false) {
    return { kind: 'refused', amount: null, atMs, note: 'the account reports no available balance' }
  }

  const info = payload.balance_infos?.[0]

  if (info?.total_balance === undefined) {
    return { kind: 'failed', amount: null, atMs, note: 'the answer named no balance' }
  }

  return { kind: 'ok', amount: amountOf(info.currency, info.total_balance), atMs, note: null }
}

/** How long ago a reading was taken, in the shortest form that still reads as English. */
export const ageOf = (atMs: number, nowMs: number): string => {
  const minutes = Math.round((nowMs - atMs) / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)

  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

/** The one line above the prompt. */
export const lineOf = (reading: Reading, nowMs: number): string => {
  switch (reading.kind) {
    case 'pending':
      return 'DeepSeek balance: reading…'
    case 'no-key':
    case 'refused':
      return `DeepSeek balance: ${reading.note ?? 'not available'}`
    case 'failed':
      return reading.amount === null
        ? `DeepSeek balance: ${reading.note ?? 'the request failed'}`
        : `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)} · refresh failed: ${reading.note ?? 'unknown'}`
    case 'ok':
      return `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)}`
  }
}
