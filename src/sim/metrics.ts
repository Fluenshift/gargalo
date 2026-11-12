// Numbers derived from a run for the console and the piece panel.

import type { TickResult } from './engine'
import { rpsAt } from './model'
import type { Level } from './model'

const SECONDS_PER_MONTH = 30 * 24 * 60 * 60

/**
 * Dollars per 1 million requests: monthly cost ÷ requests per month, taking a
 * month of traffic at the level's average rps. Undefined when there is no traffic.
 */
export function costPerMillion(monthlyCost: number, level: Level): number | undefined {
  let total = 0
  for (let t = 0; t < level.durationS; t++) total += rpsAt(level, t)
  const averageRps = level.durationS > 0 ? total / level.durationS : 0
  if (averageRps <= 0) return undefined
  return monthlyCost / ((averageRps * SECONDS_PER_MONTH) / 1_000_000)
}

/** Id of the node with the highest utilization in this second, if any is loaded. */
export function mostSaturated(tick: TickResult): string | undefined {
  let best: string | undefined
  let top = 0
  for (const [id, stats] of Object.entries(tick.nodes)) {
    if (stats.utilization > top) {
      top = stats.utilization
      best = id
    }
  }
  return best
}

export interface NodeSeries {
  load: number[]
  utilization: number[]
  dropRate: number[]
  latencyMs: number[]
  down: boolean[]
}

/** One piece's numbers per second of the run. Seconds where it did not exist count as idle. */
export function nodeSeries(ticks: TickResult[], nodeId: string): NodeSeries {
  const series: NodeSeries = { load: [], utilization: [], dropRate: [], latencyMs: [], down: [] }
  for (const tick of ticks) {
    const s = tick.nodes[nodeId]
    series.load.push(s?.load ?? 0)
    series.utilization.push(s?.utilization ?? 0)
    series.dropRate.push(s?.dropRate ?? 0)
    series.latencyMs.push(s?.latencyMs ?? 0)
    series.down.push(s?.down ?? false)
  }
  return series
}
