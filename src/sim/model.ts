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
  | 'storage'
  | 'topic'
  | 'search'
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
  /** Divides requests among servers: the balance setting applies to it. */
  balances?: boolean
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
  /** Hands every target the whole load, a copy each (every subscriber of a topic gets every event), instead of splitting it. */
  fanOut?: boolean
  /** Takes API calls: the link into it speaks a protocol (REST, GraphQL, gRPC). */
  api?: boolean
  /**
   * Keeps answers by URL (an HTTP cache at the edge): it only ends the classes the
   * protocol of the link into it lets a cache keep.
   */
  httpCache?: boolean
  /** Talks to browsers: links out of it can only use protocols a browser speaks. */
  browserFacing?: boolean
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

const SEARCH_CAPACITY = 1000
/** An index makes what it took in searchable about once a second (its refresh). */
export const SEARCH_REFRESH_MS = 1000
/** New videos the searches tend to look for: a search misses one when it came out within the lag. */
const FRESH_VIDEOS = 30_000

/**
 * A copy of the data fed by `feeder` (a replica by its primary, a search index by a
 * topic). The changes it gets use what the reads leave of its capacity; the rest
 * piles up and the lag grows. A read is outdated when its record changed within
 * the lag: with W changes/s spread over `records`, 1 − e^(−W·lag/records).
 */
function laggingCopy(feeder: Kind, capacity: number, baseLagMs: number, records: number): Spec['step'] {
  return (arriving, state, { sources, sourceRttMs }) => {
    // Without a link from its feeder it never gets a change: every read may be old.
    if (!sources.includes(feeder)) return { load: arriving, state: { pending: 0 }, lagMs: Infinity, staleRate: 1 }
    const pending = (state?.pending ?? 0) + arriving.write
    const applied = Math.min(pending, Math.max(0, capacity - arriving.read - arriving.static))
    const behind = pending - applied
    const utilization = Math.min(0.95, (arriving.static + arriving.read + applied) / capacity)
    // A feeder in another region ships each change across it: half a round trip more.
    const lagMs = baseLagMs / (1 - utilization) + sourceRttMs / 2 + (behind > 0 ? (behind / Math.max(applied, 1)) * 1000 : 0)
    return {
      load: { ...arriving, write: applied },
      state: { pending: behind },
      lagMs,
      staleRate: 1 - Math.exp((-arriving.write * lagMs) / 1000 / records),
    }
  }
}

