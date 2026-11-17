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
// A link can retry failed calls and carry a circuit breaker. Such a link
// settles its users' fate right there, from how often the target answered in
// the previous second: with r retries a user fails only if all r + 1 attempts
// fail. Every attempt still loads the target, but past the link that load is
// "ghost" work whose outcome nobody counts any more. Without backoff all
// retries land in the same second and pile on a struggling target; a piece
// with `crashesAbove` goes down when that pile gets too big. A breaker stops
// calling a target that fails most calls, fails fast for a while and then
// lets a probe through.
//
// A node splits what it forwards evenly among its targets, except among
// partitions of the data: each gets an equal key range, and the level's hot key
// lands whole on one of them. A geographic piece (DNS) sends each region's
// users to the closest live targets instead.
//
// Pieces run in regions. A call that crosses regions pays the round trip
// between them, and a region can go dark with everything running in it.
//
// What is specific to a kind of piece (routing, state carried between seconds)
// lives in its Spec, so the engine has no per-kind branches.

import { ANSWER_LOST, PROTOCOLS, levelWork, REGION_RTT_MS, SPECS, botRpsAt, levelPieces, regionOf, rpsAt, totalCost, userRegions } from './model'
import type { Architecture, ArchNode, ClassLoad, Level, NodeState, Region, RequestClass, Spec, UserClass } from './model'

/** limited: refused on purpose with a 429 (rate limit). breaker: failed fast by an open circuit breaker. */
export type FailureReason = 'overload' | 'down' | 'noRoute' | 'limited' | 'breaker'

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
  /** Writes carried out a second time by a retry whose first answer got lost. */
  duplicates: number
  failed: Record<FailureReason, number>
  async: AsyncWork
  nodes: Record<string, NodeStats>
  /** Requests per second on each edge, keyed `${source}->${target}`, retries included. */
  edges: Record<string, number>
  /** Edges whose circuit breaker is open (nothing goes through) or half-open (a probe goes through). */
  breakers: Record<string, 'open' | 'half-open'>
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
  /** Share of the writes carried out twice. */
  duplicateRate: number
  passed: { availability: boolean; p99: boolean; cost: boolean; stale: boolean; duplicates: boolean; all: boolean }
}

const USER_CLASSES: UserClass[] = ['static', 'read', 'write']
const CLASSES: RequestClass[] = [...USER_CLASSES, 'bot']
const MAX_UTILIZATION_FOR_LATENCY = 0.95
/** A breaker opens when fewer than this share of the calls through it succeed. */
export const BREAKER_THRESHOLD = 0.5
/** Seconds an open breaker fails fast before letting a probe through. */
export const BREAKER_OPEN_S = 5
/** Share of the calls a half-open breaker lets through to test the target. */
export const BREAKER_PROBE = 0.1
/** Seconds a piece stays down after load past `crashesAbove` takes it out. */
export const CRASH_DOWN_S = 5

/** Expected attempts per call and the chance a call finally succeeds, given one attempt succeeds with `s`. */
export function retryOutcome(s: number, retries: number, backoff: boolean): { attempts: number; success: number } {
  const f = 1 - s
  // With backoff and jitter only the first retry falls in the same second; later ones find the target recovered or give up.
  let attempts = 1
  if (backoff) attempts += retries > 0 ? f : 0
  else for (let k = 1; k <= retries; k++) attempts += f ** k
  return { attempts, success: 1 - f ** (retries + 1) }
}

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

