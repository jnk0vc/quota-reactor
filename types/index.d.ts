export type UnitName = 'OBSERVER' | 'SCRIBE' | 'EXECUTOR'
export type Verdict = 'idle' | 'running' | 'approved' | 'denied'
export type Unit = { verdict: Verdict; count: number; tool: string }
export type Units = { OBSERVER: Unit; SCRIBE: Unit; EXECUTOR: Unit }
export type LogEntry = {
  id: string
  at: number
  unit: UnitName
  tool: string
  summary: string
  verdict: Verdict
}
export type Alarm = { tool: string; reason: string }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type ContextGauge = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    'quota-reactor': {
      units: Units
      log: LogEntry[]
      startedAt: number
      alarm: Alarm | null
      bash: string | null
      limits: Limit[]
      context: ContextGauge | null
      anchor: number
    }
  }
}
