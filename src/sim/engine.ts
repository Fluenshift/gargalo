// Simulation engine.
//
// Each simulated second has two passes:
//  1. A deterministic flow pass: traffic per request class travels the graph in
//     topological order. Each node drops the share of load above its capacity,
//     ends the requests it serves, and splits the rest among its targets.
//  2. A sampling pass: individual requests walk the same graph and pick up
//     latency at each node (base + exponential queueing delay that grows with
//     utilization, as in an M/M/1 queue). Their latencies give the p99.
//
// What is specific to a kind of piece (routing, state carried between seconds)
// lives in its Spec, so the engine has no per-kind branches.

import { SPECS, rpsAt, totalCost } from './model'
import type { Architecture, ArchNode, ClassLoad, Level, NodeState, RequestClass, Spec } from './model'

export type FailureReason = 'overload' | 'down' | 'noRoute'

export interface NodeStats {
  load: number
  utilization: number
  dropRate: number
  down: boolean
}

export interface TickResult {
  t: number
  rps: number
  served: number
  failed: Record<FailureReason, number>
  p99Ms: number
  nodes: Record<string, NodeStats>
  /** Requests per second on each edge, keyed `${source}->${target}`. */
  edges: Record<string, number>
  latencies: number[]
}

export interface RunSummary {
  availability: number
  p99Ms: number
  cost: number
  failed: Record<FailureReason, number>
  passed: { availability: boolean; p99: boolean; cost: boolean; all: boolean }
}

const CLASSES: RequestClass[] = ['static', 'read', 'write']
const MAX_UTILIZATION_FOR_LATENCY = 0.95

export type Rng = () => number

/** Small seeded PRNG so runs are reproducible. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function isDown(arch: Architecture, level: Level, node: ArchNode, t: number): boolean {
  return level.failures.some((f) => {
    if (f.kind !== node.kind || t < f.from || t >= f.to) return false
    const sameKind = arch.nodes.filter((n) => n.kind === f.kind)
    return sameKind[f.index]?.id === node.id
  })
}

function topoOrder(arch: Architecture): ArchNode[] {
  const indegree = new Map(arch.nodes.map((n) => [n.id, 0]))
  for (const e of arch.edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  const byId = new Map(arch.nodes.map((n) => [n.id, n]))
  const queue = arch.nodes.filter((n) => indegree.get(n.id) === 0)
  const order: ArchNode[] = []
  while (queue.length) {
    const node = queue.shift()!
    order.push(node)
    for (const e of arch.edges) {
      if (e.source !== node.id) continue
      const d = indegree.get(e.target)! - 1
      indegree.set(e.target, d)
      if (d === 0) queue.push(byId.get(e.target)!)
    }
  }
  // Nodes caught in a cycle never reach indegree 0 and receive no traffic.
  return order
}

function emptyFailures(): Record<FailureReason, number> {
  return { overload: 0, down: 0, noRoute: 0 }
}

function sampleClass(level: Level, rng: Rng): RequestClass {
  let r = rng()
  for (const c of CLASSES) {
    r -= level.mix[c]
    if (r < 0) return c
  }
  return 'read'
}

/**
 * Simulates second `t`. `state` holds what each node carries to the next
 * second; it is read and updated in place, so pass the same map to every tick
 * of a run.
 */
