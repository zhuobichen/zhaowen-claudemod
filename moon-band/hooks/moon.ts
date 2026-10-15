// The moon and the poem, with no engine calls in them, so a test can hold them
// to account without a session.
//
// The phase name is read off a table of published phase instants rather than
// from a mean-synodic-month formula, because that formula is not good enough to
// say a phase name: checked against October 2026's four instants it is out by up
// to 0.72 days, and no two-parameter fit does better than 0.75 — the Moon's
// motion is genuinely uneven.
//
// The age is not `fraction × mean month` either: it is the days since the last
// new moon the table knows, which is the number anyone can check against a
// lunar-calendar date.

/**
 * The phases, Beijing time (UTC+8), from StarWalk's phase calendar and the Hong
 * Kong Astronomical Society's 2026 table, which agree to a minute.
 *
 * **A strict quarter cycle**: consecutive entries are one quarter apart and the
 * gaps are 6.7–8.2 days (measured, and a test holds the table to that). Never
 * add an instant without its neighbours, and never reorder: the interpolation
 * reads these as evenly spaced quarters, not as dates, and the new moons are
 * found by counting every fourth entry from the first.
 */
const INSTANTS = [
  1791033900000, // 2026-10-03 21:25 下弦
  1791647400000, // 2026-10-10 23:50 新月（农历九月初一）
  1792339920000, // 2026-10-19 00:12 上弦
  1792987860000, // 2026-10-26 12:11 满月（猎人月）
  1793564880000, // 2026-11-02 04:28 下弦
  1794207720000, // 2026-11-09 15:02 新月
  1794916080000, // 2026-11-17 19:48 上弦
  1795531980000, // 2026-11-24 22:53 满月（超级海狸月）
  1796134080000, // 2026-12-01 22:08 下弦
  1796777520000, // 2026-12-09 08:52 新月
  1797486180000, // 2026-12-17 13:43 上弦
  1798075680000, // 2026-12-24 09:28 满月（2026 最后一次超级月亮）
  1798657140000, // 2026-12-31 02:59 下弦
]

/** The phase the table starts on: a last quarter, which is 0.75 of the cycle. */
const FIRST_PHASE = 0.75

/** How long a quarter of the cycle takes on average: the fallback's step. */
const QUARTER_MS = (29.530588853 / 4) * 86_400_000

const MEAN_MONTH_DAYS = 29.530588853
const DAY_MS = 86_400_000

/** How long the poem stays: the person asked for ten minutes. */
export const POEM_SLOT_MS = 10 * 60_000

export type Moon = {
  /** Where in the cycle: 0 the new moon, 0.5 the full moon, 1 the next new moon. */
  fraction: number
  /** Days since the last new moon — the number a lunar calendar would give. */
  ageDays: number
  /** The phase in Chinese. */
  name: string
  /** One emoji for the phase; the eight are the whole cycle in order. */
  glyph: string
  /** True when the phase is a mean-month estimate: outside the table. */
  isEstimated: boolean
}

const NAMES = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月']
const GLYPHS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

/** The last new moon the table knows at or before this instant, or null. */
const newMoonBefore = (nowMs: number): number | null => {
  let found: number | null = null

  // new moons are every fourth entry, the table opening on a last quarter
  for (let i = 1; i < INSTANTS.length; i += 4) {
    if (INSTANTS[i] <= nowMs) found = INSTANTS[i]
  }

  return found
}

