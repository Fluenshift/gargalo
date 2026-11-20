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

import { ANSWER_LOST, PROTOCOLS, balanceOf, instanceCapacity, levelWork, openEdges, REGION_RTT_MS, SPECS, botRpsAt, levelPieces, regionOf, rpsAt, totalCost, userRegions } from './model'
import type { ArchEdge, Architecture, ArchNode, Balance, ClassLoad, Level, NodeState, Region, RequestClass, Spec, UserClass } from './model'

/**
 * limited: refused on purpose with a 429 (rate limit). breaker: failed fast by an open circuit
 * breaker. flaky: lost to a random blip of a piece that fails now and then whatever the load.
 */
export type FailureReason = 'overload' | 'down' | 'noRoute' | 'limited' | 'breaker' | 'flaky'

const REASONS: FailureReason[] = ['overload', 'down', 'noRoute', 'limited', 'breaker', 'flaky']

export interface NodeStats {
  load: number
  utilization: number
  dropRate: number
  /** Requests lost here this second (dropped, cut at capacity, down or a blip), retries included and bots left out. */
  lost: number
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
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
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
  return { overload: 0, down: 0, noRoute: 0, limited: 0, breaker: 0, flaky: 0 }
}

/** What happens to one call into a piece: answered, answered with outdated data, failed by reason. */
interface Outcome {
  ok: number
  /** Share of the calls answered with outdated data (part of `ok`). */
  stale: number
  failed: Record<FailureReason, number>
}

/** A piece the traffic never reaches (caught in a cycle): every call to it is lost. */
const NOT_REACHED: Outcome = { ok: 0, stale: 0, failed: { ...emptyFailures(), overload: 1 } }

/**
 * Adds `amount` failures to `into`, split by reason like `by`. With `scale` the amounts of `by`
 * are taken as they are (shares of one call) instead of being normalized to sum to one.
 */
function spread(into: Record<FailureReason, number>, amount: number, by: Record<FailureReason, number>, scale?: number) {
  if (amount <= 0) return
  const total = scale ?? REASONS.reduce((sum, r) => sum + by[r], 0)
  if (total <= 0) {
    into.overload += amount
    return
  }
  for (const r of REASONS) into[r] += (amount * by[r]) / total
}

function sampleClass(level: Level, rng: Rng): UserClass {
  let r = rng()
  for (const c of USER_CLASSES) {
    r -= level.mix[c]
    if (r < 0) return c
  }
  return 'read'
}

type PerClass = Record<RequestClass, number>
const perClass = (f: (c: RequestClass) => number): PerClass => ({ static: f('static'), read: f('read'), write: f('write'), bot: f('bot') })

/**
 * The drawing as the engine reads it: the graph and every per-piece number that
 * stays the same from one second to the next. A run builds it once.
 */
interface Graph {
  arch: Architecture
  level: Level
  pieces: Record<string, Spec>
  byId: Map<string, ArchNode>
  children: Map<string, string[]>
  parents: Map<string, string[]>
  /** Topological order: nodes caught in a cycle are left out. */
  order: ArchNode[]
  /** Children first. */
  reversed: ArchNode[]
  policies: Map<string, ArchEdge>
  /** Creation order: the partition that holds the hot key is the first one created. */
  created: Map<string, number>
  client: ArchNode | undefined
  users: [Region, number][]
  capacity: Map<string, number>
  balance: Map<string, Balance>
  /** Share of each class a node ends (an HTTP cache only what the protocols into it let it keep). */
  serves: Map<string, PerClass>
  /** Load one request of each class puts on a node, in plain requests, from the level's code. */
  weight: Map<string, PerClass>
  /** Time the level's code adds to each request at a node, per class. */
  extraMs: Map<string, PerClass>
  /** Each scripted failure, resolved to the node it takes out. */
  failures: { id: string | undefined; from: number; to: number }[]
}

