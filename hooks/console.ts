import type { LogEntry, UnitName, Units, Verdict } from '../types'
import { ASH, GREEN, MINCHO, ORANGE, RED, VOID, svgSize } from './palette'
import type { Layout } from './palette'

export const UNIT_NO: Record<UnitName, string> = { OBSERVER: '1', SCRIBE: '2', EXECUTOR: '3' }
export const UNIT_NAMES: UnitName[] = ['EXECUTOR', 'SCRIBE', 'OBSERVER']
export const VERDICT_TEXT: Record<Verdict, string> = {
  idle: '待機',
  running: '審議中',
  approved: '可決',
  denied: '否決',
}
export const VERDICT_COLOR: Record<Verdict, string> = {
  idle: ASH,
  running: ORANGE,
  approved: GREEN,
  denied: RED,
}

// 作戦記録の本文。暗い地の上で読める明るさにする
const PAPER = '#B8B8B8'

export const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const elapsed = (from: number, at: number): string => {
  const seconds = Math.max(0, Math.floor((at - from) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `T+${mm}:${ss}`
}

const label = (
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

// TRIAD COREの3基。審議中の基は点滅させる(isInteractiveの枠内でSMILが動く)
const PANELS: Record<UnitName, { points: string; x: number; y: number }> = {
  EXECUTOR: { points: '16,52 164,52 164,112 136,144 16,144', x: 90, y: 92 },
  SCRIBE: { points: '196,52 344,52 344,144 224,144 196,112', x: 270, y: 92 },
  OBSERVER: { points: '112,160 248,160 268,180 268,244 92,244 92,180', x: 180, y: 200 },
}
const CORE_W = 360
const CORE_H = 262

const core = (state: Units, decision: Verdict): string => {
  const panels = UNIT_NAMES.map(name => {
    const { points, x, y } = PANELS[name]
    const unit = state[name]
    const isLit = unit.verdict !== 'idle'
    const ink = isLit ? VOID : ORANGE
    const pulse =
      unit.verdict === 'running'
        ? '<animate attributeName="opacity" values="1;0.25;1" dur="0.7s" repeatCount="indefinite"/>'
        : ''
    return `
  <polygon points="${points}" fill="${isLit ? VERDICT_COLOR[unit.verdict] : VOID}" stroke="${ORANGE}" stroke-width="2">${pulse}</polygon>
  ${label(x, y - 20, 13, ink, `${name}・${UNIT_NO[name]}`, { anchor: 'middle', weight: 700, squeeze: 0.72 })}
  ${label(x, y + 10, 28, ink, VERDICT_TEXT[unit.verdict], { anchor: 'middle', squeeze: 0.72 })}
  ${label(x, y + 28, 11, ink, `${xml(clip(unit.tool, 18))}${unit.count ? ` ／ ${unit.count}件` : ''}`, { anchor: 'middle', weight: 700, squeeze: 0.72 })}`
  }).join('')

  return `
  ${label(16, 30, 26, ORANGE, 'TRIAD CORE', { squeeze: 0.7 })}
  ${label(344, 30, 22, VERDICT_COLOR[decision], `決議　${VERDICT_TEXT[decision]}`, { anchor: 'end', squeeze: 0.7 })}
  <line x1="16" y1="40" x2="344" y2="40" stroke="${ORANGE}"/>
  <line x1="164" y1="124" x2="180" y2="140" stroke="${ORANGE}"/>
  <line x1="196" y1="124" x2="180" y2="140" stroke="${ORANGE}"/>
  ${label(180, 154, 10, ORANGE, 'CORE', { anchor: 'middle', weight: 700, squeeze: 1 })}${panels}`
}

const ROW_H = 22

// 作戦記録。幅に収まる文字数で対象を切り詰める
const log = (list: readonly LogEntry[], origin: number, width: number, rows: number): string => {
  const head = `${label(0, 22, 20, ORANGE, '作戦記録')}${label(width, 22, 10, ASH, 'OPERATION LOG', { anchor: 'end', weight: 700, squeeze: 1 })}
  <line x1="0" y1="32" x2="${width}" y2="32" stroke="${ORANGE}"/>`
  if (list.length === 0) {
    return `${head}${label(0, 60, 14, ASH, '審議記録なし。指示を入力すると、ツール実行がここに記録されます。', { weight: 700, squeeze: 0.9 })}`
  }
  // 列の左端。経過時刻は「T+120:00」の8文字まで入る幅を取る
  const UNIT_X = 72
  const VERDICT_X = 158
  const TOOL_X = 206
  const room = Math.max(8, Math.floor((width - TOOL_X - 20) / 7.2))
  const lines = list
    .slice(-rows)
    .map((one, i) => {
      const y = 56 + i * ROW_H
      return `${label(0, y, 13, ASH, elapsed(origin, one.at), { weight: 700, squeeze: 0.8 })}
  ${label(UNIT_X, y, 13, ORANGE, one.unit, { weight: 700, squeeze: 0.8 })}
  ${label(VERDICT_X, y, 15, VERDICT_COLOR[one.verdict], VERDICT_TEXT[one.verdict], { squeeze: 0.85 })}
  ${label(TOOL_X, y, 13, ORANGE, xml(one.tool), { weight: 700, squeeze: 0.85 })}
  ${label(TOOL_X + one.tool.length * 7 + 10, y, 12, PAPER, xml(clip(one.summary.replace(/\s+/g, ' '), room - one.tool.length)), { weight: 600, squeeze: 0.9 })}`
    })
    .join('')
  return `${head}${lines}`
}

// 決議の件数。中くらいの幅で、TRIAD COREの右の空きに置く
const tally = (list: readonly LogEntry[], width: number): string => {
  const count = (verdict: Verdict) => list.filter(one => one.verdict === verdict).length
  const rows: [Verdict, string][] = [
    ['approved', '可決'],
    ['denied', '否決'],
    ['running', '審議中'],
  ]
  return `${label(0, 30, 20, ORANGE, '決議集計')}${label(width, 30, 10, ASH, 'RESOLUTIONS', { anchor: 'end', weight: 700, squeeze: 1 })}
  <line x1="0" y1="40" x2="${width}" y2="40" stroke="${ORANGE}"/>
  ${rows
    .map(
      ([verdict, name], i) =>
        `${label(0, 92 + i * 52, 26, VERDICT_COLOR[verdict], name, { squeeze: 0.8 })}${label(width, 94 + i * 52, 40, VERDICT_COLOR[verdict], String(count(verdict)), { anchor: 'end', squeeze: 0.8 })}`,
    )
    .join('')}
  <line x1="0" y1="${236}" x2="${width}" y2="${236}" stroke="${ASH}" stroke-dasharray="2 3"/>
  ${label(0, 258, 14, ASH, '審議総数', { weight: 700 })}${label(width, 258, 18, ASH, `${list.length}件`, { anchor: 'end' })}`
}

// 座標系の幅。中くらい・狭いときは作戦記録の文字が読める大きさになる幅にする
const BOARD_W: Record<Layout, number> = { wide: 1228, medium: 600, narrow: 400 }

type Frame = { coreScale: number; logX: number; logY: number; logW: number }

const frameOf = (layout: Layout): Frame => {
  if (layout === 'wide') {
    const coreScale = 1.1
    return { coreScale, logX: CORE_W * coreScale + 24, logY: 4, logW: BOARD_W.wide - CORE_W * coreScale - 28 }
  }
  if (layout === 'medium') {
    return { coreScale: 1, logX: 8, logY: CORE_H + 12, logW: BOARD_W.medium - 16 }
  }
  const coreScale = BOARD_W.narrow / CORE_W
  return { coreScale, logX: 8, logY: CORE_H * coreScale + 16, logW: BOARD_W.narrow - 16 }
}

const LOG_HEAD = 56

// wide: TRIAD COREの右に作戦記録。medium: TRIAD COREの右に決議集計、下に作戦記録。narrow: TRIAD COREの下に作戦記録
export const consoleSvg = (
  state: Units,
  decision: Verdict,
  list: readonly LogEntry[],
  origin: number,
  layout: Layout,
  drawWidth: number,
  rows: number,
): { source: string; width: number; height: number } => {
  const width = BOARD_W[layout]
  const { coreScale, logX, logY, logW } = frameOf(layout)
  const logH = LOG_HEAD + rows * ROW_H
  const height = layout === 'wide' ? Math.max(CORE_H * coreScale, logY + logH) : logY + logH
  const size = svgSize(drawWidth, width, height)
  const side =
    layout === 'medium' ? `<g transform="translate(${CORE_W + 16} 0)">${tally(list, width - CORE_W - 24)}</g>` : ''
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size.width}" height="${size.height}">
  <rect width="${width}" height="${height}" fill="${VOID}"/>
  <g transform="scale(${coreScale})">${core(state, decision)}</g>${side}
  <g transform="translate(${logX} ${logY})">${log(list, origin, logW, rows)}</g>
</svg>`
  return { source, ...size }
}

// 作戦記録に何行出すか。パネルの残りの高さを埋める行数にする
export const logRowsFor = (
  layout: Layout,
  drawWidth: number,
  paneHeight: number,
  powerHeight: number,
): number => {
  const scale = drawWidth / BOARD_W[layout]
  const { coreScale, logY } = frameOf(layout)
  const room = (paneHeight - powerHeight) / scale - (layout === 'wide' ? 4 : logY) - LOG_HEAD
  const fit = Math.floor(room / ROW_H)
  const least = layout === 'wide' ? Math.ceil((CORE_H * coreScale - LOG_HEAD) / ROW_H) : 6
  return Math.max(least, Math.min(40, fit))
}
