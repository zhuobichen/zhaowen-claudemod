/* @jsx h */
import { describe, expect, test } from 'claude-code/testing'

import {
  ABOUT_LIMIT,
  ABOUT_PREFIX,
  aboutEvictionsOf,
  aboutKeyOf,
  aboutLinesOf,
  aboutParse,
  aboutPromptOf,
  describeReply,
  replyTextOf,
} from '../hooks/about'
import { dynastyOf, dynastyTableSize } from '../hooks/dynasty'
import { sourceParts } from '../hooks/moon'

const GOOD = JSON.stringify({
  dynasty: '唐',
  year: '约 725 年（开元十三年）',
  meaning: '游子抬头看见月亮，低头就想起了故乡。',
  background: '李白二十六岁客居扬州，秋夜独处，思乡而作。',
})

describe('详解的解析', () => {
  test('正常 JSON 就照收', () => {
    const about = aboutParse(GOOD, 123)

    expect(about?.dynasty).toBe('唐')
    expect(about?.year).toBe('约 725 年（开元十三年）')
    expect(about?.meaning).toContain('故乡')
    expect(about?.background).toContain('扬州')
    expect(about?.atMs).toBe(123)
  })

  test('套了代码围栏也能解', () => {
    expect(aboutParse('```json\n' + GOOD + '\n```', 1)?.dynasty).toBe('唐')
  })

  test('前后多说了几句也能解', () => {
    expect(aboutParse(`好的，这是解读：\n${GOOD}\n希望有帮助。`, 1)?.dynasty).toBe('唐')
  })

  test('模型没给朝代/年份时留 null，不编', () => {
    const about = aboutParse(JSON.stringify({ meaning: '甲', background: '乙' }), 1)

    expect(about?.dynasty).toBe(null)
    expect(about?.year).toBe(null)
  })

  test('不是 JSON 就返回 null（这次不写缓存）', () => {
    expect(aboutParse('抱歉我无法回答', 1)).toBe(null)
    expect(aboutParse('', 1)).toBe(null)
  })

  test('连正文都没有的 JSON 也算失败', () => {
    expect(aboutParse('{"dynasty":"唐"}', 1)).toBe(null)
  })

  test('面板要画的那几行', () => {
    const about = aboutParse(GOOD, 1)!
    const lines = aboutLinesOf(about)

    expect(lines[0]).toBe('唐 · 约 725 年（开元十三年）')
    expect(lines[1]).toContain('诗意：')
    expect(lines[2]).toContain('背景：')
  })

  test('没有朝代年份时第一行就不占位', () => {
    const about = aboutParse(JSON.stringify({ meaning: '甲', background: '乙' }), 1)!

    expect(aboutLinesOf(about).length).toBe(2)
    expect(aboutLinesOf(about)[0]).toContain('诗意：')
  })
})

describe('问模型的措辞', () => {
  test('诗句和出处都带上，并且要纯 JSON', () => {
    const { system, prompt } = aboutPromptOf('举头望明月', '李白《静夜思》')

    expect(prompt).toContain('举头望明月')
    expect(prompt).toContain('李白《静夜思》')
    expect(system).toContain('JSON')
    expect(system).toContain('dynasty')
  })
})

describe('缓存的键与淘汰', () => {
  test('键带前缀，同一句得同一个键', () => {
    expect(aboutKeyOf('举头望明月')).toBe(`${ABOUT_PREFIX}举头望明月`)
    expect(aboutKeyOf('举头望明月')).toBe(aboutKeyOf(' 举头望明月 '))
  })

  test('没超上限就不删', () => {
    const keys = ['a', `${ABOUT_PREFIX}一`, `${ABOUT_PREFIX}二`]

    expect(aboutEvictionsOf(keys, 2)).toEqual([])
  })

  test('超了就删最早的，且只删详解的键', () => {
    const keys = ['isHidden', `${ABOUT_PREFIX}一`, 'other', `${ABOUT_PREFIX}二`, `${ABOUT_PREFIX}三`]

    expect(aboutEvictionsOf(keys, 2)).toEqual([`${ABOUT_PREFIX}一`])
  })

  test('上限是个正数', () => {
    expect(ABOUT_LIMIT > 0).toBe(true)
  })
})

describe('朝代', () => {
  test('高频的唐人认得', () => {
    expect(dynastyOf('白居易')).toBe('唐')
    expect(dynastyOf('杜甫')).toBe('唐')
    expect(dynastyOf('李白')).toBe('唐')
  })

  test('宋人不会被当成唐人', () => {
    expect(dynastyOf('苏轼')).toBe('宋')
    expect(dynastyOf('辛弃疾')).toBe('宋')
    expect(dynastyOf('李清照')).toBe('宋')
  })

  test('不知道就说不知道，不猜', () => {
    expect(dynastyOf('无名氏')).toBe(null)
    expect(dynastyOf('某个不存在的诗人')).toBe(null)
    expect(dynastyOf('')).toBe(null)
  })

  test('表够大，值得维护', () => {
    expect(dynastyTableSize() >= 100).toBe(true)
  })
})

describe('出处的拆分', () => {
  test('作者和篇名分开', () => {
    expect(sourceParts('李白《把酒问月》')).toEqual({ author: '李白', title: '把酒问月' })
  })

  test('没有书名号就整串当作者', () => {
    expect(sourceParts('不详')).toEqual({ author: '不详', title: null })
  })
})

// 这一组是踩出来的：类型上 `$.model.complete` 答应回 string，实际回来过非字符串，
// 于是 `text.trim()` 直接炸，按钮和 /poem 都只吐一句 "text.trim is not a function"。
describe('模型回复不是字符串时', () => {
  test('裸字符串', () => {
    expect(replyTextOf(GOOD)).toBe(GOOD)
  })

  test('{ text }', () => {
    expect(replyTextOf({ text: GOOD })).toBe(GOOD)
    expect(aboutParse({ text: GOOD }, 1)?.dynasty).toBe('唐')
  })

  test('{ content: [{ type: "text", text }] }', () => {
    const reply = { content: [{ type: 'text', text: GOOD }] }

    expect(replyTextOf(reply)).toBe(GOOD)
    expect(aboutParse(reply, 1)?.dynasty).toBe('唐')
  })

  test('多块内容拼起来', () => {
    expect(replyTextOf({ content: [{ text: '甲' }, { text: '乙' }, {}] })).toBe('甲乙')
  })

  test('认不出来就给空串，不抛', () => {
    expect(replyTextOf(undefined)).toBe('')
    expect(replyTextOf(null)).toBe('')
    expect(replyTextOf(42)).toBe('')
    expect(replyTextOf({})).toBe('')
    expect(aboutParse(undefined, 1)).toBe(null)
    expect(aboutParse(42, 1)).toBe(null)
  })

  test('报错时说清楚收到了什么', () => {
    expect(describeReply(undefined)).toBe('undefined')
    expect(describeReply(null)).toBe('null')
    expect(describeReply('抱歉')).toContain('抱歉')
    expect(describeReply({ a: 1 })).toContain('{')
    expect(describeReply({ a: 1 }).length).toBeLessThan(200)
  })
})
