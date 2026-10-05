import type { ContextGauge, Limit } from '../types'
import { BLOOD, GHOST, MINCHO, RUST, SCARLET, svgSize } from './palette'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SLOTS = 3

// 利用枠の種類を、パネルに出す呼び名にする。知らない種類はそのまま出す
export const labelOf = (kind: string): string => {
  if (kind === 'five_hour') return '5時間枠'
  if (kind === 'spend_limit') return '利用上限額'
  const model = /fable|opus|sonnet|haiku/i.exec(kind)?.[0]
  if (model) return `${model[0]!.toUpperCase()}${model.slice(1).toLowerCase()}週次`
  if (kind.startsWith('seven_day')) return '週次'
  return kind
}

const englishOf = (kind: string): string => {
  if (kind === 'five_hour') return 'FIVE-HOUR WINDOW'
  if (kind === 'spend_limit') return 'SPEND LIMIT'
  const model = /fable|opus|sonnet|haiku/i.exec(kind)?.[0]
  if (model) return `${model.toUpperCase()} WEEKLY`
  return kind.startsWith('seven_day') ? 'WEEKLY WINDOW' : kind.toUpperCase()
}

const windowMs = (kind: string): number | undefined =>
  kind === 'five_hour' ? 5 * HOUR : kind.startsWith('seven_day') ? 7 * DAY : undefined

const resetOf = (limit: Limit): number | undefined => {
  const at = limit.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
  return Number.isNaN(at) ? undefined : at
}

export type Mode = 'halt' | 'low' | 'nominal' | 'overrun'

type Reading = {
  mode: Mode
  // 7セグメントが数え下ろす残り時間。undefinedなら「-:--」
  ms: number | undefined
  isDanger: boolean
  caption: string
  captionEn: string
}

// 枠の開始からの消費ペースで、HALT・LOW・NOMINAL・OVERRUNの4段階に振り分ける
export const readingOf = (limit: Limit, now: number): Reading => {
  const reset = resetOf(limit)
  const untilReset = reset === undefined ? undefined : Math.max(0, reset - now)
  if (limit.percentUsed >= 100) {
    return { mode: 'halt', ms: 0, isDanger: true, caption: '稼働停止', captionEn: 'OPERATION HALTED' }
  }
  const length = windowMs(limit.kind)
  const elapsed = reset !== undefined && length !== undefined ? now - (reset - length) : undefined
  if (elapsed !== undefined && elapsed >= 60_000 && limit.percentUsed > 0 && reset !== undefined) {
    const hitAt = now + ((100 - limit.percentUsed) / limit.percentUsed) * elapsed
    if (hitAt < reset) {
      const ms = hitAt - now
      return {
        mode: 'overrun',
        ms,
        isDanger: ms < 30 * 60_000 || limit.percentUsed >= 90,
        caption: '稼働限界まで',
        captionEn: 'OPERATING LIMIT IN :',
      }
    }
    // 枠の経過割合に対して、使用率がその半分に満たなければLOW
    const pace = limit.percentUsed / ((elapsed / length!) * 100)
    return {
      mode: pace < 0.5 ? 'low' : 'nominal',
      ms: untilReset,
      isDanger: limit.percentUsed >= 90,
      caption: '枠更新まで',
      captionEn: 'WINDOW RESET IN :',
    }
  }
  return {
    mode: 'nominal',
    ms: untilReset,
    isDanger: limit.percentUsed >= 90,
    caption: '枠更新まで',
    captionEn: 'WINDOW RESET IN :',
  }
}

export const untilText = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `あと${days}日${hours}時間`
  return hours > 0 ? `あと${hours}時間${minutes % 60}分` : `あと${minutes % 60}分`
}

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── 7セグメント ──────────────────────────────────────────

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g',
}
const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

type Glyph = { w: number; h: number; t: number }

