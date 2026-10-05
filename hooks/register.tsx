import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Alarm, ContextGauge, Limit, LogEntry, UnitName, Units, Verdict } from '../types'
import {
  UNIT_NAMES,
  UNIT_NO,
  VERDICT_COLOR,
  VERDICT_TEXT,
  clip,
  consoleSvg,
  elapsed,
  logRowsFor,
} from './console'
import { ASH, ORANGE, RED, VOID, drawWidthOf, layoutOf, paneHeightOf } from './palette'
import { critical, labelOf, powerRows, powerSvg, resetIn } from './power'

const PANE = 'reactor-core'
const idleUnit = { verdict: 'idle', count: 0, tool: '' } as const
const units = atom({ plugin: 'quota-reactor', key: 'units' } as const, {
  OBSERVER: idleUnit,
  SCRIBE: idleUnit,
  EXECUTOR: idleUnit,
})
const log = atom({ plugin: 'quota-reactor', key: 'log' } as const, [])
const startedAt = atom({ plugin: 'quota-reactor', key: 'startedAt' } as const, 0)
const alarm = atom({ plugin: 'quota-reactor', key: 'alarm' } as const, null)
const bash = atom({ plugin: 'quota-reactor', key: 'bash' } as const, null)
const blink = atom({ plugin: 'quota-reactor', key: 'blink' } as const, false)
const limits = atom({ plugin: 'quota-reactor', key: 'limits' } as const, [])
// 利用枠が3つに満たないとき、空いた基に出すコンテキストの使用量
const context = atom({ plugin: 'quota-reactor', key: 'context' } as const, null)
// タイマーの数え下ろしの起点。秒はSVGの中で進むので、ここは利用枠かコンテキストが動いたときと10分ごとにだけ書き換える。
// 書き換えるとタイマーのSVGが描き直されるため、頻度を上げるとチラつく
const anchor = atom({ plugin: 'quota-reactor', key: 'anchor' } as const, 0)
const REANCHOR_MS = 10 * 60_000

// 読む・探すはOBSERVER、書くはSCRIBE、実行とそれ以外はEXECUTORが審議する
const READERS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LSP', 'ToolSearch']
const WRITERS = ['Edit', 'Write', 'NotebookEdit']
const unitOf = (tool: string): UnitName =>
  READERS.includes(tool) ? 'OBSERVER' : WRITERS.includes(tool) ? 'SCRIBE' : 'EXECUTOR'

const arg = (e: Readonly<Record<string, unknown>>, key: string): string => {
  const value = e[key]
  return typeof value === 'string' ? value : ''
}

const baseName = (path: string): string => path.split('/').pop() ?? path

const summarize = (e: Readonly<Record<string, unknown>>): string =>
  arg(e, 'command') || baseName(arg(e, 'file_path')) || arg(e, 'pattern') || arg(e, 'url')

const toLimits = (windows: readonly Limit[]): Limit[] =>
  windows.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

const toContext = ({ tokens, window, percent }: ContextGauge): ContextGauge => ({ tokens, window, percent })