/** Pieces that only take writes, and pieces that only take reads. */
const WRITE_ONLY: Kind[] = ['queue', 'payment', 'topic']
const READ_ONLY: Kind[] = ['replica', 'search']
/** Where writes go first when connected: a checkout charges the card before anything else. */
const WRITE_FIRST: Kind[] = ['payment', 'queue', 'topic']
/** A search goes to the index when there is one; other reads to read replicas. */
const READ_FIRST: Kind[] = ['search', 'replica']

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
  }
  return usable.filter((t) => !READ_ONLY.includes(t.kind))
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
    maxCount: 1,
    global: true,
    browserFacing: true,
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
    browserFacing: true,
  },
  cdn: {
    label: 'CDN',
    capacity: 100_000,
    baseLatencyMs: 8,
    cost: 25,
    serves: { static: 0.95, read: 0.1, bot: 0.1 },
    targets: ['limiter', 'gateway', 'lb', 'server', 'storage'],
    maxOut: 2,
    description:
      'Serve 95% dos arquivos estáticos na borda e guarda 10% das leituras da API, quando elas chegam por REST. O resto segue para a origem; arquivos e uploads, para o armazenamento de objetos se houver um.',
    // Files and uploads go to object storage when there is one; API calls never do.
    route: (targets, c) => {
      const storage = targets.filter((t) => t.kind === 'storage')
      if (storage.length && (c === 'static' || c === 'write')) return storage
      return targets.filter((t) => t.kind !== 'storage')
    },
    api: true,
    httpCache: true,
    browserFacing: true,
  },
  limiter: {
    label: 'Rate limiter',
    api: true,
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
    balances: true,
    api: true,
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
    balances: true,
    api: true,
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
    api: true,
    capacity: 400,
    baseLatencyMs: 30,
    cost: 50,
    serves: { static: 1 },
    targets: ['cache', 'db', 'shard', 'queue', 'replica', 'payment', 'topic', 'search'],
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
    description: 'Consome mensagens de uma fila ou eventos de um tópico e grava no banco. Ninguém espera por ele.',
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
    step: laggingCopy('db', REPLICA_CAPACITY, REPLICA_BASE_LAG_MS, HOT_RECORDS),
  },
  storage: {
    label: 'Armazenamento de objetos',
    capacity: 5000,
    baseLatencyMs: 20,
    cost: 20,
    serves: { static: 1, write: 1 },
    targets: ['topic'],
    maxOut: 1,
    description:
      'Guarda arquivos grandes, como vídeos, por centavos. A CDN busca os trechos aqui e o upload chega direto, sem passar pelo servidor. Avisa um tópico a cada arquivo novo.',
    // Each file stored becomes an event on the topic, a notice nobody waits for.
    replicates: ['write'],
  },
  topic: {
    label: 'Tópico pub/sub',
    capacity: 20_000,
    baseLatencyMs: 3,
    cost: 35,
    serves: {},
    targets: ['worker', 'search'],
    maxOut: 8,
    description:
      'Recebe um evento, responde a quem publicou na hora e entrega uma cópia a cada assinante. Uma fila entrega cada mensagem a um consumidor só.',
    acknowledges: ['write'],
    fanOut: true,
  },
  search: {
    label: 'Índice de busca',
    capacity: SEARCH_CAPACITY,
    baseLatencyMs: 10,
    cost: 70,
    serves: { read: 1, write: 1, bot: 1 },
    targets: [],
    maxOut: 0,
    description:
      'Responde buscas por texto sem varrer o banco. Só fica sabendo de um vídeo novo pelo evento de um tópico, e ele aparece na busca com atraso.',
    step: laggingCopy('topic', SEARCH_CAPACITY, SEARCH_REFRESH_MS, FRESH_VIDEOS),
  },
}

/** How a balancing piece picks the next target. */
export type Balance = 'round-robin' | 'least-conn' | 'hash'

export interface ArchNode {
  id: string
  kind: Kind
  /** Where it runs; the home region when absent. */
  region?: Region
  /** How a balancing piece divides its targets, when the level's code lets the player choose; round robin otherwise. */
  balance?: Balance
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
  /** How the source talks to an API piece. REST when absent. */
  protocol?: Protocol
}

export type Protocol = 'rest' | 'graphql' | 'grpc'

export interface ProtocolSpec {
  label: string
  description: string
  /** Time each call over the link gains (negative) or loses compared with REST, per class, in ms. */
  hopMs: Partial<Record<RequestClass, number>>
  /** Classes an HTTP cache cannot keep over this protocol (everything goes as one POST). */
  uncached: RequestClass[]
  /** A browser can speak it, so it may leave a piece that talks to browsers. */
  browser: boolean
}

export const PROTOCOLS: Record<Protocol, ProtocolSpec> = {
  rest: {
    label: 'REST',
    description: 'Uma URL por recurso, JSON e verbos HTTP. Simples, e um GET pode ser guardado pela CDN.',
    hopMs: {},
    uncached: [],
    browser: true,
  },
  graphql: {
    label: 'GraphQL',
    description: 'Uma consulta traz tudo que a tela pede de uma vez, com menos idas e voltas. Mas tudo vai num POST, e a CDN não guarda.',
    hopMs: { read: -10, bot: -10 },
    uncached: ['read', 'bot'],
    browser: true,
  },
  grpc: {
    label: 'gRPC',
    description: 'Binário e com conexão aberta (HTTP/2): mais rápido entre serviços internos. O navegador não fala gRPC.',
    hopMs: { read: -6, write: -6, bot: -6 },
    uncached: ['read', 'bot'],
    browser: false,
  },
}