export function isDown(arch: Architecture, level: Level, node: ArchNode, t: number, pieces: Record<string, Spec> = SPECS): boolean {
  const region = regionOf(node)
  const regional = !pieces[node.kind].global
  if (regional && level.regionOutages?.some((o) => o.region === region && t >= o.from && t < o.to)) return true
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
  return { overload: 0, down: 0, noRoute: 0, limited: 0, breaker: 0 }
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

  const crashed = (id: string) => t < (state.get(`crash:${id}`)?.until ?? -1)
  const down = new Map(arch.nodes.map((n) => [n.id, isDown(arch, level, n, t, pieces) || crashed(n.id)]))
  const policies = new Map(arch.edges.map((e) => [`${e.source}->${e.target}`, e]))
  /** Share of calls the link lets through this second: 0 while its breaker is open, a probe while half-open. */
  const breakers: TickResult['breakers'] = {}
  const letThrough = (key: string): number => {
    const b = state.get(`edge:${key}`)
    if (!b?.open) return 1
    if (t < b.until) {
      breakers[key] = 'open'
      return 0
    }
    breakers[key] = 'half-open'
    return BREAKER_PROBE
  }
  /** How often one call to `id` succeeded last second, per class (1 before anything is known). */
  const lastSuccess = (id: string, c: RequestClass) => state.get(`succ:${id}`)?.[c] ?? 1
  const byId = new Map(arch.nodes.map((n) => [n.id, n]))
  const routable = (node: ArchNode, c: RequestClass): string[] => {
    const targets = (children.get(node.id) ?? []).map((id) => ({ id, kind: byId.get(id)!.kind, down: down.get(id)! }))
    const route = pieces[node.kind].route
    return (route ? route(targets, c) : targets).map((target) => target.id)
  }
  // The partition that holds the hot key is the first one created, the same whoever sends to it.
  const created = new Map(arch.nodes.map((n, i) => [n.id, i]))
  const users = userRegions(level)
  /**
   * Share of a node's forwarded class-`c` load each target gets: equal, except that a
   * geographic node sends each region's users to its closest targets (only `from`'s users
   * when given) and partitions split keys.
   */
  const shares = (node: ArchNode, targets: string[], c: RequestClass, from?: Region): number[] => {
    const even = 1 / targets.length
    if (pieces[node.kind].geo) {
      const weights = targets.map(() => 0)
      for (const [region, share] of from ? ([[from, 1]] as [Region, number][]) : users) {
        const rtt = targets.map((id) => REGION_RTT_MS[region][regionOf(byId.get(id)!)])
        const closest = rtt.filter((r) => r === Math.min(...rtt)).length
        rtt.forEach((r, i) => {
          if (r === Math.min(...rtt)) weights[i] += share / closest
        })
      }
      return weights
    }
    const keyed = targets.filter((id) => pieces[byId.get(id)!.kind].partitioned)
    if (keyed.length === 0) return targets.map(() => even)
    // A bot scrapes the whole catalogue; only people pile onto the viral key.
    const hot = c === 'bot' ? 0 : (level.hotKey ?? 0)
    const hotId = keyed.reduce((a, b) => (created.get(a)! <= created.get(b)! ? a : b))
    return targets.map((id) =>
      !keyed.includes(id) ? even : even * (1 - hot) + (id === hotId ? even * keyed.length * hot : 0),
    )
  }

  const zero = (): ClassLoad => ({ static: 0, read: 0, write: 0, bot: 0 })

  // What one request costs on each piece, from the code as the player left it.
  const work = levelWork(level, arch)
  const workOf = (node: ArchNode, c: RequestClass) => work.filter((w) => w.kinds.includes(node.kind) && w.classes.includes(c))
  const weight = (node: ArchNode, c: RequestClass) => workOf(node, c).reduce((f, w) => f * w.factor, 1)
  const extraMs = (node: ArchNode, c: RequestClass) => workOf(node, c).reduce((ms, w) => ms + (w.extraMs ?? 0), 0)

  /**
   * Share of class `c` a node ends. An HTTP cache only keeps what the protocol of the
   * links into it lets it keep, in proportion to those links.
   */
  const servesOf = (node: ArchNode, c: RequestClass): number => {
    const spec = pieces[node.kind]
    const base = spec.serves[c] ?? 0
    if (!spec.httpCache || base === 0) return base
    const incoming = arch.edges.filter((e) => e.target === node.id)
    if (incoming.length === 0) return base
    const kept = incoming.filter((e) => !PROTOCOLS[e.protocol ?? 'rest'].uncached.includes(c)).length
    return (base * kept) / incoming.length
  }

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
  // The part of `arriving` whose outcome a retrying link upstream already settled: load only.
  const ghost = new Map<string, ClassLoad>(arch.nodes.map((n) => [n.id, zero()]))
  /** User calls per class that went through each link with a policy, to judge its breaker. */
  const policyCalls = new Map<string, ClassLoad>()
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
  let duplicates = 0
  const servedByClass = zero()
  // Splits a loss between the users still waiting (`waiting` share) and acknowledged work
  // (`asyncShare`); the rest is ghost work nobody counts. What a bot loses is nobody's loss.
  const lose = (c: RequestClass, amount: number, waiting: number, asyncShare: number, reason: FailureReason) => {
    if (c === 'bot') return
    failed[reason] += amount * waiting
    async.lost += amount * asyncShare
  }

  for (const node of topoOrder(arch)) {
    const spec = pieces[node.kind]
    const arrived = arriving.get(node.id)!
    const ack = acked.get(node.id)!
    const gho = ghost.get(node.id)!
    const isNodeDown = down.get(node.id)!
    let a = arrived
    let dropped = zero()
    let refused = zero()
    let extra: Pick<NodeStats, 'backlog' | 'waitMs' | 'lagMs' | 'staleRate'> = {}
    let staleRate = 0
    // A crashed piece takes nothing in; whatever it holds waits for it to come back.
    if (spec.step && !isNodeDown) {
      const downstreamCapacity = (children.get(node.id) ?? []).reduce((sum, id) => sum + effectiveCapacity(id), 0)
      const feeders = (parents.get(node.id) ?? []).map((id) => byId.get(id)!)
      const sources = feeders.map((n) => n.kind)
      const sourceRttMs = Math.max(
        0,
        ...feeders.filter((n) => !pieces[n.kind].global).map((n) => REGION_RTT_MS[regionOf(n)][regionOf(node)]),
      )
      const next = spec.step(arrived, state.get(node.id), { downstreamCapacity, sources, sourceRttMs })
      a = next.load
      dropped = next.dropped ?? dropped
      refused = next.refused ?? refused
      state.set(node.id, next.state)
      if (next.backlog !== undefined) extra = { backlog: next.backlog, waitMs: next.waitMs }
      if (next.lagMs !== undefined) extra = { ...extra, lagMs: next.lagMs, staleRate: next.staleRate ?? 0 }
      staleRate = next.staleRate ?? 0
    }
    const load = CLASSES.reduce((sum, c) => sum + a[c] * weight(node, c), 0)
    // What capacity lets through, then what survives the random blips of a flaky piece.
    const capPass = isNodeDown ? 0 : load <= spec.capacity ? 1 : spec.capacity / load
    const blips = spec.flaky ?? 0
    const pass = capPass * (1 - blips)
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
      // Shares of this class: users still waiting, work already acknowledged, and ghost load.
      const asyncShare = arrived[c] > 0 ? ack[c] / arrived[c] : 0
      const ghostShare = arrived[c] > 0 ? gho[c] / arrived[c] : 0
      const waiting = Math.max(0, 1 - asyncShare - ghostShare)
      // Bots count for load only: nothing they get or lose is anyone's answer.
      const counts = c !== 'bot'
      lose(c, dropped[c], waiting, asyncShare, 'overload')
      lose(c, refused[c], waiting, asyncShare, 'limited')
      // Past an acknowledging piece nobody waits: the user got the answer on acceptance.
      const acknowledges = !isNodeDown && (spec.acknowledges?.includes(c) ?? false)
      if (acknowledges && counts) {
        served += (arrived[c] - dropped[c] - refused[c]) * waiting
        servedByClass[c] += (arrived[c] - dropped[c] - refused[c]) * waiting
      }
      const outWaiting = acknowledges ? 0 : waiting
      const outAsync = acknowledges ? asyncShare + waiting : asyncShare

      lose(c, a[c] * (1 - capPass), outWaiting, outAsync, isNodeDown ? 'down' : 'overload')
      lose(c, a[c] * capPass * blips, outWaiting, outAsync, 'down')
      const survivors = a[c] * pass
      const endsHere = survivors * servesOf(node, c)
      if (counts) {
        served += endsHere * outWaiting
        servedByClass[c] += endsHere * outWaiting
        stale += endsHere * outWaiting * staleRate
        async.done += endsHere * outAsync
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
        lose(c, forward, outWaiting, outAsync, 'noRoute')
        continue
      }
      const split = shares(node, targets, c)
      for (const [i, target] of targets.entries()) {
        const share = forward * split[i]
        const key = `${node.id}->${target}`
        const policy = policies.get(key)
        let sent = share
        if (policy && ((policy.retries ?? 0) > 0 || policy.breaker)) {
          // This link settles its users here; what it sends on is load nobody counts.
          const open = policy.breaker ? letThrough(key) : 1
          const users = share * outWaiting
          const work = share * outAsync
          if (counts) failed.breaker += users * (1 - open)
          if (counts) async.lost += work * (1 - open)
          // How many attempts pile on follows from how the target did last second; whether the
          // users get an answer is settled below, once the target's outcome this second is known.
          const { attempts } = retryOutcome(down.get(target) ? 0 : lastSuccess(target, c), policy.retries ?? 0, policy.backoff ?? false)
          const tried = users * open
          // Each retry follows a failure that, now and then, had already gone through.
          if (c === 'write' && !policy.idempotent) duplicates += tried * (attempts - 1) * ANSWER_LOST
          if (counts) {
            const calls = policyCalls.get(key) ?? zero()
            calls[c] += tried
            policyCalls.set(key, calls)
          }
          const ghostLoad = tried * attempts + share * (1 - outWaiting - outAsync) * open
          sent = ghostLoad + work * open
          ghost.get(target)![c] += ghostLoad
          acked.get(target)![c] += work * open
        } else {
          acked.get(target)![c] += share * outAsync
          ghost.get(target)![c] += share * (1 - outWaiting - outAsync)
        }
        arriving.get(target)![c] += sent
        edges[key] = (edges[key] ?? 0) + sent
      }
    }

    // Too much load takes a fragile piece out for a while.
    if (!isNodeDown && spec.crashesAbove !== undefined && load > spec.crashesAbove * spec.capacity) {
      state.set(`crash:${node.id}`, { until: t + 1 + CRASH_DOWN_S })
    }
  }

  // How often one call to each piece succeeded this second, per class: what retrying links
  // and breakers upstream judge it by next second. Children first.
  const success = new Map<string, Record<string, number>>()
  for (const node of [...topoOrder(arch)].reverse()) {
    const spec = pieces[node.kind]
    const through = down.get(node.id) ? 0 : (passRate.get(node.id) ?? 0)
    const result: Record<string, number> = {}
    for (const c of USER_CLASSES) {
      if (spec.acknowledges?.includes(c)) {
        result[c] = through
        continue
      }
      const ends = servesOf(node, c)
      const targets = routable(node, c)
      const split = targets.length ? shares(node, targets, c) : []
      const onward = targets.reduce((sum, target, i) => {
        const key = `${node.id}->${target}`
        const policy = policies.get(key)
        const s = success.get(target)?.[c] ?? 0
        if (!policy || (!(policy.retries ?? 0) && !policy.breaker)) return sum + split[i] * s
        const open = breakers[key] === 'open' ? 0 : 1
        return sum + split[i] * open * retryOutcome(s, policy.retries ?? 0, policy.backoff ?? false).success
      }, 0)
      result[c] = through * (ends + (1 - ends) * onward)
    }
    success.set(node.id, result)
    state.set(`succ:${node.id}`, result)
  }

  // Users who went through a link with a policy: answered unless every attempt failed.
  for (const [key, calls] of policyCalls) {
    const policy = policies.get(key)!
    const target = key.slice(key.indexOf('->') + 2)
    for (const c of USER_CLASSES) {
      if (calls[c] <= 0) continue
      const { success: answered } = retryOutcome(success.get(target)?.[c] ?? 0, policy.retries ?? 0, policy.backoff ?? false)
      served += calls[c] * answered
      servedByClass[c] += calls[c] * answered
      failed[down.get(target) ? 'down' : 'overload'] += calls[c] * (1 - answered)
    }
  }

  // Breakers judge the calls that went through them this second.
  for (const [key, policy] of policies) {
    if (!policy.breaker) continue
    const calls = policyCalls.get(key)
    const total = calls ? USER_CLASSES.reduce((sum, c) => sum + calls[c], 0) : 0
    if (total <= 0) continue
    const target = key.slice(key.indexOf('->') + 2)
    const ok = USER_CLASSES.reduce((sum, c) => sum + calls![c] * (success.get(target)?.[c] ?? 0), 0) / total
    if (ok < BREAKER_THRESHOLD) state.set(`edge:${key}`, { open: 1, until: t + 1 + BREAKER_OPEN_S })
    else if (state.get(`edge:${key}`)?.open) state.set(`edge:${key}`, { open: 0, until: 0 })
  }

  // Sampling pass for latency.
  const latencies: number[] = []
  if (client && rps > 0) {
    for (let i = 0; i < samples; i++) {
      const c = sampleClass(level, rng)
      // Drawn only when users come from several regions, so single-region runs keep their numbers.
      const from = users.length > 1 ? pick(users.map(([r]) => r), users.map(([, s]) => s), rng()) : users[0][0]
      let node: ArchNode | undefined = client
      let latency = 0
      while (node) {
        if (rng() >= (passRate.get(node.id) ?? 0)) break
        const spec = pieces[node.kind]
        latency += spec.baseLatencyMs + extraMs(node, c) - queueMeanMs(spec, nodes[node.id].utilization) * Math.log(1 - rng())
        if (spec.acknowledges?.includes(c) || rng() < servesOf(node, c)) {
          latencies.push(Math.max(0, latency))
          break
        }
        const targets = routable(node, c)
        const next: string | undefined = targets.length ? pick(targets, shares(node, targets, c, from), rng()) : undefined
        // An open breaker fails the call on the spot.
        const key = next && `${node.id}->${next}`
        if (key && breakers[key] === 'open') break
        if (key && breakers[key] === 'half-open' && rng() >= BREAKER_PROBE) break
        const nextNode: ArchNode | undefined = next ? byId.get(next) : undefined
        // Crossing regions costs a round trip. A global piece is wherever the user is.
        const at = (n: ArchNode) => (pieces[n.kind].global ? from : regionOf(n))
        if (nextNode) latency += REGION_RTT_MS[at(node)][at(nextNode)] + (PROTOCOLS[policies.get(key!)?.protocol ?? 'rest'].hopMs[c] ?? 0)
        node = nextNode
      }
    }
  }

  return { t, rps, botRps, served, servedByClass, stale, duplicates, failed, async, ...latencyPercentiles(latencies), nodes, edges, breakers, latencies }
}

