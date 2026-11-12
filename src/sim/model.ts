// Domain model: component catalogue, architecture graph and level definitions.

export type Kind = 'client' | 'cdn' | 'lb' | 'server' | 'cache' | 'db' | 'queue' | 'worker'
export type RequestClass = 'static' | 'read' | 'write'
/** Requests per second of each class. */
export type ClassLoad = Record<RequestClass, number>
/** What a node keeps from one simulated second to the next (a backlog, a lag). */
export type NodeState = Record<string, number>

export interface RouteTarget {
  id: string
  kind: Kind
  down: boolean
}

export interface Spec {
  label: string
  /** Requests per second one instance handles before it starts dropping. */
  capacity: number
  /** Service time with an idle instance, in ms. */
  baseLatencyMs: number
  /** Monthly cost in dollars. */
  cost: number
  /** Which request classes may end here, and with what probability. */
  serves: Partial<Record<RequestClass, number>>
  /** Kinds this component may send traffic to. */
  targets: Kind[]
  /** Maximum number of outgoing connections. */
  maxOut: number
  description: string
  /** Traffic from the users enters the graph here. */
  entry?: boolean
  /**
   * Which targets get traffic of class `c`; the forwarded load is split evenly
   * among them. Without it, every target gets an equal share.
   */
  route?: (targets: RouteTarget[], c: RequestClass) => RouteTarget[]
  /**
   * Decides what the node handles this second, before capacity is applied,
   * from what arrived and the state it kept from the previous second.
   * Without it, the node handles exactly what arrived and keeps no state.
   */
  step?: (arriving: ClassLoad, state: NodeState | undefined, ctx: StepContext) => StepResult
  /**
   * Classes this piece answers to the user as soon as it accepts them. The
   * work still goes on downstream, but nobody waits for it: what happens to it
   * later no longer counts for availability or latency.
   */
  acknowledges?: RequestClass[]
}

export interface StepContext {
  /** Requests per second the live targets of this node can take, summed. */
  downstreamCapacity: number
}

export interface StepResult {
  load: ClassLoad
  state: NodeState
  /** Arrivals refused this second (a full queue). They fail like an overload. */
  dropped?: ClassLoad
  /** Requests waiting inside the node when the second ends. */
  backlog?: number
  /** How long a request accepted now waits before it moves on, in ms. Infinity if nothing drains it. */
  waitMs?: number
}

const QUEUE_CAPACITY = 10_000
/** Messages a queue holds before it starts refusing new ones. */
export const QUEUE_MAX_BACKLOG = 20_000

/** Writes go to a queue when there is one; everything else stays off queues. */
function splitByClass(targets: RouteTarget[], c: RequestClass): RouteTarget[] {
  const usable = c === 'write' ? targets : targets.filter((t) => t.kind !== 'queue')
  const queues = usable.filter((t) => t.kind === 'queue')
  return c === 'write' && queues.length ? queues : usable
}

