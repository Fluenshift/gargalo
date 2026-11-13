// Simulation engine.
//
// Each simulated second has two passes:
//  1. A deterministic flow pass: traffic per request class travels the graph in
//     topological order. Each node drops the share of load above its capacity,
//     ends the requests it serves, and splits the rest among its targets.
//  2. A sampling pass: individual requests walk the same graph and pick up
//     latency at each node (base + exponential queueing delay that grows with
//     utilization, as in an M/M/1 queue). Their latencies give p50, p95, p99.
//
// A piece may acknowledge a class (a queue answers writes on acceptance). From
// there on the flow pass tracks that load as async work: it no longer counts
// for availability or latency, and losing it is reported apart.
//
// A piece may also refuse load on purpose (a rate limiter answering 429). That
// is fast and cheap, so it adds no latency, but the user still got no answer:
// it counts as a failure of its own kind.
//
// Traffic of class `bot` comes from an abusive client. It loads every piece it
// reaches, but nobody waits for it, so it never counts for availability or
// latency.
//
// What is specific to a kind of piece (routing, state carried between seconds)
// lives in its Spec, so the engine has no per-kind branches.

import { SPECS, botRpsAt, rpsAt, totalCost } from './model'
import type { Architecture, ArchNode, ClassLoad, Level, NodeState, RequestClass, Spec, UserClass } from './model'

/** limited: refused on purpose with a 429 (rate limit). */
export type FailureReason = 'overload' | 'down' | 'noRoute' | 'limited'

export interface NodeStats {
  load: number
  utilization: number
  dropRate: number
  down: boolean
  /** Mean time a request spends at this node (service + queueing), in ms. 0 while down. */
  latencyMs: number
  /** Requests per second refused on purpose with a 429 (pieces that limit), users and bots alike. */
  refused?: number
  /** Requests waiting inside the node at the end of the second (pieces that hold a backlog). */
  backlog?: number
  /** How long a request accepted now waits before it moves on, in ms (pieces that hold a backlog). */
  waitMs?: number
  /** How far behind its source this copy of the data is, in ms (replicas). */
  lagMs?: number
  /** Share of the answers given here that were outdated (replicas). */
  staleRate?: number
}

/**
 * Work the user is no longer waiting for: what a piece acknowledged (a write
 * put in a queue) and still flowed on, per second.
 */
export interface AsyncWork {
  /** Reached the place where it ends. */
  done: number
  /** Lost after the user was answered. */
  lost: number
}

/** Latency percentiles, in ms. */
export interface Percentiles {
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface TickResult extends Percentiles {
  t: number
  /** Requests per second from the users. */
  rps: number
  /** Requests per second from the level's bot, on top of `rps`. */
  botRps: number
  served: number
  /** `served`, split by request class. */
  servedByClass: ClassLoad
  /** Answers that came back with outdated data (reads on a lagging replica). */
  stale: number
  failed: Record<FailureReason, number>
  async: AsyncWork
  nodes: Record<string, NodeStats>
  /** Requests per second on each edge, keyed `${source}->${target}`. */
  edges: Record<string, number>
  latencies: number[]
}

export interface RunSummary extends Percentiles {
  availability: number
  cost: number
  failed: Record<FailureReason, number>
  async: AsyncWork
  /**
   * Requests still waiting in some backlog when the run ends. Acknowledged ones
   * were already answered; the others never were, so they lower availability.
   */
  backlogAtEnd: number
  /** Share of the reads answered with outdated data. */
  staleReadRate: number
  passed: { availability: boolean; p99: boolean; cost: boolean; stale: boolean; all: boolean }
}

const USER_CLASSES: UserClass[] = ['static', 'read', 'write']
const CLASSES: RequestClass[] = [...USER_CLASSES, 'bot']
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
  return { overload: 0, down: 0, noRoute: 0, limited: 0 }
}