/** The phase at an instant inside the table, or an estimate outside it. */
export const moonAt = (nowMs: number): Moon => {
  const first = INSTANTS[0]
  const last = INSTANTS[INSTANTS.length - 1]

  let fraction: number
  let isEstimated = false

  if (nowMs < first) {
    fraction = FIRST_PHASE - (first - nowMs) / QUARTER_MS / 4
    isEstimated = true
  } else if (nowMs > last) {
    fraction = FIRST_PHASE + (INSTANTS.length - 1) / 4 + (nowMs - last) / QUARTER_MS / 4
    isEstimated = true
  } else {
    let i = 0

    // stop one short: the instant *after* the last pair is the pair's own end,
    // and asking for it would read past the table
    while (i < INSTANTS.length - 2 && INSTANTS[i + 1] <= nowMs) i += 1

    const span = INSTANTS[i + 1] - INSTANTS[i]
    const through = (nowMs - INSTANTS[i]) / span

    fraction = FIRST_PHASE + (i + through) / 4
  }

  const wrapped = ((fraction % 1) + 1) % 1
  // the nearest of the eight names; `min` keeps the last band from rounding up
  // past `残月` into the new moon
  const octant = Math.min(7, Math.floor(wrapped * 8 + 0.5))

  // Days since the last new moon. The age is the elapsed time, not a share of a
  // mean month: this lunation runs long, and sharing a mean month understates it
  // by a third of a day. Past the last new moon the table holds the next one
  // arrives within a month, so an age older than that is counting on a new moon
  // nobody told this table about.
  const newMoon = newMoonBefore(nowMs)
  const sinceNewMoon = newMoon === null ? null : (nowMs - newMoon) / DAY_MS
  const isAgeTrue = sinceNewMoon !== null && sinceNewMoon < 30

  return {
    fraction: wrapped,
    ageDays: isAgeTrue ? sinceNewMoon : wrapped * MEAN_MONTH_DAYS,
    name: NAMES[octant],
    glyph: GLYPHS[octant],
    isEstimated,
  }
}

/**
 * The index a ten-minute slot picks, spread so the lines look shuffled rather
 * than cycling: a plain counter would walk 1, 2, 3 … all day.
 */
const shuffledIndex = (slot: number, count: number): number => {
  let x = Math.imul(slot, 2654435761) >>> 0

  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13

  // back to unsigned: `^` answers a signed 32-bit, and a negative here would
  // index off the front of the list
  return (x >>> 0) % count
}

/**
 * The lines this meter draws from.
 *
 * Each is a famous one and each carries its own source — several are one line of
 * a longer poem, so the title is the poem's, not the line's. Add to this list
 * only with the attribution checked.
 */
export const POEMS = [
  { line: '今人不见古时月，今月曾经照古人。', from: '李白《把酒问月》' },
  { line: '举杯邀明月，对影成三人。', from: '李白《月下独酌》' },
  { line: '海上生明月，天涯共此时。', from: '张九龄《望月怀远》' },
  { line: '江畔何人初见月？江月何年初照人？', from: '张若虚《春江花月夜》' },
  { line: '举头望明月，低头思故乡。', from: '李白《静夜思》' },
  { line: '深林人不知，明月来相照。', from: '王维《竹里馆》' },
  { line: '人有悲欢离合，月有阴晴圆缺，此事古难全。', from: '苏轼《水调歌头》' },
  { line: '嫦娥应悔偷灵药，碧海青天夜夜心。', from: '李商隐《嫦娥》' },
]

/**
 * The line for this ten minutes: picked by the slot, so it is the same one for
 * the whole slot — a line that changed between frames would be unreadable — and
 * a different one next, as chance falls. With eight lines, two slots in a row
 * land on the same one about once every eighty minutes: that is what a shuffle
 * does, and holding it to "never twice" would take state this mod has no reason
 * to keep.
 */
export const poemAt = (nowMs: number): { line: string; from: string } =>
  POEMS[shuffledIndex(Math.floor(nowMs / POEM_SLOT_MS), POEMS.length)]

/** The one line above the prompt. */
export const lineOf = (nowMs: number): string => {
  const moon = moonAt(nowMs)
  const poem = poemAt(nowMs)

  return `${moon.isEstimated ? '≈' : ''}${moon.glyph} ${moon.name} ${moon.ageDays.toFixed(1)}天 · 「${poem.line}」${poem.from}`
}

/** The table, for the test that holds it to being a quarter cycle. */
export const instantsOf = (): readonly number[] => INSTANTS
