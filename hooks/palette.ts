// パネルの配色。橙は平常の作戦行動、赤は警告と否決、緑は可決にだけ使う
export const VOID = '#050505'
export const ORANGE = '#FF7A00'
export const RED = '#E10600'
export const GREEN = '#00B36B'
export const ASH = '#7C7C7C'
export const MINCHO = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif"

// 稼働限界タイマーの基本色(赤段階)。点灯・地・消灯・暗い文字の4色で、黄と橙の段階はpower.tsで置き換える
export const SCARLET = '#FF2A1A'
export const BLOOD = '#120000'
export const GHOST = '#3A0606'
export const RUST = '#8A1208'

// パネルの描画幅で3段階に組み替える。
// wide: 原寸のタイマー3基を横に、TRIAD COREの右に作戦記録
// medium: 背の低いタイマー3基を横に、TRIAD COREの右に決議集計、その下に作戦記録
// narrow: 原寸のタイマーとTRIAD COREと作戦記録を縦に積む
export type Layout = 'wide' | 'medium' | 'narrow'

export const layoutOf = (drawWidth: number): Layout =>
  drawWidth >= 900 ? 'wide' : drawWidth >= 440 ? 'medium' : 'narrow'

// 動くSVGは枠(iframe)の中に宣言どおりの大きさで描かれ、枠の幅に合わせて縮んではくれない。
// そこでパネルのセル数からピクセル幅を見積もり、幅と高さを明示する。
// 1セルの幅はデスクトップの等幅13px相当。はみ出すと右が切れるので少し小さめに見積もる
const CELL_PX = 7.6

export const drawWidthOf = (bodyColumns: number): number => Math.max(240, Math.floor(bodyColumns * CELL_PX))

// パネル本体の高さ。見えている行数に1行の高さを掛けて見積もる
const ROW_PX = 18

export const paneHeightOf = (bodyRows: number): number => Math.max(300, bodyRows * ROW_PX)

export const svgSize = (drawWidth: number, viewWidth: number, viewHeight: number) => ({
  width: drawWidth,
  height: Math.round((drawWidth * viewHeight) / viewWidth),
})