const segmentPoints = (name: string, x: number, y: number, { w, h, t }: Glyph): string => {
  const half = t / 2
  const inner = w - t
  const leg = (h - 3 * t) / 2 + t
  const across = (x0: number, y0: number) =>
    `${x0},${y0} ${x0 + half},${y0 - half} ${x0 + inner - half},${y0 - half} ${x0 + inner},${y0} ${x0 + inner - half},${y0 + half} ${x0 + half},${y0 + half}`
  const down = (x0: number, y0: number) =>
    `${x0},${y0} ${x0 + half},${y0 + half} ${x0 + half},${y0 + leg - half} ${x0},${y0 + leg} ${x0 - half},${y0 + leg - half} ${x0 - half},${y0 + half}`
  const left = x + half
  const right = x + w - half
  const top = y + half
  const middle = y + h / 2
  const bottom = y + h - half
  switch (name) {
    case 'a': return across(left, top)
    case 'g': return across(left, middle)
    case 'd': return across(left, bottom)
    case 'f': return down(left, top)
    case 'b': return down(right, top)
    case 'e': return down(left, middle)
    default: return down(right, middle)
  }
}

const staticDigit = (char: string, x: number, y: number, glyph: Glyph): string => {
  const lit = SEGMENTS[char] ?? ''
  return SEGMENT_NAMES.map(
    name =>
      `<polygon points="${segmentPoints(name, x, y, glyph)}" fill="${lit.includes(name) ? SCARLET : GHOST}"/>`,
  ).join('')
}

// 数え下ろす1桁。残り秒数Rのとき floor((R mod modulo) / divisor) を表示する。
// 再描画せずに秒を進めるため、各区画の点灯をSMILの離散アニメーションで切り替える
const countingDigit = (
  seconds: number,
  divisor: number,
  modulo: number,
  x: number,
  y: number,
  glyph: Glyph,
): string => {
  const steps = modulo / divisor
  const offset = modulo - 1 - (seconds % modulo)
  const keyTimes = Array.from({ length: steps }, (_, i) => (i / steps).toFixed(5)).join(';')
  return SEGMENT_NAMES.map(name => {
    const values = Array.from({ length: steps }, (_, i) =>
      (SEGMENTS[String(steps - 1 - i)] ?? '').includes(name) ? SCARLET : GHOST,
    )
    const points = segmentPoints(name, x, y, glyph)
    if (values.every(value => value === values[0])) {
      return `<polygon points="${points}" fill="${values[0]}"/>`
    }
    return `<polygon points="${points}" fill="${GHOST}"><animate attributeName="fill" calcMode="discrete" values="${values.join(';')}" keyTimes="${keyTimes}" dur="${modulo}s" begin="${-offset}s" repeatCount="indefinite"/></polygon>`
  }).join('')
}

const colon = (x: number, y: number, h: number, size: number): string =>
  `<rect x="${x}" y="${y + h * 0.28}" width="${size}" height="${size}" fill="${SCARLET}"/><rect x="${x}" y="${y + h * 0.66}" width="${size}" height="${size}" fill="${SCARLET}"/>`

const BIG: Glyph = { w: 34, h: 70, t: 8 }
const SMALL: Glyph = { w: 17, h: 34, t: 4.5 }
const BIG_STEP = BIG.w + 8
const SMALL_STEP = SMALL.w + 5

