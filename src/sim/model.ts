// Domain model: component catalogue, architecture graph and level definitions.

export type Kind = 'client' | 'cdn' | 'lb' | 'server' | 'cache' | 'db'
export type RequestClass = 'static' | 'read' | 'write'

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
  },
  server: {
    label: 'Servidor',
    capacity: 400,
    baseLatencyMs: 30,
    cost: 50,
    serves: { static: 1 },
    targets: ['cache', 'db'],
    maxOut: 1,
    description: 'Roda a aplicação. Responde estáticos; leituras e escritas vão adiante.',
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

export function totalCost(arch: Architecture): number {
  return arch.nodes.reduce((sum, n) => sum + SPECS[n.kind].cost, 0)
}

export function rpsAt(level: Level, t: number): number {
  let rps = 0
  for (const phase of level.traffic) if (t >= phase.from) rps = phase.rps
  return rps
}
