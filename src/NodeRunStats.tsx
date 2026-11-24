import { useMemo } from 'react'
import { Sparkline } from './Sparkline'
import type { TickResult } from './sim/engine'
import type { Kind } from './sim/model'
import { nodeSeries, waitLabel } from './sim/metrics'

interface Props {
  ticks: TickResult[]
  nodeId: string
  kind: Kind
  /** How many simulated seconds are on screen (the "Rever o momento" position). */
  shown: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
const pct = (n: number) => `${Math.round(n * 100)}%`

/** One piece's load, utilization, drop rate and latency over the run, up to the second on screen. */
export function NodeRunStats({ ticks, nodeId, kind, shown }: Props) {
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
  if (series.backlog && series.waitMs) {
    // A stalled queue (nothing draining it) plots at the top of the chart.
    const finiteWait = series.waitMs.filter(Number.isFinite)
    const waitTop = peak(finiteWait)
    rows.push(
      {
        name: 'Fila',
        value: now ? `${fmt(series.backlog[i])} msgs` : '—',
        bad: now && series.backlog[i] > 0 && i === ticks.length - 1,
        values: series.backlog,
        max: peak(series.backlog),
      },
      {
        name: 'Tempo até processar',
        value: now ? waitLabel(series.waitMs[i]) : '—',
        bad: now && !Number.isFinite(series.waitMs[i]),
        values: series.waitMs.map((v) => (Number.isFinite(v) ? v : waitTop)),
        max: waitTop,
      },
    )
  }
  if (series.lagMs && series.staleRate) {
    const finiteLag = series.lagMs.filter(Number.isFinite)
    const lagTop = peak(finiteLag)
    rows.push(
      {
        name: kind === 'search' ? 'Atraso do índice' : 'Atraso de replicação',
        value: now ? waitLabel(series.lagMs[i], kind === 'search' ? 'sem tópico' : 'sem primário') : '—',
        bad: now && !Number.isFinite(series.lagMs[i]),
        values: series.lagMs.map((v) => (Number.isFinite(v) ? v : lagTop)),
        max: lagTop,
      },
      {
        name: kind === 'search' ? 'Buscas sem os vídeos novos' : 'Leituras desatualizadas',
        value: now ? pct(series.staleRate[i]) : '—',
        bad: now && series.staleRate[i] >= 0.01,
        values: series.staleRate,
        max: Math.max(0.05, ...series.staleRate),
      },
    )
  }

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
