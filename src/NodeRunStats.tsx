import { useMemo } from 'react'
import { Sparkline } from './Sparkline'
import type { TickResult } from './sim/engine'
import { nodeSeries } from './sim/metrics'

interface Props {
  ticks: TickResult[]
  nodeId: string
  /** How many simulated seconds are on screen (the "rever o segundo" position). */
  shown: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
const pct = (n: number) => `${Math.round(n * 100)}%`

/** One piece's load, utilization, drop rate and latency over the run, up to the second on screen. */
export function NodeRunStats({ ticks, nodeId, shown }: Props) {
  const series = useMemo(() => nodeSeries(ticks, nodeId), [ticks, nodeId])
  const i = Math.min(shown, ticks.length) - 1
  const now = i >= 0
  const down = now && series.down[i]
  const upTo = (values: number[]) => values.slice(0, Math.max(0, i + 1))
  const peak = (values: number[]) => Math.max(1e-9, ...values)

  const rows = [
    {
      name: 'Carga',
      value: now ? `${fmt(series.load[i])} req/s` : '—',
      bad: false,
      values: series.load,
      max: peak(series.load),
    },
    {
      name: 'Utilização',
      value: now ? pct(series.utilization[i]) : '—',
      bad: now && series.utilization[i] > 1,
      values: series.utilization,
      goal: 1,
      max: Math.max(1.2, ...series.utilization),
    },
    {
      name: 'Descarte',
      value: now ? pct(series.dropRate[i]) : '—',
      bad: now && series.dropRate[i] > 0.001,
      values: series.dropRate,
      max: 1,
    },
    {
      name: 'Latência média',
      value: !now || down ? '—' : `${fmt(series.latencyMs[i])} ms`,
      bad: false,
      values: series.latencyMs,
      max: peak(series.latencyMs),
    },
  ]

  return (
    <section className="noderun" aria-label="Esta peça na rodada">
      <p className="noderun__at">
        {now ? `Segundo ${i + 1} de ${ticks.length}` : 'Rode a simulação para ver esta peça'}
        {down && ' · fora do ar'}
      </p>
      {rows.map((r) => (
        <div key={r.name} className={`meter${r.bad ? ' is-bad' : ''}`}>
          <span className="meter__name">{r.name}</span>
          <span className="meter__value">{r.value}</span>
          <Sparkline
            label={`${r.name} por segundo`}
            values={upTo(r.values)}
            length={ticks.length}
            goal={r.goal}
            max={r.max}
          />
        </div>
      ))}
    </section>
  )
}