/** Why the link from `source` cannot use `protocol`, in words for the player; null when it can. */
export function protocolRefusal(source: Kind, target: Kind, protocol: Protocol, pieces: Record<string, Spec> = SPECS): string | null {
  if (!pieces[target].api) return `${pieces[target].label} não recebe chamadas de API: a ligação não tem protocolo.`
  if (pieces[source].browserFacing && !PROTOCOLS[protocol].browser)
    return `O navegador não fala ${PROTOCOLS[protocol].label}. Use REST ou GraphQL na ligação que sai de ${pieces[source].label}.`
  return null
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
  /** Option the player picked for each of the level's code challenges, by challenge id. */
  fixes?: Record<string, string>
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
  /**
   * Pieces of the starting drawing that differ from their kind, by id: an old server that
   * takes half. By id, not by order, so deleting it takes the difference away with it.
   */
  nodeTweaks?: { id: string; capacity: number }[]
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
  /** What the routes are called in this system (e.g. `POST /transferencias`); generic ones when absent. */
  endpoints?: Partial<Record<UserClass, string>>
  /** Bugs in the application's code, each fixed by picking one of its options. */
  code?: CodeChallenge[]
  /** What requests cost on some pieces whatever the code: a 500 MB upload holds a server far longer than a click. */
  work?: Work[]
  goals: Goals
  /**
   * What is already on the drawing when the level opens (the previous team's work).
   * Without it, the company's starting architecture, or just the users.
   */
  start?: Architecture
}

export function canConnect(arch: Architecture, sourceId: string, targetId: string, level?: Pick<Level, 'code'>): boolean {
  const source = arch.nodes.find((n) => n.id === sourceId)
  const target = arch.nodes.find((n) => n.id === targetId)
  if (!source || !target || source.id === target.id) return false
  return connectRefusal(arch, sourceId, targetId, level) === null
}

