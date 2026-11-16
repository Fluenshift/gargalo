// Domain model: component catalogue, architecture graph and level definitions.

export type Kind =
  | 'client'
  | 'cdn'
  | 'limiter'
  | 'gateway'
  | 'lb'
  | 'server'
  | 'cache'
  | 'db'
  | 'queue'
  | 'worker'
  | 'replica'
  | 'payment'
  | 'shard'
  | 'dns'
/** What people using the system ask for. */
export type UserClass = 'static' | 'read' | 'write'
/**
 * `bot` is an abusive client scraping pages: it reads like `read` and loads every
 * piece it reaches, but nobody waits for it, so it never counts for availability
 * or latency.
 */
export type RequestClass = UserClass | 'bot'
/** Requests per second of each class. */
export type ClassLoad = Record<RequestClass, number>
/** What a node keeps from one simulated second to the next (a backlog, a lag). */
export type NodeState = Record<string, number>

/** Where a piece runs, or where users connect from. */
export type Region = 'sa' | 'us' | 'eu'

export const REGIONS: Record<Region, string> = { sa: 'São Paulo', us: 'Virgínia', eu: 'Frankfurt' }
/** Where every piece runs and every user is, unless a level or the player says otherwise. */
export const HOME_REGION: Region = 'sa'
/** Round trip between two regions, in ms: what a call pays each time it crosses. */
export const REGION_RTT_MS: Record<Region, Record<Region, number>> = {
  sa: { sa: 0, us: 120, eu: 200 },
  us: { sa: 120, us: 0, eu: 90 },
  eu: { sa: 200, us: 90, eu: 0 },
}

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
  /**
   * Classes copied to every live target once they end here (a primary database
   * replicating its writes). The copies are background work nobody waits for.
   */
  replicates?: RequestClass[]
  /** Load above this multiple of capacity takes the piece down for a few seconds (out of memory, connections). */
  crashesAbove?: number
  /**
   * Run by another company: it comes with the level, the player cannot buy,
   * remove or scale it, and its cost is not part of the budget.
   */
  external?: boolean
  /** Most instances one drawing may have (one primary database: more of them means partitions). */
  maxCount?: number
  /**
   * Holds one slice of the data, chosen by key (a database partition). A node
   * sending to several such pieces gives each an equal key range instead of an
   * equal share of the load, so the level's hot key lands on one of them.
   */
  partitioned?: boolean
  /**
   * Sends each user to the closest live target (geographic DNS): the users of a
   * region go to the targets in the region with the shortest round trip.
   */
  geo?: boolean
  /**
   * Runs everywhere at once (the users, an anycast DNS): it sits in no region, no
   * regional outage takes it down, and calls through it pay no round trip of their own.
   */
  global?: boolean
  /** Share of the calls that fail at random whatever the load (network blips): a retry usually gets through. */
  flaky?: number
}

export interface StepContext {
  /**
   * Requests per second the live targets of this node can take, summed. A target
   * that ends nothing itself (a load balancer) counts what is behind it, capped
   * by its own capacity.
   */
  downstreamCapacity: number
  /** Kinds of the pieces connected into this node. */
  sources: Kind[]
  /** Round trip to the farthest piece feeding this node, in ms: 0 when they share its region. */
  sourceRttMs: number
}

export interface StepResult {
  load: ClassLoad
  state: NodeState
  /** Arrivals refused this second (a full queue). They fail like an overload. */
  dropped?: ClassLoad
  /** Arrivals turned away on purpose with a fast 429 (a rate limit). They fail apart from overload. */
  refused?: ClassLoad
  /** Requests waiting inside the node when the second ends. */
  backlog?: number
  /** How long a request accepted now waits before it moves on, in ms. Infinity if nothing drains it. */
  waitMs?: number
  /** How far behind the source this copy of the data is, in ms. Infinity if it never gets updates. */
  lagMs?: number
  /** Share of the answers given here this second that are outdated. */
  staleRate?: number
}

/** Requests per second one client may send before a per-client limit refuses the rest. */
export const PER_CLIENT_LIMIT = 10
/** Share of what is behind it that a rate limiter lets through, keeping some headroom. */
export const LIMITER_HEADROOM = 0.8

const zeroLoad = (): ClassLoad => ({ static: 0, read: 0, write: 0, bot: 0 })

/** Lets each client through up to the per-client limit; a bot is one client sending far more. */
function perClientLimit(arriving: ClassLoad): { load: ClassLoad; refused: ClassLoad } {
  const bot = Math.min(arriving.bot, PER_CLIENT_LIMIT)
  return { load: { ...arriving, bot }, refused: { ...zeroLoad(), bot: arriving.bot - bot } }
}