export function simulateTick(
  arch: Architecture,
  level: Level,
  t: number,
  rng: Rng,
  state: Map<string, NodeState> = new Map(),
  pieces: Record<string, Spec> = SPECS,
): TickResult {
  const rps = rpsAt(level, t)
  // More samples in busier seconds, so the run-wide p99 is weighted by traffic.
  const samples = Math.min(1000, Math.max(100, Math.round(rps / 4)))
  const children = new Map<string, string[]>(arch.nodes.map((n) => [n.id, []]))
  for (const e of arch.edges) children.get(e.source)?.push(e.target)

  const down = new Map(arch.nodes.map((n) => [n.id, isDown(arch, level, n, t)]))
  const byId = new Map(arch.nodes.map((n) => [n.id, n]))
  const routable = (node: ArchNode, c: RequestClass): string[] => {
    const targets = (children.get(node.id) ?? []).map((id) => ({ id, kind: byId.get(id)!.kind, down: down.get(id)! }))
    const route = pieces[node.kind].route
    return (route ? route(targets, c) : targets).map((target) => target.id)
  }

  const arriving = new Map<string, ClassLoad>(
    arch.nodes.map((n) => [n.id, { static: 0, read: 0, write: 0 }]),
  )
  const client = arch.nodes.find((n) => pieces[n.kind].entry)
  if (client) for (const c of CLASSES) arriving.get(client.id)![c] = rps * level.mix[c]

  const failed = emptyFailures()
  const nodes: Record<string, NodeStats> = {}
  const edges: Record<string, number> = {}
  const passRate = new Map<string, number>()
  let served = 0

  for (const node of topoOrder(arch)) {
    const spec = pieces[node.kind]
    let a = arriving.get(node.id)!
    if (spec.step) {
      const next = spec.step(a, state.get(node.id))
      a = next.load
      state.set(node.id, next.state)
    }
    const load = a.static + a.read + a.write
    const isNodeDown = down.get(node.id)!
    const pass = isNodeDown ? 0 : load <= spec.capacity ? 1 : spec.capacity / load
    passRate.set(node.id, pass)
    nodes[node.id] = {
      load,
      utilization: spec.capacity === Infinity ? 0 : load / spec.capacity,
      dropRate: 1 - pass,
      down: isNodeDown,
    }
    failed[isNodeDown ? 'down' : 'overload'] += load * (1 - pass)

    for (const c of CLASSES) {
      const survivors = a[c] * pass
      const endsHere = survivors * (spec.serves[c] ?? 0)
      served += endsHere
      const forward = survivors - endsHere
      if (forward <= 0) continue
      const targets = routable(node, c)
      if (targets.length === 0) {
        failed.noRoute += forward
        continue
      }
      for (const target of targets) {
        const share = forward / targets.length
        arriving.get(target)![c] += share
        const key = `${node.id}->${target}`
        edges[key] = (edges[key] ?? 0) + share
      }
    }
  }

  // Sampling pass for latency.
  const latencies: number[] = []
  if (client && rps > 0) {
    for (let i = 0; i < samples; i++) {
      const c = sampleClass(level, rng)
      let node: ArchNode | undefined = client
      let latency = 0
      while (node) {
        if (rng() >= (passRate.get(node.id) ?? 0)) break
        const spec = pieces[node.kind]
        const rho = Math.min(nodes[node.id].utilization, MAX_UTILIZATION_FOR_LATENCY)
        const queueMean = (spec.baseLatencyMs * rho) / (1 - rho)
        latency += spec.baseLatencyMs - queueMean * Math.log(1 - rng())
        if (rng() < (spec.serves[c] ?? 0)) {
          latencies.push(latency)
          break
        }
        const targets = routable(node, c)
        node = targets.length ? byId.get(targets[Math.floor(rng() * targets.length)]) : undefined
      }
    }
  }

  return { t, rps, served, failed, p99Ms: percentile(latencies, 0.99), nodes, edges, latencies }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

export function summarize(
  arch: Architecture,
  level: Level,
  ticks: TickResult[],
  pieces: Record<string, Spec> = SPECS,
): RunSummary {
  const total = ticks.reduce((s, t) => s + t.rps, 0)
  const served = ticks.reduce((s, t) => s + t.served, 0)
  const failed = emptyFailures()
  for (const tick of ticks) for (const r of Object.keys(failed) as FailureReason[]) failed[r] += tick.failed[r]
  const availability = total === 0 ? 1 : served / total
  const p99Ms = percentile(ticks.flatMap((t) => t.latencies), 0.99)
  const cost = totalCost(arch, pieces)
  const passed = {
    availability: availability >= level.goals.minAvailability,
    p99: p99Ms <= level.goals.maxP99Ms,
    cost: cost <= level.goals.maxCost,
    all: false,
  }
  passed.all = passed.availability && passed.p99 && passed.cost
  return { availability, p99Ms, cost, failed, passed }
}

export function runLevel(arch: Architecture, level: Level, seed = 1, pieces: Record<string, Spec> = SPECS) {
  const rng = mulberry32(seed)
  const state = new Map<string, NodeState>()
  const ticks: TickResult[] = []
  for (let t = 0; t < level.durationS; t++) ticks.push(simulateTick(arch, level, t, rng, state, pieces))
  return { ticks, summary: summarize(arch, level, ticks, pieces) }
}