const listPT = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`

/** Why the player cannot draw this connection, in words for them; null when it is allowed. */
export function connectRefusal(arch: Architecture, sourceId: string, targetId: string, level?: Pick<Level, 'code'>): string | null {
  const source = arch.nodes.find((n) => n.id === sourceId)
  const target = arch.nodes.find((n) => n.id === targetId)
  if (!source || !target || source.id === target.id) return null
  const spec = SPECS[source.kind]
  if (!spec.targets.includes(target.kind)) {
    if (spec.targets.length === 0) return `${spec.label} não se liga a nenhuma peça: é o fim do caminho.`
    return `Não dá para ligar ${spec.label} a ${SPECS[target.kind].label}. Daqui só se chega a ${listPT(spec.targets.map((k) => SPECS[k].label))}.`
  }
  const locked = lockedLink(level, arch.fixes, source.kind, target.kind)
  if (locked) return locked
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

/** One route of the application: how much of the traffic asks for it and what one call costs. */
export interface Endpoint {
  route: string
  class: UserClass
  /** Share of the users' requests, 0..1. */
  share: number
  /** CPU time on the server per call, in ms. */
  cpuMs: number
  /** Database queries per call. */
  queries: number
  /** Size of the answer, in kB. */
  responseKb: number
}

const ENDPOINT_DEFAULTS: Record<UserClass, Omit<Endpoint, 'share' | 'class'>> = {
  static: { route: 'GET /arquivos/:nome', cpuMs: 1, queries: 0, responseKb: 200 },
  read: { route: 'GET /produtos/:id', cpuMs: 8, queries: 1, responseKb: 4 },
  write: { route: 'POST /pedidos', cpuMs: 15, queries: 2, responseKb: 1 },
}

/** The level's traffic as routes, busiest first: the same mix, by endpoint. */
export function endpointsOf(level: Level): Endpoint[] {
  return (Object.keys(ENDPOINT_DEFAULTS) as UserClass[])
    .filter((c) => level.mix[c] > 0)
    .map((c) => ({ ...ENDPOINT_DEFAULTS[c], route: level.endpoints?.[c] ?? ENDPOINT_DEFAULTS[c].route, class: c, share: level.mix[c] }))
    .sort((a, b) => b.share - a.share)
}

/**
 * How much one request of some classes costs on some pieces, compared with a
 * plain one: N+1 queries make each read count as many on the database.
 */
export interface Work {
  kinds: Kind[]
  classes: RequestClass[]
  /** Load one request puts on the piece, in plain requests. */
  factor: number
  /** Time added to each request there, in ms. */
  extraMs?: number
}

export interface CodeOption {
  id: string
  /** What the player picks, in a few words. */
  label: string
  /** The code after the change. */
  code: string
  fixes: boolean
  /** Why it works, or why it does not. */
  explanation: string
  /** What the requests cost with this change; nothing extra when empty. */
  work: Work[]
  /** Links of the challenge's lock that this change opens. */
  allows?: Link[]
  /** Settings this change gives the player on the pieces. */
  settings?: 'balance'[]
  /** How balancing pieces divide once this code is in, without a setting. */
  balance?: Balance
  /** Why a change that passes is still a poor one. */
  caveat?: string
}

/** Links from one kind of piece to others. */
export interface Link {
  from: Kind
  to: Kind[]
}

export interface CodeChallenge {
  id: string
  /** The endpoint with the bug. */
  class: UserClass
  title: string
  /** The code as the level opens, read-only. */
  code: string
  /** What the requests cost while the bug is there. */
  bug: Work[]
  options: CodeOption[]
  /** Links the code forbids until an option opens them, and why. */
  locks?: { links: Link[]; reason: string }
}

/** Whether `links` holds the link from one kind to the other. */
const hasLink = (links: Link[] | undefined, from: Kind, to: Kind) => !!links?.some((l) => l.from === from && l.to.includes(to))

/** Why the level's code forbids a link from one kind to another, or null when nothing does. */
export function lockedLink(level: Pick<Level, 'code'> | undefined, fixes: Architecture['fixes'], from: Kind, to: Kind): string | null {
  for (const ch of level?.code ?? []) {
    if (!ch.locks || !hasLink(ch.locks.links, from, to)) continue
    const picked = ch.options.find((o) => o.id === fixes?.[ch.id])
    if (!hasLink(picked?.allows, from, to)) return ch.locks.reason
  }
  return null
}

/** The options the design picked, one per challenge of the level. */
const pickedOptions = (level: Pick<Level, 'code'> | undefined, fixes: Architecture['fixes']): CodeOption[] =>
  (level?.code ?? []).flatMap((ch) => ch.options.filter((o) => o.id === fixes?.[ch.id]))

/** Whether the level's code, as fixed, lets the player set how balancing pieces divide. */
export const canSetBalance = (level: Pick<Level, 'code'> | undefined, fixes: Architecture['fixes']): boolean =>
  pickedOptions(level, fixes).some((o) => o.settings?.includes('balance'))

/** How a balancing piece divides in this design: the code's own way, the player's setting when the code allows one, round robin otherwise. */
export function balanceOf(node: ArchNode, level: Pick<Level, 'code'> | undefined, fixes: Architecture['fixes'], pieces: Record<string, Spec> = SPECS): Balance {
  if (!pieces[node.kind].balances) return 'round-robin'
  const forced = pickedOptions(level, fixes).find((o) => o.balance)?.balance
  if (forced) return forced
  return canSetBalance(level, fixes) ? (node.balance ?? 'round-robin') : 'round-robin'
}

/** What one instance handles: its kind's capacity, unless the level says this one differs. */
export function instanceCapacity(level: Pick<Level, 'nodeTweaks'>, node: ArchNode, pieces: Record<string, Spec> = SPECS): number {
  return level.nodeTweaks?.find((tw) => tw.id === node.id)?.capacity ?? pieces[node.kind].capacity
}

/** The links of a design that its code does not forbid. */
export function openEdges(arch: Architecture, level: Pick<Level, 'code'> | undefined): ArchEdge[] {
  const kind = new Map(arch.nodes.map((n) => [n.id, n.kind]))
  return arch.edges.filter((e) => {
    const from = kind.get(e.source)
    const to = kind.get(e.target)
    return !from || !to || lockedLink(level, arch.fixes, from, to) === null
  })
}

/** What the requests cost in this design: the bug of every challenge not fixed, the picked option's work otherwise. */
export function levelWork(level: Level, arch: Pick<Architecture, 'fixes'>): Work[] {
  return [...(level.work ?? []), ...(level.code ?? []).flatMap((ch) => ch.options.find((o) => o.id === arch.fixes?.[ch.id])?.work ?? ch.bug)]
}
