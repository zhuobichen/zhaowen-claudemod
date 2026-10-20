// 一首诗的「详解」：问一次模型，把答案存进插件的 store，下次遇到同一句直接读。
//
// 为什么存在 store 而不是内存：`/plugin` 重装、重启、换会话之后那句诗还会再出现，
// 那时候不该再花一次模型调用。store 有 **4 MiB 总上限**，所以带一个上限淘汰
// （见 `ABOUT_LIMIT` 与 `remember`）。
//
// 这里只有纯函数：拼 prompt、解析模型输出、排版。真正调用模型的是 register.tsx。

/** 一首诗的详解。 */
export type PoemAbout = {
  /** 朝代，如 `唐`；模型拿不准时可为 null。 */
  dynasty: string | null
  /** 年份或年代，如 `约 725 年（开元十三年）`。 */
  year: string | null
  /** 这一句（这几句）的意思。 */
  meaning: string
  /** 作者写这首诗时的处境与缘由。 */
  background: string
  /** 写入时间（毫秒）。 */
  atMs: number
}

/** store 里每条详解的键前缀。 */
export const ABOUT_PREFIX = 'about:'

/** store 里保存插入顺序的那个键，用来做过期淘汰。 */
export const ABOUT_INDEX_KEY = 'aboutIndex'

/** 最多留多少条。按每条 ~300 字节算，300 条约 90 KB，离 4 MiB 很远。 */
export const ABOUT_LIMIT = 300

/** 一句诗在 store 里的键。 */
export const aboutKeyOf = (line: string): string => `${ABOUT_PREFIX}${line.trim()}`

/**
 * 给模型的指令与那句话。
 *
 * 好处是它同时钉住了两件事：要**纯 JSON**、以及**不确定就给 null 别编年份**。
 */
export const aboutPromptOf = (line: string, from: string): { system: string; prompt: string } => ({
  system: [
    '你是一位中国古典诗词学者。针对用户给出的一句诗（可能出自长篇），写简明的解读。',
    '只输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要多余解释。',
    '字段：',
    '  "dynasty": 朝代名，如 "唐"、"宋"；确定不了就给 null。',
    '  "year": 创作年份或年代，尽量具体（如 "约 725 年（开元十三年）"）；确定不了就给 null。',
    '  "meaning": 这一句（这几句）在说什么，2–3 句白话。',
    '  "background": 作者在什么处境下写的这首诗、想表达什么，2–4 句白话。',
    '不要编造精确年份：宁可给 null 或"约"，也不要瞎猜。',
  ].join('\n'),
  prompt: `诗句：${line}\n出处：${from}`,
})

/**
 * 从模型回复里取出正文。
 *
 * 类型上 `$.model.complete` 答应回 `string`，但实测回来过非字符串（于是
 * `text.trim()` 直接炸）。所以这里把几种可能的形状都认了：
 * 裸字符串、`{ text }`、`{ content: [{ type:'text', text }] }`。
 */
export const replyTextOf = (value: unknown): string => {
  if (typeof value === 'string') return value

  if (value !== null && typeof value === 'object') {
    const any = value as any

    if (typeof any.text === 'string') return any.text

    if (Array.isArray(any.content)) {
      return any.content
        .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
        .join('')
    }
  }

  return ''
}

/** 给报错用的简短描述：收到了什么，而不是只说"失败了"。 */
export const describeReply = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'

  const kind = typeof value

  if (kind !== 'object') return `${kind}: ${String(value).slice(0, 60)}`

  try {
    return `${kind}: ${JSON.stringify(value).slice(0, 120)}`
  } catch {
    return kind
  }
}

/**
 * 把模型输出解析成 `PoemAbout`；解析不了返回 null（这次就不写缓存）。
 *
 * 模型偶尔会套 ```json 围栏，或者在前后加一句话，所以先剥再取第一个 `{` 到最后一个 `}`。
 */
export const aboutParse = (raw: unknown, atMs: number): PoemAbout | null => {
  const trimmed = replyTextOf(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')

  if (start < 0 || end <= start) return null

  let parsed: any

  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }

  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' && value.trim() !== 'null' ? value.trim() : null

  const meaning = str(parsed?.meaning)
  const background = str(parsed?.background)

  // 两个正文都没有，就当这次生成失败（不要把空壳写进缓存）
  if (meaning === null && background === null) return null

  return {
    dynasty: str(parsed?.dynasty),
    year: str(parsed?.year),
    meaning: meaning ?? '（模型没有给出释义）',
    background: background ?? '（模型没有给出背景）',
    atMs,
  }
}

/** 详情面板要画的那几行（不含前缀装饰，交给调用方）。 */
export const aboutLinesOf = (about: PoemAbout): string[] => {
  const head = [about.dynasty, about.year].filter(Boolean).join(' · ')

  return [
    ...(head === '' ? [] : [head]),
    `诗意：${about.meaning}`,
    `背景：${about.background}`,
  ]
}

/** 一句话概括，给不允许换行的地方用。 */
export const aboutOneLineOf = (about: PoemAbout): string =>
  `诗意：${about.meaning} 背景：${about.background}`.replace(/\s+/g, ' ')

/**
 * 淘汰：把插入顺序里最早的那些从 keys 里算出来，返回还需要删掉的键。
 *
 * 纯函数，方便测。`keys` 是 store 的 `keys()` 结果（插入顺序）。
 * @param keys - 全部键。
 * @param limit - 最多留几条。
 * @returns 该删掉的 `about:*` 键，按最早优先。
 */
export const aboutEvictionsOf = (keys: readonly string[], limit = ABOUT_LIMIT): string[] => {
  const aboutKeys = keys.filter((key) => key.startsWith(ABOUT_PREFIX))
  const excess = aboutKeys.length - limit

  return excess <= 0 ? [] : aboutKeys.slice(0, excess)
}