// 大きい「時:分」と小さい「:秒」を組む
const clock = (ms: number | undefined, x: number, y: number, maxWidth: number): string => {
  if (ms === undefined) {
    return `<g transform="translate(${x} ${y})">${staticDigit('-', 0, 0, BIG)}${colon(BIG_STEP + 1, 0, BIG.h, 7)}${staticDigit('-', BIG_STEP + 14, 0, BIG)}${staticDigit('-', 2 * BIG_STEP + 14, 0, BIG)}</g>`
  }
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hourDigits = Math.max(1, String(Math.floor(seconds / 3600)).length)
  const parts: string[] = []
  let cursor = 0
  for (let i = hourDigits - 1; i >= 0; i -= 1) {
    const divisor = 3600 * 10 ** i
    parts.push(countingDigit(seconds, divisor, divisor * 10, cursor, 0, BIG))
    cursor += BIG_STEP
  }
  parts.push(colon(cursor + 1, 0, BIG.h, 7))
  cursor += 14
  parts.push(countingDigit(seconds, 600, 3600, cursor, 0, BIG))
  cursor += BIG_STEP
  parts.push(countingDigit(seconds, 60, 600, cursor, 0, BIG))
  cursor += BIG_STEP
  const smallY = BIG.h - SMALL.h
  parts.push(colon(cursor, smallY, SMALL.h, 4))
  cursor += 8
  parts.push(countingDigit(seconds, 10, 60, cursor, smallY, SMALL))
  cursor += SMALL_STEP
  parts.push(countingDigit(seconds, 1, 10, cursor, smallY, SMALL))
  cursor += SMALL.w
  const scale = Math.min(1, maxWidth / cursor)
  // 0に達したら数え下ろしを止め、0を点滅させる
  const zero = `<g display="none">${staticDigit('0', 0, 0, BIG)}${colon(BIG_STEP + 1, 0, BIG.h, 7)}${staticDigit('0', BIG_STEP + 14, 0, BIG)}${staticDigit('0', 2 * BIG_STEP + 14, 0, BIG)}<set attributeName="display" to="inline" begin="${seconds}s"/><animate attributeName="opacity" values="1;0.15;1" dur="0.8s" begin="${seconds}s" repeatCount="indefinite"/></g>`
  if (seconds === 0) {
    return `<g transform="translate(${x} ${y}) scale(${scale})"><g>${staticDigit('0', 0, 0, BIG)}${colon(BIG_STEP + 1, 0, BIG.h, 7)}${staticDigit('0', BIG_STEP + 14, 0, BIG)}${staticDigit('0', 2 * BIG_STEP + 14, 0, BIG)}<animate attributeName="opacity" values="1;0.15;1" dur="0.8s" repeatCount="indefinite"/></g></g>`
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})"><g>${parts.join('')}<set attributeName="display" to="none" begin="${seconds}s"/></g>${zero}</g>`
}

// 数え下ろさない7セグメント。大きい整数部と小さい小数部(「63」「.5」)を組む
const gauge = (whole: string, fraction: string, x: number, y: number, maxWidth: number): string => {
  const parts: string[] = []
  let cursor = 0
  for (const char of whole) {
    parts.push(staticDigit(char, cursor, 0, BIG))
    cursor += BIG_STEP
  }
  const smallY = BIG.h - SMALL.h
  if (fraction) {
    parts.push(`<rect x="${cursor}" y="${smallY + SMALL.h - 5}" width="5" height="5" fill="${SCARLET}"/>`)
    cursor += 9
    for (const char of fraction) {
      parts.push(staticDigit(char, cursor, smallY, SMALL))
      cursor += SMALL_STEP
    }
  }
  const scale = Math.min(1, maxWidth / cursor)
  return `<g transform="translate(${x} ${y}) scale(${scale})">${parts.join('')}</g>`
}

// ── 1基ぶんの表示内容 ──────────────────────────────────────

// 利用枠・コンテキスト・信号なしを同じ枠で描くための表示内容
type Panel = {
  name: string
  english: string
  caption: string
  captionEn: string
  digits: (x: number, y: number, maxWidth: number) => string
  amountLabel: string
  amount: string
  footer: string
  lamps: { label: string; isOn: boolean }[]
  isDanger: boolean
  isPrimary: boolean
  tone: Tone
}

// ── 残量に応じた配色 ──────────────────────────────────────
// 余裕があるうちは黄色い数字に緑から黄の枠、残りが減るにつれて橙、赤へと変える

export type Tone = 'yellow' | 'amber' | 'red'

type ToneColors = { lit: string; ghost: string; ground: string; dim: string; frame: [string, string, string] }

const TONES: Record<Tone, ToneColors> = {
  yellow: { lit: '#FFD81F', ghost: '#2B2700', ground: '#0B0A00', dim: '#8A7A10', frame: ['#4CD964', '#F2E205', '#FF9F1C'] },
  amber: { lit: '#FF9F1C', ghost: '#331C00', ground: '#0E0800', dim: '#8A5210', frame: ['#F2E205', '#FF9F1C', '#FF3B1A'] },
  red: { lit: SCARLET, ghost: GHOST, ground: BLOOD, dim: RUST, frame: ['#FF6A1A', SCARLET, '#9A0000'] },
}

// 残り50%超は黄、20%以上は橙、それ未満と危険時は赤。使い切る見込み(OVERRUN)なら黄にはしない
const toneOf = (left: number | undefined, isDanger: boolean, isOverrun = false): Tone => {
  if (left === undefined) return 'red'
  if (isDanger || left < 20) return 'red'
  return left <= 50 || isOverrun ? 'amber' : 'yellow'
}