/** The item that `r` (in [0, 1)) falls on when each item owns its weight of the line. */
function pick<T>(items: T[], weights: number[], r: number): T {
  for (const [i, item] of items.entries()) {
    r -= weights[i]
    if (r < 0) return item
  }
  return items[items.length - 1]
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
  const writes = ticks.reduce((s, t) => s + t.rps * level.mix.write, 0)
  const duplicateRate = writes > 0 ? ticks.reduce((s, t) => s + t.duplicates, 0) / writes : 0
  const backlogAtEnd = last ? Object.values(last.nodes).reduce((s, n) => s + (n.backlog ?? 0), 0) : 0
  const availability = total === 0 ? 1 : served / total
  const latency = latencyPercentiles(ticks.flatMap((t) => t.latencies))
  const cost = totalCost(arch, pieces)
  const passed = {
    availability: availability >= level.goals.minAvailability,
    p99: latency.p99Ms <= level.goals.maxP99Ms,
    cost: cost <= level.goals.maxCost,
    stale: staleReadRate <= (level.goals.maxStaleReads ?? 1),
    duplicates: duplicateRate <= (level.goals.maxDuplicates ?? 1),
    all: false,
  }
  passed.all = passed.availability && passed.p99 && passed.cost && passed.stale && passed.duplicates
  return { availability, ...latency, cost, failed, async, backlogAtEnd, staleReadRate, duplicateRate, passed }
}

export function runLevel(arch: Architecture, level: Level, seed = 1, catalogue: Record<string, Spec> = SPECS) {
  const pieces = levelPieces(level, catalogue)
  const rng = mulberry32(seed)
  const state = new Map<string, NodeState>()
  const ticks: TickResult[] = []
  for (let t = 0; t < level.durationS; t++) ticks.push(simulateTick(arch, level, t, rng, state, pieces))
  return { ticks, summary: summarize(arch, level, ticks, pieces) }
}