export const SPECS: Record<Kind, Spec> = {
  client: {
    label: 'Usuários',
    capacity: Infinity,
    baseLatencyMs: 0,
    cost: 0,
    serves: {},
    targets: ['cdn', 'lb', 'server'],
    maxOut: 1,
    description: 'De onde vem o tráfego. O DNS só aponta para um lugar.',
    entry: true,
  },
  cdn: {
    label: 'CDN',
    capacity: 100_000,
    baseLatencyMs: 8,
    cost: 25,
    serves: { static: 0.95 },
    targets: ['lb', 'server'],
    maxOut: 1,
    description: 'Serve 95% dos arquivos estáticos na borda. O resto segue para a origem.',
  },
  lb: {
    label: 'Load Balancer',
    capacity: 20_000,
    baseLatencyMs: 1,
    cost: 20,
    serves: {},
    targets: ['server'],
    maxOut: 16,
    description: 'Divide o tráfego igualmente entre servidores saudáveis (health check).',
    route: (targets) => targets.filter((t) => !t.down),
  },
  server: {
    label: 'Servidor',
    capacity: 400,
    baseLatencyMs: 30,
    cost: 50,
    serves: { static: 1 },
    targets: ['cache', 'db', 'queue'],
    maxOut: 2,
    description: 'Roda a aplicação. Responde estáticos; leituras e escritas vão adiante.',
    route: splitByClass,
  },
  cache: {
    label: 'Cache',
    capacity: 10_000,
    baseLatencyMs: 1,
    cost: 30,
    serves: { read: 0.85 },
    targets: ['db'],
    maxOut: 1,
    description: '85% das leituras acertam o cache. Escritas e misses vão ao banco.',
  },
  db: {
    label: 'Banco de dados',
    capacity: 1000,
    baseLatencyMs: 15,
    cost: 120,
    serves: { read: 1, write: 1 },
    targets: [],
    maxOut: 0,
    description: 'Fonte da verdade. Caro e difícil de escalar.',
  },
  queue: {
    label: 'Fila de mensagens',
    capacity: QUEUE_CAPACITY,
    baseLatencyMs: 2,
    cost: 30,
    serves: {},
    targets: ['worker'],
    maxOut: 16,
    description: 'Guarda as escritas e responde na hora. Os workers consomem no ritmo deles; cabem 20.000 mensagens.',
    acknowledges: ['write'],
    // Consumers pull: a crashed worker simply stops taking messages.
    route: (targets) => targets.filter((t) => !t.down),
    step: (arriving, state, { downstreamCapacity }) => {
      const drain = Math.min(downstreamCapacity, QUEUE_CAPACITY)
      const total = (state?.backlog ?? 0) + arriving.write
      const out = Math.min(total, drain)
      const dropped = Math.max(0, total - out - QUEUE_MAX_BACKLOG)
      const backlog = total - out - dropped
      return {
        load: { ...arriving, write: out },
        state: { backlog },
        dropped: { static: 0, read: 0, write: dropped },
        backlog,
        waitMs: backlog === 0 ? 0 : drain > 0 ? (backlog / drain) * 1000 : Infinity,
      }
    },
  },
  worker: {
    label: 'Worker',
    capacity: 200,
    baseLatencyMs: 20,
    cost: 40,
    serves: {},
    targets: ['db'],
    maxOut: 1,
    description: 'Consome mensagens da fila e grava no banco. Ninguém espera por ele.',
  },
}

export interface ArchNode {
  id: string
  kind: Kind
}

export interface ArchEdge {
  source: string
  target: string
}

export interface Architecture {
  nodes: ArchNode[]
  edges: ArchEdge[]
}

export interface TrafficPhase {
  /** Start second (inclusive). */
  from: number
  rps: number
}

export interface Failure {
  /** Crashes the n-th instance (0-based, in creation order) of `kind`. */
  kind: Kind
  index: number
  from: number
  to: number
}

export interface Goals {
  minAvailability: number // 0..1
  maxP99Ms: number
  maxCost: number
}

export interface Level {
  id: string
  title: string
  briefing: string
  durationS: number
  mix: Record<RequestClass, number>
  traffic: TrafficPhase[]
  failures: Failure[]
  goals: Goals
  /**
   * What is already on the drawing when the level opens (the previous team's work).
   * Without it, the company's starting architecture, or just the users.
   */
  start?: Architecture
}

export function canConnect(arch: Architecture, sourceId: string, targetId: string): boolean {
  const source = arch.nodes.find((n) => n.id === sourceId)
  const target = arch.nodes.find((n) => n.id === targetId)
  if (!source || !target || source.id === target.id) return false
  const spec = SPECS[source.kind]
  if (!spec.targets.includes(target.kind)) return false
  const out = arch.edges.filter((e) => e.source === sourceId)
  if (out.some((e) => e.target === targetId)) return false
  return out.length < spec.maxOut
}

export function totalCost(arch: Architecture, pieces: Record<string, Spec> = SPECS): number {
  return arch.nodes.reduce((sum, n) => sum + pieces[n.kind].cost, 0)
}

export function rpsAt(level: Level, t: number): number {
  let rps = 0
  for (const phase of level.traffic) if (t >= phase.from) rps = phase.rps
  return rps
}
