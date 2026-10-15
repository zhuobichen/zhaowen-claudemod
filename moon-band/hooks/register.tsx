import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { lineOf } from './moon'

// moon-band: the moon's phase and a line of poetry as one dim row above the
// prompt. Nothing here is load-bearing — it is decoration, and `/moon` takes it
// away for a while when a screen of prose is wanted instead.
//
// It wraps what `next(e)` resolved to rather than drawing the row itself, so
// whatever else draws at this spot (the context meter, the balance meter) is
// kept underneath it.

/**
 * A minute: the poem turns over every ten, and a line left on screen past its
 * slot would be a stale one. The redraw is a courtesy to the eye — a cached
 * answer drops anyway on the next turn.
 */
const REFRESH_MS = 60 * 1000
const HIDDEN_KEY = 'isHidden'

const isHidden = atom({ plugin: 'moon-band', key: 'isHidden' } as const, false)

/** Runs `work`, and answers null when it throws. */
const quietly = async <T,>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work()
  } catch {
    return null
  }
}

export const register: Register = on => {
  let tick: Timer | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await quietly(() => $.command.register({ name: 'moon', description: 'Hide or show the moon line (moon-band)' }))

    const wasHidden = await quietly(() => $.store.get(HIDDEN_KEY))

    if (wasHidden === true) await update($, isHidden, () => true)

    if (tick === null) {
      try {
        // keeps a long session's moon and poem from going stale
        tick = $.clock.every(REFRESH_MS, () => {
          try {
            $.ui.invalidate('ui.render')
          } catch {
            // the next redraw takes it
          }
        })
      } catch {
        // without the tick the line still redraws on every turn
      }
    }

    return result
  })

  on('command.run', { command: 'moon' }, async ($, e, next) => {
    const wasHidden = await read($, isHidden)

    await update($, isHidden, () => !wasHidden)
    await quietly(() => $.store.set(HIDDEN_KEY, !wasHidden))

    return { text: wasHidden ? 'moon line shown' : 'moon line hidden' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (await read($, isHidden)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const nowMs = (await quietly(() => $.clock.now())) ?? Date.now()
    const inner = await next(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Text dimColor wrap="truncate-end">
          {lineOf(nowMs)}
        </Text>
      </Box>
    )
  })
}