const QUEUE_CAPACITY = 10_000
/** Messages a queue holds before it starts refusing new ones. */
export const QUEUE_MAX_BACKLOG = 20_000

const REPLICA_CAPACITY = 1000
/** Replication delay of an idle replica: shipping the change over the network. */
export const REPLICA_BASE_LAG_MS = 50
/**
 * Records most reads ask for. A read is stale when its record changed within
 * the lag; with W writes/s spread over them, that happens with probability
 * 1 − e^(−W·lag/HOT_RECORDS).
 */
const HOT_RECORDS = 2000

/** Pieces that only take writes, and pieces that only take reads. */
const WRITE_ONLY: Kind[] = ['queue', 'payment']
const READ_ONLY: Kind[] = ['replica']
/** Where writes go first when connected: a checkout charges the card before anything else. */
const WRITE_FIRST: Kind[] = ['payment', 'queue']
const READ_FIRST: Kind[] = ['replica']

/**
 * Writes go to the payment API or a queue when there is one, reads to read
 * replicas when there are some. Reads never go to a write-only piece and writes
 * never to a replica.
 */
function splitByClass(targets: RouteTarget[], c: RequestClass): RouteTarget[] {
  const write = c === 'write'
  const usable = targets.filter((t) => (write ? !READ_ONLY.includes(t.kind) : !WRITE_ONLY.includes(t.kind)))
  // The first kind on the list that is connected takes the class.
  for (const kind of write ? WRITE_FIRST : READ_FIRST) {
    // Replicas are health-checked: a dead one gets no reads, and with none alive reads go to the primary.
    const preferred = usable.filter((t) => t.kind === kind && !(t.down && READ_ONLY.includes(kind)))
    if (preferred.length) return preferred
    if (READ_ONLY.includes(kind)) return usable.filter((t) => t.kind !== kind)
  }
  return usable
}