function graphOf(arch: Architecture, level: Level, pieces: Record<string, Spec>): Graph {
  const byId = new Map(arch.nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>(arch.nodes.map((n) => [n.id, []]))
  const parents = new Map<string, string[]>(arch.nodes.map((n) => [n.id, []]))
  for (const e of arch.edges) {
    children.get(e.source)?.push(e.target)
    parents.get(e.target)?.push(e.source)
  }
  const order = topoOrder(arch)
  // What one request costs on each piece, from the code as the player left it.
  const work = levelWork(level, arch)
  const workOf = (node: ArchNode, c: RequestClass) => work.filter((w) => w.kinds.includes(node.kind) && w.classes.includes(c))
  const servesOf = (node: ArchNode, c: RequestClass): number => {
    const spec = pieces[node.kind]
    const base = spec.serves[c] ?? 0
    if (!spec.httpCache || base === 0) return base
    const incoming = arch.edges.filter((e) => e.target === node.id)
    if (incoming.length === 0) return base
    const kept = incoming.filter((e) => !PROTOCOLS[e.protocol ?? 'rest'].uncached.includes(c)).length
    return (base * kept) / incoming.length
  }
  return {
    arch,
    level,
    pieces,
    byId,
    children,
    parents,
    order,
    reversed: [...order].reverse(),
    policies: new Map(arch.edges.map((e) => [`${e.source}->${e.target}`, e])),
    created: new Map(arch.nodes.map((n, i) => [n.id, i])),
    client: arch.nodes.find((n) => pieces[n.kind].entry),
    users: userRegions(level),
    capacity: new Map(arch.nodes.map((n) => [n.id, instanceCapacity(level, n, pieces)])),
    balance: new Map(arch.nodes.map((n) => [n.id, balanceOf(n, level, arch.fixes, pieces)])),
    serves: new Map(arch.nodes.map((n) => [n.id, perClass((c) => servesOf(n, c))])),
    weight: new Map(arch.nodes.map((n) => [n.id, perClass((c) => workOf(n, c).reduce((f, w) => f * w.factor, 1))])),
    extraMs: new Map(arch.nodes.map((n) => [n.id, perClass((c) => workOf(n, c).reduce((ms, w) => ms + (w.extraMs ?? 0), 0))])),
    failures: level.failures.map((f) => ({ id: arch.nodes.filter((n) => n.kind === f.kind)[f.index]?.id, from: f.from, to: f.to })),
  }
}

/** `isDown` on a graph built once. */
function downAt(g: Graph, node: ArchNode, t: number): boolean {
  const region = regionOf(node)
  if (!g.pieces[node.kind].global && g.level.regionOutages?.some((o) => o.region === region && t >= o.from && t < o.to)) return true
  return g.failures.some((f) => f.id === node.id && t >= f.from && t < f.to)
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
  return tick(graphOf(arch, level, pieces), t, rng, state)
}

function tick(g: Graph, t: number, rng: Rng, state: Map<string, NodeState>): TickResult {
  const { arch, level, pieces, byId, children, parents, policies, created, client, users } = g
  const rps = rpsAt(level, t)
  const botRps = botRpsAt(level, t)
  // More samples in busier seconds, so the run-wide p99 is weighted by traffic.
  const samples = Math.min(1000, Math.max(100, Math.round(rps / 4)))

  const crashed = (id: string) => t < (state.get(`crash:${id}`)?.until ?? -1)
  const down = new Map(arch.nodes.map((n) => [n.id, downAt(g, n, t) || crashed(n.id)]))
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
  // Routing only depends on which pieces are down, so it is worked out once per second.
  const routeMemo = new Map<string, string[]>()
  const routable = (node: ArchNode, c: RequestClass): string[] => {
    const key = `${node.id}|${c}`
    let ids = routeMemo.get(key)
    if (!ids) {
      const targets = (children.get(node.id) ?? []).map((id) => ({ id, kind: byId.get(id)!.kind, down: down.get(id)! }))
      const route = pieces[node.kind].route
      ids = (route ? route(targets, c) : targets).map((target) => target.id)
      routeMemo.set(key, ids)
    }
    return ids
  }
  /**
   * Share of a node's forwarded class-`c` load each target gets: equal, except that a
   * geographic node sends each region's users to its closest targets (only `from`'s users
   * when given), partitions split keys, and a balancer on least connections fills each
   * target in proportion to what it takes. Hashing splits keys evenly too: it differs from
   * round robin only in which keys move when a target falls, and load does not see that.
   */
  const shareMemo = new Map<string, number[]>()
  const shares = (node: ArchNode, targets: string[], c: RequestClass, from?: Region): number[] => {
    const key = `${node.id}|${c}|${from ?? ''}`
    let split = shareMemo.get(key)
    if (!split) {
      split = splitAmong(node, targets, c, from)
      shareMemo.set(key, split)
    }
    return split
  }
  const splitAmong = (node: ArchNode, targets: string[], c: RequestClass, from?: Region): number[] => {
    const even = 1 / targets.length
    if (g.balance.get(node.id) === 'least-conn') {
      const room = targets.map((id) => effectiveCapacity(id))
      const total = room.reduce((sum, r) => sum + r, 0)
      if (total > 0 && Number.isFinite(total)) return room.map((r) => r / total)
    }
    if (pieces[node.kind].geo) {
      const weights = targets.map(() => 0)
      for (const [region, share] of from ? ([[from, 1]] as [Region, number][]) : users) {
        const rtt = targets.map((id) => REGION_RTT_MS[region][regionOf(byId.get(id)!)])
        const nearest = Math.min(...rtt)
        const closest = rtt.filter((r) => r === nearest).length
        rtt.forEach((r, i) => {
          if (r === nearest) weights[i] += share / closest
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
  const weight = (node: ArchNode, c: RequestClass) => g.weight.get(node.id)![c]
  const extraMs = (node: ArchNode, c: RequestClass) => g.extraMs.get(node.id)![c]
  const servesOf = (node: ArchNode, c: RequestClass) => g.serves.get(node.id)![c]
  const capacityOf = (node: ArchNode) => g.capacity.get(node.id)!

  // What a target can take: its capacity, or for a piece that ends nothing
  // itself (a load balancer), what is behind it up to its own capacity.
  const capacityMemo = new Map<string, number>()
  const effectiveCapacity = (id: string): number => {
    if (down.get(id)) return 0
    const cached = capacityMemo.get(id)
    if (cached !== undefined) return cached
    capacityMemo.set(id, 0) // a cycle adds nothing
    const node = byId.get(id)!
    const spec = pieces[node.kind]
    const capacity = capacityOf(node)
    const kids = children.get(id) ?? []
    const endsSomething = Object.values(spec.serves).some((p) => (p ?? 0) > 0)
    const result =
      endsSomething || kids.length === 0
        ? capacity
        : Math.min(capacity, kids.reduce((sum, kid) => sum + effectiveCapacity(kid), 0))
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
  if (client) {
    for (const c of USER_CLASSES) arriving.get(client.id)![c] = rps * level.mix[c]
    arriving.get(client.id)!.bot = botRps
  }

  const failed = emptyFailures()
  const async: AsyncWork = { done: 0, lost: 0 }
  const nodes: Record<string, NodeStats> = {}
  const edges: Record<string, number> = {}
  /** Per class, the share of what arrived at each node that got through it. */
  const passRate = new Map<string, PerClass>()
  /** What each node did to the calls it got this second, for the outcome pass below. */
  const flowAt = new Map<string, { capPass: number; blips: number; refused: PerClass; dropped: PerClass; staleRate: number }>()
  /** Calls per class through each link with a breaker, whoever made them, to judge the breaker. */
  const breakerCalls = new Map<string, ClassLoad>()
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

  for (const node of g.order) {
    const spec = pieces[node.kind]
    const capacity = capacityOf(node)
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
    const steps = !!spec.step && !isNodeDown
    if (spec.step && steps) {
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
    const capPass = isNodeDown ? 0 : load <= capacity ? 1 : capacity / load
    const blips = spec.flaky ?? 0
    const pass = capPass * (1 - blips)
    const totalArrived = CLASSES.reduce((sum, c) => sum + arrived[c], 0)
    const totalDropped = CLASSES.reduce((sum, c) => sum + dropped[c], 0)
    const totalRefused = CLASSES.reduce((sum, c) => sum + refused[c], 0)
    const share = (amount: number) => (totalArrived > 0 ? amount / totalArrived : 0)
    // Share of what arrived that gets through: refused at the door, then cut at capacity.
    const through = pass * (1 - share(totalDropped) - share(totalRefused))
    // Each class on its own: a bot turned away at the door says nothing about how users fare.
    const shareOf = (part: ClassLoad, c: RequestClass) => (arrived[c] > 0 ? part[c] / arrived[c] : 0)
    const refusedShare = perClass((c) => shareOf(refused, c))
    const droppedShare = perClass((c) => shareOf(dropped, c))
    passRate.set(node.id, perClass((c) => pass * Math.max(0, 1 - droppedShare[c] - refusedShare[c])))
    flowAt.set(node.id, { capPass, blips, refused: refusedShare, dropped: droppedShare, staleRate })
    const utilization = capacity === Infinity ? 0 : load / capacity
    const stats: NodeStats = {
      load,
      utilization,
      // A 429 is the piece doing its job, not losing load.
      dropRate: 1 - through - share(totalRefused),
      lost: 0,
      down: isNodeDown,
      latencyMs: isNodeDown ? 0 : spec.baseLatencyMs + queueMeanMs(spec, utilization),
      ...extra,
      ...(steps && totalRefused > 0 ? { refused: totalRefused } : {}),
    }
    nodes[node.id] = stats

    // Work a piece carried over from earlier seconds (a backlog) keeps the shares it came in with:
    // with nothing new arriving, they come from the last second something did.
    const carried = steps ? state.get(`mix:${node.id}`) : undefined
    const mix: NodeState = {}
    for (const c of CLASSES) {
      // Shares of this class: users still waiting, work already acknowledged, and ghost load.
      const asyncShare = arrived[c] > 0 ? ack[c] / arrived[c] : (carried?.[`${c}:async`] ?? 0)
      const ghostShare = arrived[c] > 0 ? gho[c] / arrived[c] : (carried?.[`${c}:ghost`] ?? 0)
      mix[`${c}:async`] = asyncShare
      mix[`${c}:ghost`] = ghostShare
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
      lose(c, a[c] * capPass * blips, outWaiting, outAsync, 'flaky')
      if (counts) stats.lost += dropped[c] + a[c] * (1 - capPass) + a[c] * capPass * blips
      const survivors = a[c] * pass
      const endsHere = survivors * servesOf(node, c)
      if (counts) {
        served += endsHere * outWaiting
        servedByClass[c] += endsHere * outWaiting
        if (c === 'read') stale += endsHere * outWaiting * staleRate
        async.done += endsHere * outAsync
      }
      // Copies of what ends here (a primary's writes to its replicas): background load nobody waits for.
      if (endsHere > 0 && spec.replicates?.includes(c)) {
        for (const target of children.get(node.id) ?? []) {
          if (down.get(target)) continue
          arriving.get(target)![c] += endsHere
          ghost.get(target)![c] += endsHere
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
          // A breaker sees every call that goes through it, retries and background work included.
          if (counts && policy.breaker) {
            const calls = breakerCalls.get(key) ?? zero()
            calls[c] += share * open
            breakerCalls.set(key, calls)
          }
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
    if (steps) state.set(`mix:${node.id}`, mix)

    // Too much load takes a fragile piece out for a while.
    if (!isNodeDown && spec.crashesAbove !== undefined && load > spec.crashesAbove * capacity) {
      state.set(`crash:${node.id}`, { until: t + 1 + CRASH_DOWN_S })
    }
  }

  // What happens to one call into each piece this second, per class: how often it is answered,
  // how often the answer is outdated, and why it fails when it does. Links that retry or break
  // judge their target by it, and the users they settled get their fate from it. Children first.
  const outcome = new Map<string, Record<UserClass, Outcome>>()
  for (const node of g.reversed) {
    const spec = pieces[node.kind]
    const flow = flowAt.get(node.id)!
    const result = {} as Record<UserClass, Outcome>
    for (const c of USER_CLASSES) {
      const lost = emptyFailures()
      if (down.get(node.id)) {
        lost.down = 1
        result[c] = { ok: 0, stale: 0, failed: lost }
        continue
      }
      const through = passRate.get(node.id)![c]
      const accepted = Math.max(0, 1 - flow.refused[c] - flow.dropped[c])
      lost.limited = flow.refused[c]
      lost.overload = flow.dropped[c] + accepted * (1 - flow.capPass)
      lost.flaky = accepted * flow.capPass * flow.blips
      if (spec.acknowledges?.includes(c)) {
        result[c] = { ok: through, stale: 0, failed: lost }
        continue
      }
      const ends = servesOf(node, c)
      const targets = routable(node, c)
      const onward: Outcome = { ok: 0, stale: 0, failed: emptyFailures() }
      if (targets.length === 0) onward.failed.noRoute = 1
      const split = targets.length ? shares(node, targets, c) : []
      for (const [i, target] of targets.entries()) {
        const key = `${node.id}->${target}`
        const policy = policies.get(key)
        const next = outcome.get(target)?.[c] ?? NOT_REACHED
        if (!policy || (!(policy.retries ?? 0) && !policy.breaker)) {
          onward.ok += split[i] * next.ok
          onward.stale += split[i] * next.stale
          spread(onward.failed, split[i], next.failed, 1)
          continue
        }
        const open = breakers[key] === 'open' ? 0 : breakers[key] === 'half-open' ? BREAKER_PROBE : 1
        const answered = retryOutcome(next.ok, policy.retries ?? 0, policy.backoff ?? false).success
        onward.ok += split[i] * open * answered
        onward.stale += split[i] * open * answered * (next.ok > 0 ? next.stale / next.ok : 0)
        onward.failed.breaker += split[i] * (1 - open)
        spread(onward.failed, split[i] * open * (1 - answered), next.failed)
      }
      const staleHere = c === 'read' ? flow.staleRate : 0
      spread(lost, through * (1 - ends), onward.failed, 1)
      result[c] = {
        ok: through * (ends + (1 - ends) * onward.ok),
        stale: through * (ends * staleHere + (1 - ends) * onward.stale),
        failed: lost,
      }
    }
    outcome.set(node.id, result)
    state.set(`succ:${node.id}`, { static: result.static.ok, read: result.read.ok, write: result.write.ok })
  }

  // Users who went through a link with a policy: answered unless every attempt failed, and
  // failed for the reason the last attempt did.
  for (const [key, calls] of policyCalls) {
    const policy = policies.get(key)!
    const target = key.slice(key.indexOf('->') + 2)
    for (const c of USER_CLASSES) {
      if (calls[c] <= 0) continue
      const next = outcome.get(target)?.[c] ?? NOT_REACHED
      const { success: answered } = retryOutcome(next.ok, policy.retries ?? 0, policy.backoff ?? false)
      served += calls[c] * answered
      servedByClass[c] += calls[c] * answered
      if (c === 'read' && next.ok > 0) stale += calls[c] * answered * (next.stale / next.ok)
      spread(failed, calls[c] * (1 - answered), next.failed)
    }
  }

  // Breakers judge the calls that went through them this second.
  for (const [key, policy] of policies) {
    if (!policy.breaker) continue
    const calls = breakerCalls.get(key)
    const total = calls ? USER_CLASSES.reduce((sum, c) => sum + calls[c], 0) : 0
    if (total <= 0) continue
    const target = key.slice(key.indexOf('->') + 2)
    const ok = USER_CLASSES.reduce((sum, c) => sum + calls![c] * (outcome.get(target)?.[c].ok ?? 0), 0) / total
    if (ok < BREAKER_THRESHOLD) state.set(`edge:${key}`, { open: 1, until: t + 1 + BREAKER_OPEN_S })
    else if (state.get(`edge:${key}`)?.open) state.set(`edge:${key}`, { open: 0, until: 0 })
  }

  // Sampling pass for latency. Where a sample can go from a piece is fixed for the second,
  // so each hop (targets, their shares, the round trip and protocol on the link) is worked
  // out once and reused by every sample.
  interface Hop {
    node: ArchNode | undefined
    breaker: 'open' | 'half-open' | undefined
    /** Round trip between the two pieces plus what the link's protocol gains or loses. */
    linkMs: number
  }
  const hopMemo = new Map<string, { weights: number[]; hops: Hop[] }>()
  const hopsFrom = (node: ArchNode, c: UserClass, from: Region) => {
    const key = `${node.id}|${c}|${from}`
    let found = hopMemo.get(key)
    if (!found) {
      const targets = routable(node, c)
      // Crossing regions costs a round trip. A global piece is wherever the user is.
      const at = (n: ArchNode) => (pieces[n.kind].global ? from : regionOf(n))
      found = {
        weights: targets.length ? shares(node, targets, c, from) : [],
        hops: targets.map((id): Hop => {
          const link = `${node.id}->${id}`
          const next = byId.get(id)
          return {
            node: next,
            breaker: breakers[link],
            linkMs: next ? REGION_RTT_MS[at(node)][at(next)] + (PROTOCOLS[policies.get(link)?.protocol ?? 'rest'].hopMs[c] ?? 0) : 0,
          }
        }),
      }
      hopMemo.set(key, found)
    }
    return found
  }
  const queueMs = new Map<string, number>()
  const meanQueueMs = (node: ArchNode) => {
    let ms = queueMs.get(node.id)
    if (ms === undefined) queueMs.set(node.id, (ms = queueMeanMs(pieces[node.kind], nodes[node.id].utilization)))
    return ms
  }
  const latencies: number[] = []
  if (client && rps > 0) {
    const regionIds = users.map(([r]) => r)
    const regionShares = users.map(([, s]) => s)
    for (let i = 0; i < samples; i++) {
      const c = sampleClass(level, rng)
      // Drawn only when users come from several regions, so single-region runs keep their numbers.
      const from = users.length > 1 ? pick(regionIds, regionShares, rng()) : users[0][0]
      let node: ArchNode | undefined = client
      let latency = 0
      while (node) {
        if (rng() >= (passRate.get(node.id)?.[c] ?? 0)) break
        const spec = pieces[node.kind]
        latency += spec.baseLatencyMs + extraMs(node, c) - meanQueueMs(node) * Math.log(1 - rng())
        if (spec.acknowledges?.includes(c) || rng() < servesOf(node, c)) {
          latencies.push(Math.max(0, latency))
          break
        }
        const { weights, hops } = hopsFrom(node, c, from)
        if (hops.length === 0) break
        const hop = hops[pickIndex(weights, rng())]
        // An open breaker fails the call on the spot.
        if (hop.breaker === 'open') break
        if (hop.breaker === 'half-open' && rng() >= BREAKER_PROBE) break
        latency += hop.linkMs
        node = hop.node
      }
    }
  }

  return { t, rps, botRps, served, servedByClass, stale, duplicates, failed, async, ...latencyPercentiles(latencies), nodes, edges, breakers, latencies }
}

/** Index of the weight that `r` (in [0, 1)) falls on when each owns its share of the line. */
function pickIndex(weights: number[], r: number): number {
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
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
  const sorted = Float64Array.from(values).sort()
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

export function runLevel(drawn: Architecture, level: Level, seed = 1, catalogue: Record<string, Spec> = SPECS) {
  // A link the code forbids carries nothing, even when it is on the drawing.
  const arch = { ...drawn, edges: openEdges(drawn, level) }
  const pieces = levelPieces(level, catalogue)
  const graph = graphOf(arch, level, pieces)
  const rng = mulberry32(seed)
  const state = new Map<string, NodeState>()
  const ticks: TickResult[] = []
  for (let t = 0; t < level.durationS; t++) ticks.push(tick(graph, t, rng, state))
  return { ticks, summary: summarize(arch, level, ticks, pieces) }
}