function sampleClass(level: Level, rng: Rng): UserClass {
  let r = rng()
  for (const c of USER_CLASSES) {
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
  const botRps = botRpsAt(level, t)
  // More samples in busier seconds, so the run-wide p99 is weighted by traffic.
  const samples = Math.min(1000, Math.max(100, Math.round(rps / 4)))
  const children = new Map<string, string[]>(arch.nodes.map((n) => [n.id, []]))
  const parents = new Map<string, string[]>(arch.nodes.map((n) => [n.id, []]))
  for (const e of arch.edges) {
    children.get(e.source)?.push(e.target)
    parents.get(e.target)?.push(e.source)
  }

  const down = new Map(arch.nodes.map((n) => [n.id, isDown(arch, level, n, t)]))
  const byId = new Map(arch.nodes.map((n) => [n.id, n]))
  const routable = (node: ArchNode, c: RequestClass): string[] => {
    const targets = (children.get(node.id) ?? []).map((id) => ({ id, kind: byId.get(id)!.kind, down: down.get(id)! }))
    const route = pieces[node.kind].route
    return (route ? route(targets, c) : targets).map((target) => target.id)
  }

  const zero = (): ClassLoad => ({ static: 0, read: 0, write: 0, bot: 0 })

  // What a target can take: its capacity, or for a piece that ends nothing
  // itself (a load balancer), what is behind it up to its own capacity.
  const capacityMemo = new Map<string, number>()
  const effectiveCapacity = (id: string): number => {
    if (down.get(id)) return 0
    const cached = capacityMemo.get(id)
    if (cached !== undefined) return cached
    capacityMemo.set(id, 0) // a cycle adds nothing
    const spec = pieces[byId.get(id)!.kind]
    const kids = children.get(id) ?? []
    const endsSomething = Object.values(spec.serves).some((p) => (p ?? 0) > 0)
    const result =
      endsSomething || kids.length === 0
        ? spec.capacity
        : Math.min(spec.capacity, kids.reduce((sum, kid) => sum + effectiveCapacity(kid), 0))
    capacityMemo.set(id, result)
    return result
  }
  const arriving = new Map<string, ClassLoad>(arch.nodes.map((n) => [n.id, zero()]))
  // The part of `arriving` some piece upstream already answered to the user.
  const acked = new Map<string, ClassLoad>(arch.nodes.map((n) => [n.id, zero()]))
  const client = arch.nodes.find((n) => pieces[n.kind].entry)
  if (client) {
    for (const c of USER_CLASSES) arriving.get(client.id)![c] = rps * level.mix[c]
    arriving.get(client.id)!.bot = botRps
  }

  const failed = emptyFailures()
  const async: AsyncWork = { done: 0, lost: 0 }
  const nodes: Record<string, NodeStats> = {}
  const edges: Record<string, number> = {}
  const passRate = new Map<string, number>()
  let served = 0
  let stale = 0
  const servedByClass = zero()
  // Splits a loss between the users still waiting (`waiting` share) and acknowledged work.
  // What a bot loses is nobody's loss.
  const lose = (c: RequestClass, amount: number, waiting: number, reason: FailureReason) => {
    if (c === 'bot') return
    failed[reason] += amount * waiting
    async.lost += amount * (1 - waiting)
  }

  for (const node of topoOrder(arch)) {
    const spec = pieces[node.kind]
    const arrived = arriving.get(node.id)!
    const ack = acked.get(node.id)!
    const isNodeDown = down.get(node.id)!
    let a = arrived
    let dropped = zero()
    let refused = zero()
    let extra: Pick<NodeStats, 'backlog' | 'waitMs' | 'lagMs' | 'staleRate'> = {}
    let staleRate = 0
    // A crashed piece takes nothing in; whatever it holds waits for it to come back.
    if (spec.step && !isNodeDown) {
      const downstreamCapacity = (children.get(node.id) ?? []).reduce((sum, id) => sum + effectiveCapacity(id), 0)
      const sources = (parents.get(node.id) ?? []).map((id) => byId.get(id)!.kind)
      const next = spec.step(arrived, state.get(node.id), { downstreamCapacity, sources })
      a = next.load
      dropped = next.dropped ?? dropped
      refused = next.refused ?? refused
      state.set(node.id, next.state)
      if (next.backlog !== undefined) extra = { backlog: next.backlog, waitMs: next.waitMs }
      if (next.lagMs !== undefined) extra = { ...extra, lagMs: next.lagMs, staleRate: next.staleRate ?? 0 }
      staleRate = next.staleRate ?? 0
    }
    const load = CLASSES.reduce((sum, c) => sum + a[c], 0)
    const pass = isNodeDown ? 0 : load <= spec.capacity ? 1 : spec.capacity / load
    const totalArrived = CLASSES.reduce((sum, c) => sum + arrived[c], 0)
    const totalDropped = CLASSES.reduce((sum, c) => sum + dropped[c], 0)
    const totalRefused = CLASSES.reduce((sum, c) => sum + refused[c], 0)
    const share = (amount: number) => (totalArrived > 0 ? amount / totalArrived : 0)
    // Share of what arrived that gets through: refused at the door, then cut at capacity.
    const through = pass * (1 - share(totalDropped) - share(totalRefused))
    passRate.set(node.id, through)
    const utilization = spec.capacity === Infinity ? 0 : load / spec.capacity
    nodes[node.id] = {
      load,
      utilization,
      // A 429 is the piece doing its job, not losing load.
      dropRate: 1 - through - share(totalRefused),
      down: isNodeDown,
      latencyMs: isNodeDown ? 0 : spec.baseLatencyMs + queueMeanMs(spec, utilization),
      ...extra,
      ...(spec.step && !isNodeDown && totalRefused > 0 ? { refused: totalRefused } : {}),
    }

    for (const c of CLASSES) {
      // Share of this class whose users are still waiting for an answer.
      const waiting = arrived[c] > 0 ? 1 - ack[c] / arrived[c] : 1
      // Bots count for load only: nothing they get or lose is anyone's answer.
      const counts = c !== 'bot'
      lose(c, dropped[c], waiting, 'overload')
      lose(c, refused[c], waiting, 'limited')
      // Past an acknowledging piece nobody waits: the user got the answer on acceptance.
      const acknowledges = !isNodeDown && (spec.acknowledges?.includes(c) ?? false)
      if (acknowledges && counts) {
        served += (arrived[c] - dropped[c] - refused[c]) * waiting
        servedByClass[c] += (arrived[c] - dropped[c] - refused[c]) * waiting
      }
      const outWaiting = acknowledges ? 0 : waiting

      lose(c, a[c] * (1 - pass), outWaiting, isNodeDown ? 'down' : 'overload')
      const survivors = a[c] * pass
      const endsHere = survivors * (spec.serves[c] ?? 0)
      if (counts) {
        served += endsHere * outWaiting
        servedByClass[c] += endsHere * outWaiting
        stale += endsHere * outWaiting * staleRate
        async.done += endsHere * (1 - outWaiting)
      }
      if (endsHere > 0 && spec.replicates?.includes(c)) {
        for (const target of children.get(node.id) ?? []) {
          if (down.get(target)) continue
          arriving.get(target)![c] += endsHere
          acked.get(target)![c] += endsHere
          const key = `${node.id}->${target}`
          edges[key] = (edges[key] ?? 0) + endsHere
        }
      }
      const forward = survivors - endsHere
      if (forward <= 0) continue
      const targets = routable(node, c)
      if (targets.length === 0) {
        lose(c, forward, outWaiting, 'noRoute')
        continue
      }
      for (const target of targets) {
        const share = forward / targets.length
        arriving.get(target)![c] += share
        acked.get(target)![c] += share * (1 - outWaiting)
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
        latency += spec.baseLatencyMs - queueMeanMs(spec, nodes[node.id].utilization) * Math.log(1 - rng())
        if (spec.acknowledges?.includes(c) || rng() < (spec.serves[c] ?? 0)) {
          latencies.push(latency)
          break
        }
        const targets = routable(node, c)
        node = targets.length ? byId.get(targets[Math.floor(rng() * targets.length)]) : undefined
      }
    }
  }

  return { t, rps, botRps, served, servedByClass, stale, failed, async, ...latencyPercentiles(latencies), nodes, edges, latencies }
}

/** Mean queueing delay of an M/M/1 queue at this utilization, capped so it stays finite. */
function queueMeanMs(spec: Spec, utilization: number): number {
  const rho = Math.min(utilization, MAX_UTILIZATION_FOR_LATENCY)
  return (spec.baseLatencyMs * rho) / (1 - rho)
}

/** p50, p95 and p99 of `values`, sorting once. */
export function latencyPercentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((x, y) => x - y)
  const at = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) }
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
  const async: AsyncWork = {
    done: ticks.reduce((s, t) => s + t.async.done, 0),
    lost: ticks.reduce((s, t) => s + t.async.lost, 0),
  }
  const last = ticks.at(-1)
  const readsServed = ticks.reduce((s, t) => s + t.servedByClass.read, 0)
  const staleReadRate = readsServed > 0 ? ticks.reduce((s, t) => s + t.stale, 0) / readsServed : 0
  const backlogAtEnd = last ? Object.values(last.nodes).reduce((s, n) => s + (n.backlog ?? 0), 0) : 0
  const availability = total === 0 ? 1 : served / total
  const latency = latencyPercentiles(ticks.flatMap((t) => t.latencies))
  const cost = totalCost(arch, pieces)
  const passed = {
    availability: availability >= level.goals.minAvailability,
    p99: latency.p99Ms <= level.goals.maxP99Ms,
    cost: cost <= level.goals.maxCost,
    stale: staleReadRate <= (level.goals.maxStaleReads ?? 1),
    all: false,
  }
  passed.all = passed.availability && passed.p99 && passed.cost && passed.stale
  return { availability, ...latency, cost, failed, async, backlogAtEnd, staleReadRate, passed }
}

export function runLevel(arch: Architecture, level: Level, seed = 1, pieces: Record<string, Spec> = SPECS) {
  const rng = mulberry32(seed)
  const state = new Map<string, NodeState>()
  const ticks: TickResult[] = []
  for (let t = 0; t < level.durationS; t++) ticks.push(simulateTick(arch, level, t, rng, state, pieces))
  return { ticks, summary: summarize(arch, level, ticks, pieces) }
}