export const SPECS: Record<Kind, Spec> = {
  client: {
    label: 'Usuários',
    capacity: Infinity,
    baseLatencyMs: 0,
    cost: 0,
    serves: {},
    targets: ['dns', 'cdn', 'limiter', 'gateway', 'lb', 'server'],
    maxOut: 1,
    description: 'De onde vem o tráfego. O DNS só aponta para um lugar.',
    entry: true,
    global: true,
  },
  dns: {
    label: 'DNS geográfico',
    capacity: 1_000_000,
    baseLatencyMs: 2,
    cost: 40,
    serves: {},
    targets: ['cdn', 'limiter', 'gateway', 'lb', 'server'],
    maxOut: 6,
    description: 'Responde a cada usuário com o endereço vivo mais perto dele. Se uma região cai, manda todo mundo para a próxima.',
    route: (targets) => targets.filter((t) => !t.down),
    geo: true,
    global: true,
  },
  cdn: {
    label: 'CDN',
    capacity: 100_000,
    baseLatencyMs: 8,
    cost: 25,
    serves: { static: 0.95 },
    targets: ['limiter', 'gateway', 'lb', 'server'],
    maxOut: 1,
    description: 'Serve 95% dos arquivos estáticos na borda. O resto segue para a origem.',
  },
  limiter: {
    label: 'Rate limiter',
    capacity: 50_000,
    baseLatencyMs: 1,
    cost: 15,
    serves: {},
    targets: ['gateway', 'lb', 'server'],
    maxOut: 1,
    description: 'Recusa com 429 o que passa do limite: por cliente, o que segura bots, e no total, o que protege quem está atrás.',
    step: (arriving, _state, { downstreamCapacity }) => {
      const { load, refused } = perClientLimit(arriving)
      // With nothing live behind it there is nothing to protect: let the next piece fail it.
      if (downstreamCapacity === 0) return { load, state: {}, refused }
      const users = load.static + load.read + load.write
      const room = Math.max(0, LIMITER_HEADROOM * downstreamCapacity - load.bot)
      const keep = users <= room ? 1 : room / users
      for (const c of ['static', 'read', 'write'] as const) {
        refused[c] = load[c] * (1 - keep)
        load[c] *= keep
      }
      return { load, state: {}, refused }
    },
  },
  gateway: {
    label: 'API Gateway',
    capacity: 10_000,
    baseLatencyMs: 5,
    cost: 60,
    serves: {},
    targets: ['server'],
    maxOut: 16,
    description: 'Porta única da API: autentica, aplica limite por cliente e divide entre servidores saudáveis.',
    route: (targets) => targets.filter((t) => !t.down),
    step: (arriving) => ({ ...perClientLimit(arriving), state: {} }),
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
    targets: ['cache', 'db', 'shard', 'queue', 'replica', 'payment'],
    maxOut: 5,
    description: 'Roda a aplicação. Responde estáticos; leituras e escritas vão adiante.',
    route: splitByClass,
  },
  cache: {
    label: 'Cache',
    capacity: 10_000,
    baseLatencyMs: 1,
    cost: 30,
    serves: { read: 0.85, bot: 0.85 },
    targets: ['db', 'shard', 'replica'],
    maxOut: 4,
    description: '85% das leituras acertam o cache. Escritas e misses vão ao banco.',
    route: splitByClass,
  },
  db: {
    label: 'Banco de dados',
    capacity: 1000,
    baseLatencyMs: 15,
    cost: 120,
    serves: { read: 1, write: 1, bot: 1 },
    targets: ['replica'],
    maxOut: 4,
    description: 'Fonte da verdade. Um só por desenho. Caro e difícil de escalar; com mais que o dobro da capacidade, cai.',
    replicates: ['write'],
    crashesAbove: 2,
    maxCount: 1,
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
        dropped: { ...zeroLoad(), write: dropped },
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
    targets: ['db', 'shard'],
    maxOut: 4,
    description: 'Consome mensagens da fila e grava no banco. Ninguém espera por ele.',
  },
  payment: {
    label: 'API de pagamento',
    capacity: 600,
    baseLatencyMs: 120,
    cost: 0,
    serves: { write: 1 },
    targets: [],
    maxOut: 0,
    description: 'Serviço de outra empresa que cobra o cartão. Não dá para escalar nem consertar: só escolher como chamar.',
    crashesAbove: 1.5,
    external: true,
  },
  shard: {
    label: 'Partição do banco',
    capacity: 1000,
    baseLatencyMs: 15,
    cost: 130,
    serves: { read: 1, write: 1, bot: 1 },
    targets: [],
    maxOut: 0,
    description: 'Um pedaço do banco, escolhido pela chave. Cada partição a mais soma leituras e escritas, mas uma chave quente cai sempre na mesma.',
    crashesAbove: 2,
    partitioned: true,
  },
  replica: {
    label: 'Réplica de leitura',
    capacity: REPLICA_CAPACITY,
    baseLatencyMs: 15,
    cost: 80,
    serves: { read: 1, write: 1, bot: 1 },
    targets: [],
    maxOut: 0,
    description: 'Cópia do banco que responde leituras. Recebe as escritas do primário com atraso.',
    step: (arriving, state, { sources, sourceRttMs }) => {
      // Without a link from the primary it never gets a change: every read may be old.
      if (!sources.includes('db')) return { load: arriving, state: { pending: 0 }, lagMs: Infinity, staleRate: 1 }
      // Replicated writes use what the reads leave of the capacity; the rest piles up.
      const pending = (state?.pending ?? 0) + arriving.write
      const applied = Math.min(pending, Math.max(0, REPLICA_CAPACITY - arriving.read - arriving.static))
      const behind = pending - applied
      const utilization = Math.min(0.95, (arriving.static + arriving.read + applied) / REPLICA_CAPACITY)
      // A primary in another region ships each change across it: half a round trip more.
      const lagMs = REPLICA_BASE_LAG_MS / (1 - utilization) + sourceRttMs / 2 + (behind > 0 ? (behind / Math.max(applied, 1)) * 1000 : 0)
      return {
        load: { ...arriving, write: applied },
        state: { pending: behind },
        lagMs,
        staleRate: 1 - Math.exp((-arriving.write * lagMs) / 1000 / HOT_RECORDS),
      }
    },
  },
}

export interface ArchNode {
  id: string
  kind: Kind
  /** Where it runs; the home region when absent. */
  region?: Region
}

export interface ArchEdge {
  source: string
  target: string
  /** Extra attempts after a failed call (0 to 3). */
  retries?: number
  /** Retries wait longer each time, with jitter, instead of all landing at once. */
  backoff?: boolean
  /** Stops calling a target that fails most calls, failing fast for a while. */
  breaker?: boolean
  /** Each call carries an idempotency key: the target runs a repeated write only once. */
  idempotent?: boolean
}

/**
 * Share of the failed write calls the target had already carried out: only the
 * answer got lost on the way back (a timeout). Retrying one runs the write again.
 */
export const ANSWER_LOST = 0.3