// 赤で描いた1基を、段階の配色に置き換える。DANGERは点灯時に赤段階になるので置き換えの影響を受けない
const recolor = (svg: string, tone: Tone): string => {
  const colors = TONES[tone]
  return svg
    .split(SCARLET).join(colors.lit)
    .split(GHOST).join(colors.ghost)
    .split(BLOOD).join(colors.ground)
    .split(RUST).join(colors.dim)
    .split('url(#frame)').join(`url(#frame-${tone})`)
}

const frameGradients = (): string =>
  (Object.keys(TONES) as Tone[])
    .map(tone => {
      const [from, middle, to] = TONES[tone].frame
      return `<linearGradient id="frame-${tone}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${from}"/><stop offset="0.55" stop-color="${middle}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
    })
    .join('')

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'halt', label: 'HALT' },
  { mode: 'low', label: 'LOW' },
  { mode: 'nominal', label: 'NOMINAL' },
  { mode: 'overrun', label: 'OVERRUN' },
]

const limitPanel = (limit: Limit, now: number): Panel => {
  const reading = readingOf(limit, now)
  const reset = resetOf(limit)
  return {
    name: labelOf(limit.kind),
    english: englishOf(limit.kind),
    caption: reading.caption,
    captionEn: reading.captionEn,
    digits: (x, y, maxWidth) => clock(reading.ms, x, y, maxWidth),
    amountLabel: '残量',
    amount: `${Math.max(0, Math.round(100 - limit.percentUsed))}%`,
    footer: reset === undefined ? '' : `更新 ${untilText(reset - now)}`,
    lamps: MODES.map(({ mode, label }) => ({ label, isOn: reading.mode === mode })),
    isDanger: reading.isDanger,
    isPrimary: true,
    tone: toneOf(
      Math.max(0, 100 - limit.percentUsed),
      reading.isDanger || reading.mode === 'halt',
      reading.mode === 'overrun',
    ),
  }
}

const kilo = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`

// コンテキストの使用率で段階を決める。利用枠のHALT〜OVERRUNの位置に、空き具合の4段階を置く
const CONTEXT_STAGES = [
  { label: 'NORMAL', below: 60 },
  { label: 'CAUTION', below: 80 },
  { label: 'CRITICAL', below: 95 },
  { label: 'FULL', below: Number.POSITIVE_INFINITY },
]

const contextPanel = (context: ContextGauge): Panel => {
  const used =
    context.tokens !== undefined && context.window > 0
      ? (context.tokens / context.window) * 100
      : context.percent
  const left = used === undefined ? undefined : Math.max(0, 100 - used)
  const stage = used === undefined ? undefined : CONTEXT_STAGES.find(one => used < one.below)
  const [whole, fraction] = left === undefined ? ['--', ''] : left.toFixed(1).split('.')
  return {
    name: 'コンテキスト',
    english: 'CONTEXT WINDOW',
    caption: '残り容量（%）',
    captionEn: 'CONTEXT REMAINING :',
    digits: (x, y, maxWidth) => gauge((whole ?? '--').padStart(2, '0'), fraction ?? '', x, y, maxWidth),
    amountLabel: '全容量',
    amount: kilo(context.window),
    footer:
      context.tokens === undefined
        ? '次の応答で計測'
        : `使用 ${kilo(context.tokens)} / ${kilo(context.window)}`,
    lamps: CONTEXT_STAGES.map(({ label }) => ({ label, isOn: stage?.label === label })),
    isDanger: used !== undefined && used >= 80,
    isPrimary: true,
    tone: toneOf(left, used !== undefined && used >= 80),
  }
}

const emptyPanel = (): Panel => ({
  name: '第3系統',
  english: 'NO SIGNAL',
  caption: '信号なし',
  captionEn: 'NO SIGNAL',
  digits: (x, y, maxWidth) => clock(undefined, x, y, maxWidth),
  amountLabel: '残量',
  amount: '--%',
  footer: '',
  lamps: MODES.map(({ label }) => ({ label, isOn: false })),
  isDanger: false,
  isPrimary: false,
  tone: 'red',
})

// 利用枠を先に、空いた基にコンテキスト、それでも空けば信号なしを割り当てる
const panelsOf = (limits: readonly Limit[], context: ContextGauge | null, now: number): Panel[] => {
  const panels = limits.slice(0, SLOTS).map(limit => limitPanel(limit, now))
  if (panels.length < SLOTS && context) panels.push(contextPanel(context))
  while (panels.length < SLOTS) panels.push(emptyPanel())
  return panels
}

// ── タイマー1基 ──────────────────────────────────────────

const MODULE_W = 400
const MODULE_H = 214
const GAP = 14

const text = (
  x: number,
  y: number,
  size: number,
  fill: string,
  body: string,
  options: { anchor?: 'start' | 'middle' | 'end'; weight?: number; squeeze?: number } = {},
): string => {
  const { anchor = 'start', weight = 900, squeeze = 0.78 } = options
  return `<g transform="translate(${x} ${y}) scale(${squeeze} 1)"><text font-family="${MINCHO}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${body}</text></g>`
}

const BLINK = '<animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite"/>'

// 斜線入りの電源表示。点灯時は赤地に黒文字、消灯時は暗い縁取りだけ
const supplyBox = (x: number, y: number, kanji: string, english: string, isOn: boolean, id: string): string => {
  const ink = isOn ? BLOOD : GHOST
  const ground = isOn ? SCARLET : 'none'
  const stripes = Array.from({ length: 5 }, (_, i) => {
    const sx = x + 92 + i * 9
    return `<polygon points="${sx},${y + 40} ${sx + 5},${y + 40} ${sx + 17},${y} ${sx + 12},${y}" fill="${isOn ? SCARLET : GHOST}"/>`
  }).join('')
  return `<clipPath id="${id}"><rect x="${x + 90}" y="${y}" width="36" height="40"/></clipPath>
  <rect x="${x}" y="${y}" width="86" height="40" fill="${ground}" stroke="${isOn ? SCARLET : GHOST}" stroke-width="1.5"/>
  ${text(x + 43, y + 25, 22, ink, kanji, { anchor: 'middle' })}
  ${text(x + 43, y + 36, 8, ink, english, { anchor: 'middle', weight: 700, squeeze: 1 })}
  <rect x="${x + 90}" y="${y}" width="36" height="40" fill="none" stroke="${isOn ? SCARLET : GHOST}" stroke-width="1.5"/>
  <g clip-path="url(#${id})">${stripes}</g>`
}

const timerModule = (panel: Panel, index: number, x: number, y: number): string => {
  const rivets = Array.from({ length: 11 }, (_, i) => `<circle cx="${70 + i * 30}" cy="7" r="1.6" fill="${RUST}"/>`).join('')
  const lamps = panel.lamps
    .map(({ label, isOn }, i) => {
      const lx = 14 + i * 56
      return `<rect x="${lx}" y="158" width="50" height="20" fill="${isOn ? SCARLET : 'none'}" stroke="${isOn ? SCARLET : GHOST}" stroke-width="1.2"/>
    ${text(lx + 25, 172, 10, isOn ? BLOOD : GHOST, label, { anchor: 'middle', weight: 700, squeeze: 0.8 })}`
    })
    .join('')
  const danger = `<g>
    <rect x="248" y="154" width="138" height="28" fill="${panel.isDanger ? SCARLET : 'none'}" stroke="${panel.isDanger ? SCARLET : GHOST}" stroke-width="1.5"/>
    ${text(317, 166, 12, panel.isDanger ? BLOOD : GHOST, 'DANGER', { anchor: 'middle', squeeze: 1 })}
    ${text(317, 178, 9, panel.isDanger ? BLOOD : GHOST, 'EMERGENCY', { anchor: 'middle', weight: 700, squeeze: 1 })}
    ${panel.isDanger ? BLINK : ''}
  </g>`

  return recolor(`<g transform="translate(${x} ${y})">
  <polygon points="0,34 34,0 ${MODULE_W},0 ${MODULE_W},${MODULE_H} 0,${MODULE_H}" fill="${BLOOD}" stroke="url(#frame)" stroke-width="3"/>
  <polygon points="6,36 36,6 ${MODULE_W - 6},6 ${MODULE_W - 6},${MODULE_H - 6} 6,${MODULE_H - 6}" fill="none" stroke="${GHOST}" stroke-width="1"/>
  ${rivets}
  ${text(46, 26, 15, SCARLET, xml(panel.name))}
  ${text(46 + panel.name.length * 12.5, 26, 8, RUST, xml(panel.english), { weight: 700, squeeze: 1 })}
  ${text(14, 52, 12, SCARLET, panel.caption)}
  ${text(14 + panel.caption.length * 9.6 + 6, 52, 8, SCARLET, panel.captionEn, { weight: 700, squeeze: 1 })}
  <g filter="url(#glow)">${panel.digits(14, 62, 226)}</g>
  ${supplyBox(258, 12, '主系', 'PRIMARY', panel.isPrimary, `stripe-primary-${index}`)}
  ${text(258, 66, 10, SCARLET, '利用枠監視系統', { weight: 700 })}
  ${text(258, 75, 6.5, RUST, 'QUOTA MONITORING SYSTEM', { weight: 700, squeeze: 1 })}
  ${text(258, 98, 13, RUST, panel.amountLabel, { weight: 700 })}
  ${text(386, 100, 28, SCARLET, panel.amount, { anchor: 'end' })}
  ${supplyBox(258, 106, '副系', 'BACKUP', !panel.isPrimary, `stripe-backup-${index}`)}
  ${lamps}
  ${danger}
  ${text(14, 202, 10, RUST, xml(panel.footer), { weight: 700 })}
</g>`, panel.tone)
}

// 中くらいの幅で縦に積むための、上下を詰めた横長のタイマー。
// 左に名前と数値、右に電源・残量・ランプを3段で寄せ、原寸の6割弱の高さにする
const STRIP_W = 600
const STRIP_H = 118
const STRIP_GAP = 8

const stripModule = (panel: Panel, x: number, y: number): string => {
  const supply = (sx: number, kanji: string, english: string, isOn: boolean): string => `
    <rect x="${sx}" y="10" width="58" height="28" fill="${isOn ? SCARLET : 'none'}" stroke="${isOn ? SCARLET : GHOST}" stroke-width="1.5"/>
    ${text(sx + 29, 28, 17, isOn ? BLOOD : GHOST, kanji, { anchor: 'middle' })}
    ${text(sx + 29, 35, 6, isOn ? BLOOD : GHOST, english, { anchor: 'middle', weight: 700, squeeze: 1 })}`
  const lamps = panel.lamps
    .map(({ label, isOn }, i) => {
      const lx = 284 + i * 56
      return `<rect x="${lx}" y="74" width="52" height="20" fill="${isOn ? SCARLET : 'none'}" stroke="${isOn ? SCARLET : GHOST}" stroke-width="1.2"/>
    ${text(lx + 26, 88, 11, isOn ? BLOOD : GHOST, label, { anchor: 'middle', weight: 700, squeeze: 0.78 })}`
    })
    .join('')
  const rivets = Array.from({ length: 16 }, (_, i) => `<circle cx="${50 + i * 34}" cy="5" r="1.4" fill="${RUST}"/>`).join('')
  const nameWidth = panel.name.length * 15.6

  return recolor(`<g transform="translate(${x} ${y})">
  <polygon points="0,22 22,0 ${STRIP_W},0 ${STRIP_W},${STRIP_H} 0,${STRIP_H}" fill="${BLOOD}" stroke="url(#frame)" stroke-width="3"/>
  ${rivets}
  ${text(30, 28, 20, SCARLET, xml(panel.name))}
  ${text(36 + nameWidth, 28, 13, SCARLET, panel.caption)}
  ${text(40 + nameWidth + panel.caption.length * 10.2, 28, 7, RUST, xml(panel.english), { weight: 700, squeeze: 1 })}
  <g filter="url(#glow)">${panel.digits(12, 38, 258)}</g>
  ${supply(284, '主系', 'PRIMARY', panel.isPrimary)}${supply(346, '副系', 'BACKUP', !panel.isPrimary)}
  ${text(414, 34, 12, RUST, panel.amountLabel, { weight: 700 })}
  ${text(588, 38, 32, SCARLET, panel.amount, { anchor: 'end' })}
  ${text(284, 56, 11, SCARLET, '利用枠監視系統', { weight: 700 })}
  ${text(284, 65, 6, RUST, 'QUOTA MONITORING SYSTEM', { weight: 700, squeeze: 1 })}
  ${text(588, 62, 11, RUST, xml(panel.footer), { anchor: 'end', weight: 700 })}
  ${lamps}
  <g>
    <rect x="508" y="70" width="80" height="28" fill="${panel.isDanger ? SCARLET : 'none'}" stroke="${panel.isDanger ? SCARLET : GHOST}" stroke-width="1.5"/>
    ${text(548, 83, 12, panel.isDanger ? BLOOD : GHOST, 'DANGER', { anchor: 'middle', squeeze: 1 })}
    ${text(548, 94, 8, panel.isDanger ? BLOOD : GHOST, 'EMERGENCY', { anchor: 'middle', weight: 700, squeeze: 1 })}
    ${panel.isDanger ? BLINK : ''}
  </g>
</g>`, panel.tone)
}

// パネルの座標系の幅。mediumは作戦記録と同じ600にして文字の大きさを揃える
export const layoutWidth = (layout: Layout): number =>
  layout === 'wide' ? SLOTS * MODULE_W + (SLOTS - 1) * GAP : layout === 'medium' ? STRIP_W : MODULE_W

// 3基のタイマーを並べる。wideは原寸3基を横に、mediumは横長の帯を縦に、narrowは原寸を縦に積む
export const powerSvg = (
  limits: readonly Limit[],
  context: ContextGauge | null,
  now: number,
  layout: Layout,
  drawWidth: number,
): { source: string; width: number; height: number } => {
  const panels = panelsOf(limits, context, now)
  const width = layoutWidth(layout)
  const height =
    layout === 'wide'
      ? MODULE_H
      : layout === 'medium'
        ? SLOTS * STRIP_H + (SLOTS - 1) * STRIP_GAP
        : SLOTS * MODULE_H + (SLOTS - 1) * GAP
  const modules = panels
    .map((panel, i) =>
      layout === 'wide'
        ? timerModule(panel, i, i * (MODULE_W + GAP), 0)
        : layout === 'medium'
          ? stripModule(panel, 0, i * (STRIP_H + STRIP_GAP))
          : timerModule(panel, i, 0, i * (MODULE_H + GAP)),
    )
    .join('')
  const size = svgSize(drawWidth, width, height)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size.width}" height="${size.height}">
  <defs><filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${frameGradients()}</defs>
  ${modules}
</svg>`
  return { source, ...size }
}

// Svgのないターミナル向け。同じ内容を文字で並べる
export const powerRows = (
  limits: readonly Limit[],
  context: ContextGauge | null,
  now: number,
): { text: string; color: string }[] => {
  const rows = limits.map(limit => {
    const reading = readingOf(limit, now)
    const left = Math.max(0, 100 - limit.percentUsed)
    const lit = Math.round((left / 100) * 20)
    const ms = reading.ms ?? 0
    const time = `${Math.floor(ms / HOUR)}:${String(Math.floor((ms % HOUR) / 60_000)).padStart(2, '0')}`
    return {
      text: `${labelOf(limit.kind)} ${'█'.repeat(lit)}${'░'.repeat(20 - lit)} 残${Math.round(left)}% ${reading.caption} ${time} [${reading.mode.toUpperCase()}]`,
      color: SCARLET,
    }
  })
  if (rows.length < SLOTS && context) {
    const panel = contextPanel(context)
    rows.push({
      text: `${panel.name} ${panel.caption} ${panel.footer} [${panel.lamps.find(one => one.isOn)?.label ?? '--'}]`,
      color: SCARLET,
    })
  }
  return rows
}

// 警告帯に出すべき、使用率90%以上で最も逼迫した枠
export const critical = (limits: readonly Limit[]): Limit | undefined =>
  limits
    .filter(one => one.percentUsed >= 90)
    .sort((a, b) => b.percentUsed - a.percentUsed)[0]

export const resetIn = (limit: Limit, now: number): string | undefined => {
  const reset = resetOf(limit)
  return reset === undefined ? undefined : untilText(reset - now)
}