export const register: Register = on => {
  let blinkTimer: Timer | undefined
  let anchorTimer: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'reactor', description: '利用枠リアクターの監視パネルを開く' })
    const usage = await $.session.usage()
    if ((await read($, startedAt)) === 0) {
      await update($, startedAt, () => usage.startedAt)
    }
    await update($, limits, () => toLimits(usage.rateLimits))
    await update($, context, () => toContext(usage.context))
    const at = await $.clock.now()
    await update($, anchor, () => at)
    anchorTimer?.cancel()
    anchorTimer = $.clock.every(REANCHOR_MS, () => {
      void $.clock.now().then(t => update($, anchor, () => t))
    })
    void $.ui.open({ id: PANE, title: 'QUOTA REACTOR' })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // どちらかが動けばタイマーのSVGは描き直しになるので、起点も今に合わせる
    const isLimitMoved = e.changed.includes('rateLimits')
    const isContextMoved = e.changed.includes('context')
    if (isLimitMoved || isContextMoved) {
      const at = await $.clock.now()
      if (isLimitMoved) await update($, limits, () => toLimits(e.rateLimits))
      if (isContextMoved) await update($, context, () => toContext(e.context))
      await update($, anchor, () => at)
    }

    return next(e)
  })

  on('command.run', { command: 'reactor' }, async $ => {
    // 開き直したSVGは起点から数え始めるので、起点を今に合わせてから開く
    const at = await $.clock.now()
    await update($, anchor, () => at)
    await $.ui.open({ id: PANE, title: 'QUOTA REACTOR' })

    return { text: '監視パネルを開きました。' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, alarm, () => null)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const unit = unitOf(e.tool)
    const isBash = e.tool === 'Bash'
    const entry: LogEntry = {
      id: e.tool_use_id,
      at: await $.clock.now(),
      unit,
      tool: e.tool,
      summary: summarize(e),
      verdict: 'running',
    }
    await update($, units, all => ({
      ...all,
      [unit]: { verdict: 'running', count: all[unit].count + 1, tool: e.tool },
    }))
    await update($, log, list => [...list, entry].slice(-60))
    if (isBash) {
      await update($, bash, () => entry.summary || 'Bash')
      blinkTimer ??= $.clock.every(600, () => void update($, blink, isOn => !isOn))
    }

    let verdict: Verdict = 'denied'
    try {
      const ran = await next(e)
      const reason = ran.deny ?? (ran.isError ? 'エラーを返しました' : undefined)
      verdict = reason === undefined ? 'approved' : 'denied'
      if (reason !== undefined) {
        const raised: Alarm = { tool: e.tool, reason: clip(reason, 80) }
        await update($, alarm, () => raised)
      }

      return ran
    } finally {
      await update($, units, all => ({ ...all, [unit]: { ...all[unit], verdict } }))
      await update($, log, list =>
        list.map(one => (one.id === entry.id ? { ...one, verdict } : one)),
      )
      if (isBash) {
        blinkTimer?.cancel()
        blinkTimer = undefined
        await update($, bash, () => null)
        await update($, blink, () => false)
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = await read($, units)
    const list = await read($, log)
    const origin = await read($, startedAt)
    const windows = await read($, limits)
    const gauge = await read($, context)
    const at = (await read($, anchor)) || (await $.clock.now())
    const isDeliberating = (Object.values(state) as Units[UnitName][]).some(
      one => one.verdict === 'running',
    )
    const decision: Verdict = isDeliberating ? 'running' : (list.at(-1)?.verdict ?? 'idle')

    // Svgのないターミナルでは、電源と3基の決議と記録を文字で並べる
    if (e.surface === 'terminal') {
      const room = Math.max(4, (e.viewport?.rows ?? 40) - 12 - windows.length)
      return (
        <Box flexDirection="column">
          {powerRows(windows, gauge, at).map(row => (
            <Text color={row.color} bold>
              {row.text}
            </Text>
          ))}
          <Text color={ORANGE} bold>
            TRIAD CORE ── 決議 {VERDICT_TEXT[decision]}
          </Text>
          {UNIT_NAMES.map(name => (
            <Text color={VERDICT_COLOR[state[name].verdict]}>
              {`${name}・${UNIT_NO[name]} ${VERDICT_TEXT[state[name].verdict]} ${state[name].tool}`}
            </Text>
          ))}
          <Text color={ORANGE} bold>
            作戦記録
          </Text>
          {list.slice(-room).map(one => (
            <Text key={one.id} color={ASH} wrap="truncate-end">
              {`${elapsed(origin, one.at)} ${one.unit.slice(0, 3)} ${VERDICT_TEXT[one.verdict]} ${one.tool} ${one.summary}`}
            </Text>
          ))}
        </Box>
      )
    }

    // 文字はすべてSVGの中で明朝体にする。秒の進みはSVGの中のSMILに任せる
    const { Svg } = $.ui.resolve(e)
    const drawWidth = drawWidthOf(e.props.bodyColumns)
    const layout = layoutOf(drawWidth)
    const power = powerSvg(windows, gauge, at, layout, drawWidth)
    const rows = logRowsFor(layout, drawWidth, paneHeightOf(e.props.scroll.bodyRows), power.height)
    const board = consoleSvg(state, decision, list, origin, layout, drawWidth, rows)
    return (
      <Box flexDirection="column" backgroundColor={VOID}>
        <Svg
          source={power.source}
          width={power.width}
          height={power.height}
          alt={`稼働限界: ${powerRows(windows, gauge, at)
            .map(row => row.text)
            .join(' / ')}`}
          isInteractive
        />
        <Svg
          source={board.source}
          width={board.width}
          height={board.height}
          alt={`TRIAD 決議: ${VERDICT_TEXT[decision]}、作戦記録 ${list.length}件`}
          isInteractive
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const command = await read($, bash)
    const warning = await read($, alarm)
    const isOn = await read($, blink)
    const list = await read($, log)
    const nearLimit = critical(await read($, limits))
    if (command === null && warning === null && nearLimit === undefined && !e.props.isWorking) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 16)

    if (command !== null) {
      return (
        <Box flexDirection="row" backgroundColor={isOn ? VOID : RED} paddingX={1} gap={1}>
          <Box flexShrink={0}>
            <Text color={isOn ? RED : VOID} bold wrap="truncate-end">
              ◢◤◢◤ 警告 EMERGENCY
            </Text>
          </Box>
          <Text color={isOn ? RED : VOID} wrap="truncate-end">
            外部コマンド実行中 {clip(command, width)}
          </Text>
        </Box>
      )
    }

    if (warning !== null) {
      return (
        <Box flexDirection="row" backgroundColor={RED} paddingX={1} gap={1}>
          <Box flexShrink={0}>
            <Text color={VOID} bold>
              否決
            </Text>
          </Box>
          <Text color={VOID} wrap="truncate-end">
            {warning.tool}: {warning.reason}
          </Text>
          <Button key="ack" label="確認" onPress={() => update($, alarm, () => null)} />
        </Box>
      )
    }

    if (nearLimit !== undefined) {
      const left = Math.max(0, Math.round(100 - nearLimit.percentUsed))
      const renewal = resetIn(nearLimit, await $.clock.now())
      return (
        <Box flexDirection="row" backgroundColor={RED} paddingX={1} gap={1}>
          <Box flexShrink={0}>
            <Text color={VOID} bold wrap="truncate-end">
              ◢◤◢◤ {left === 0 ? '稼働停止' : '稼働限界接近'}
            </Text>
          </Box>
          <Text color={VOID} wrap="truncate-end">
            {labelOf(nearLimit.kind)} 残り{left}%{renewal ? ` ・ 更新${renewal}` : ''}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" backgroundColor={ORANGE} paddingX={1} gap={1}>
        <Text color={VOID} bold>
          ◢◤◢◤ 作戦行動中
        </Text>
        <Text color={VOID}>審議 {list.length}件</Text>
      </Box>
    )
  })
}