/** Most extra attempts a link may make. */
export const MAX_RETRIES = 3

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
  /** Largest share of reads that may come back outdated, 0..1. No limit when absent. */
  maxStaleReads?: number
  /** Largest share of the writes that may run twice (a transfer paid two times), 0..1. No limit when absent. */
  maxDuplicates?: number
}

export interface Level {
  id: string
  title: string
  briefing: string
  durationS: number
  mix: Record<UserClass, number>
  traffic: TrafficPhase[]
  /** An abusive client hammering the site, in requests per second over time. */
  bot?: TrafficPhase[]
  /**
   * How pieces behave differently in this level (a catalog so large the cache
   * rarely hits). The briefing must say it: the parts list shows the usual specs.
   */
  tweaks?: Partial<Record<Kind, Partial<Pick<Spec, 'serves' | 'capacity' | 'flaky'>>>>
  failures: Failure[]
  /** A whole region going dark: every piece running there is down. */
  regionOutages?: { region: Region; from: number; to: number }[]
  /** Share of the users connecting from each region; everyone in the home region when absent. */
  users?: Partial<Record<Region, number>>
  /**
   * Share of the reads and writes that ask for one same key (a viral product).
   * Partitions split keys, not load: this share always lands on one partition.
   */
  hotKey?: number
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
  return connectRefusal(arch, sourceId, targetId) === null
}

const listPT = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`

/** Why the player cannot draw this connection, in words for them; null when it is allowed. */
export function connectRefusal(arch: Architecture, sourceId: string, targetId: string): string | null {
  const source = arch.nodes.find((n) => n.id === sourceId)
  const target = arch.nodes.find((n) => n.id === targetId)
  if (!source || !target || source.id === target.id) return null
  const spec = SPECS[source.kind]
  if (!spec.targets.includes(target.kind)) {
    if (spec.targets.length === 0) return `${spec.label} não se liga a nenhuma peça: é o fim do caminho.`
    return `Não dá para ligar ${spec.label} a ${SPECS[target.kind].label}. Daqui só se chega a ${listPT(spec.targets.map((k) => SPECS[k].label))}.`
  }
  const out = arch.edges.filter((e) => e.source === sourceId)
  if (out.some((e) => e.target === targetId)) return 'Essas duas peças já estão ligadas.'
  if (out.length < spec.maxOut) return null
  const split = spec.targets.includes('lb') ? ' Para dividir o tráfego entre vários servidores, ligue a um Load Balancer e ele aos servidores.' : ''
  if (source.kind === 'client') return `O DNS só aponta para um lugar, então os Usuários se ligam a uma peça só.${split}`
  return `${spec.label} se liga a no máximo ${spec.maxOut} ${spec.maxOut === 1 ? 'peça' : 'peças'}.${split}`
}

/** The piece catalogue as this level changes it. */
export function levelPieces(level: Level, pieces: Record<string, Spec> = SPECS): Record<string, Spec> {
  if (!level.tweaks) return pieces
  const out = { ...pieces }
  for (const [kind, tweak] of Object.entries(level.tweaks)) out[kind] = { ...out[kind], ...tweak }
  return out
}

export function totalCost(arch: Architecture, pieces: Record<string, Spec> = SPECS): number {
  return arch.nodes.reduce((sum, n) => sum + (pieces[n.kind].external ? 0 : pieces[n.kind].cost), 0)
}

function phaseAt(phases: TrafficPhase[], t: number): number {
  let rps = 0
  for (const phase of phases) if (t >= phase.from) rps = phase.rps
  return rps
}

/** Where a piece runs. */
export const regionOf = (node: ArchNode): Region => node.region ?? HOME_REGION

/** Share of the users per region, regions without users left out. */
export function userRegions(level: Level): [Region, number][] {
  const entries = Object.entries(level.users ?? { [HOME_REGION]: 1 }) as [Region, number][]
  return entries.filter(([, share]) => share > 0)
}

/** Regions the level plays in: where its users connect from and where a region can go dark. */
export function levelRegions(level: Level): Region[] {
  const all = new Set<Region>([...userRegions(level).map(([r]) => r), ...(level.regionOutages ?? []).map((o) => o.region)])
  return (Object.keys(REGIONS) as Region[]).filter((r) => all.has(r))
}

/** Requests per second from the people using the system. */
export function rpsAt(level: Level, t: number): number {
  return phaseAt(level.traffic, t)
}

/** Requests per second from the level's bot, if it has one. */
export function botRpsAt(level: Level, t: number): number {
  return level.bot ? phaseAt(level.bot, t) : 0
}
