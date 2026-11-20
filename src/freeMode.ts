// Free mode: systems the player draws outside the career, each with its own
// traffic and drawing. Everything here is pure; a system becomes a Level and
// runs through the same engine as any stage, with goals that never fail.

import { MAX_EDGES, MAX_NODES, parseDesign } from './savedDesign'
import type { SavedEdge, SavedNode } from './savedDesign'
import { SPECS } from './sim/model'
import type { Architecture, Kind, Level, TrafficPhase, UserClass } from './sim/model'

export const FREE_KEY = 'gargalo:free'
export const EXPORT_FORMAT = 'gargalo-sistema'
export const EXPORT_VERSION = 1
export const MAX_NAME = 60
export const MAX_RPS = 1_000_000
export const MIN_DURATION_S = 10
export const MAX_DURATION_S = 300
export const MAX_ROWS = 20
/** How far the mix may be from 100%, as a fraction. */
export const MIX_TOLERANCE = 0.001
const MAX_FILE_CHARS = 1_000_000

export interface Spike {
  from: number
  to: number
  /** Requests per second during the spike (replaces the base rate). */
  rps: number
}

export interface FreeFailure {
  kind: Kind
  index: number
  from: number
  to: number
}

export interface Traffic {
  rps: number
  /** Shares of static, read and write requests; they add up to 1. */
  mix: Record<UserClass, number>
  durationS: number
  /** Share of reads and writes asking for the same key, 0 to 1. */
  hotKey: number
  spikes: Spike[]
  failures: FreeFailure[]
}

export type SavedDesign = { nodes: SavedNode[]; edges: SavedEdge[] }

export interface FreeSystem {
  id: string
  name: string
  /** The guiding question of the template it started from, if any. */
  question?: string
  /** Id of the template it started from, if any: starting over brings back the template's drawing. */
  template?: string
  traffic: Traffic
  /** The drawing; null until the player touches the board (it then opens with the template's start or just the users). */
  design: SavedDesign | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const CLASSES: UserClass[] = ['static', 'read', 'write']
const CLASS_NAME: Record<UserClass, string> = { static: 'estáticos', read: 'leituras', write: 'escritas' }

/** Kinds a failure may hit: anything the player buys. */
export const FAILABLE: Kind[] = (Object.keys(SPECS) as Kind[]).filter((k) => k !== 'client' && !SPECS[k].external)

export const defaultTraffic = (): Traffic => ({
  rps: 500,
  mix: { static: 0.3, read: 0.5, write: 0.2 },
  durationS: 60,
  hotKey: 0,
  spikes: [],
  failures: [],
})

/** Every problem with the traffic, in words for the player. Empty when it can run. */
export function validateTraffic(t: Traffic): string[] {
  const errors: string[] = []
  if (!num(t.rps) || t.rps <= 0) errors.push('Os req/s precisam ser maiores que zero.')
  else if (t.rps > MAX_RPS) errors.push(`Os req/s não podem passar de ${MAX_RPS.toLocaleString('pt-BR')}.`)
  if (!num(t.durationS) || !Number.isInteger(t.durationS) || t.durationS < MIN_DURATION_S || t.durationS > MAX_DURATION_S)
    errors.push(`A duração precisa ser um número inteiro de ${MIN_DURATION_S} a ${MAX_DURATION_S} segundos.`)
  const shares = CLASSES.map((c) => t.mix[c])
  if (shares.some((s) => !num(s) || s < 0)) errors.push('A mistura não aceita porcentagem negativa.')
  else if (Math.abs(shares.reduce((a, b) => a + b, 0) - 1) > MIX_TOLERANCE)
    errors.push(`A mistura precisa somar 100%; hoje soma ${Math.round(shares.reduce((a, b) => a + b, 0) * 1000) / 10}%.`)
  if (!num(t.hotKey) || t.hotKey < 0 || t.hotKey > 1) errors.push('A chave quente precisa ficar entre 0% e 100%.')
  const inside = (from: number, to: number) =>
    num(from) && num(to) && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to && to <= (num(t.durationS) ? t.durationS : MAX_DURATION_S)
  if (t.spikes.length > MAX_ROWS) errors.push(`Use no máximo ${MAX_ROWS} picos.`)
  t.spikes.forEach((s, i) => {
    if (!inside(s.from, s.to)) errors.push(`Pico ${i + 1}: o início precisa vir antes do fim, dentro da duração.`)
    if (!num(s.rps) || s.rps <= 0 || s.rps > MAX_RPS) errors.push(`Pico ${i + 1}: os req/s precisam ser maiores que zero.`)
  })
  if (t.failures.length > MAX_ROWS) errors.push(`Use no máximo ${MAX_ROWS} falhas.`)
  t.failures.forEach((f, i) => {
    if (!inside(f.from, f.to)) errors.push(`Falha ${i + 1}: o início precisa vir antes do fim, dentro da duração.`)
    if (!FAILABLE.includes(f.kind)) errors.push(`Falha ${i + 1}: escolha uma peça que dá para derrubar.`)
    if (!Number.isInteger(f.index) || f.index < 0) errors.push(`Falha ${i + 1}: o número da peça precisa ser 1 ou mais.`)
  })
  return errors
}

/** The traffic from untrusted data, or null when its shape is wrong (a value that is not a number, a list that is not a list). */
function readTraffic(v: unknown): Traffic | null {
  if (!isObject(v) || !isObject(v.mix) || !Array.isArray(v.spikes) || !Array.isArray(v.failures)) return null
  if (!num(v.rps) || !num(v.durationS) || !num(v.hotKey)) return null
  if (!CLASSES.every((c) => num((v.mix as Record<string, unknown>)[c]))) return null
  const mix = v.mix as Record<UserClass, number>
  if (v.spikes.length > MAX_ROWS || v.failures.length > MAX_ROWS) return null
  const spikes: Spike[] = []
  for (const s of v.spikes) {
    if (!isObject(s) || !num(s.from) || !num(s.to) || !num(s.rps)) return null
    spikes.push({ from: s.from, to: s.to, rps: s.rps })
  }
  const failures: FreeFailure[] = []
  for (const f of v.failures) {
    if (!isObject(f) || !num(f.index) || !num(f.from) || !num(f.to) || typeof f.kind !== 'string' || !Object.hasOwn(SPECS, f.kind)) return null
    failures.push({ kind: f.kind as Kind, index: f.index, from: f.from, to: f.to })
  }
  return { rps: v.rps, mix: { static: mix.static, read: mix.read, write: mix.write }, durationS: v.durationS, hotKey: v.hotKey, spikes, failures }
}

/** A design from the board (or a file) cleaned of anything the board cannot draw; null when it cannot be one. */
export function cleanDesign(design: unknown): SavedDesign | null {
  if (!isObject(design) || !Array.isArray(design.nodes) || !Array.isArray(design.edges)) return null
  if (design.nodes.length > MAX_NODES || design.edges.length > MAX_EDGES) return null
  return parseDesign(JSON.stringify({ nodes: design.nodes, edges: design.edges }))
}

export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)

/** One system read from untrusted data; `strict` also refuses traffic the simulation could not run. */
function readSystem(v: unknown, strict: boolean): { system: FreeSystem } | { error: string } {
  if (!isObject(v)) return { error: 'O sistema não tem o formato esperado.' }
  const name = typeof v.name === 'string' ? cleanName(v.name) : ''
  if (!name) return { error: 'O sistema precisa de um nome.' }
  const traffic = readTraffic(v.traffic)
  if (!traffic) return { error: 'O tráfego do sistema está incompleto ou tem valores que não são números.' }
  if (strict) {
    const problems = validateTraffic(traffic)
    if (problems.length) return { error: `O tráfego do arquivo é inválido. ${problems[0]}` }
  }
  let design: SavedDesign | null = null
  if (v.design !== null && v.design !== undefined) {
    design = cleanDesign(v.design)
    if (!design) return { error: 'O desenho do arquivo não pode ser aberto: faltam os Usuários ou há peças e ligações desconhecidas.' }
  }
  const id = typeof v.id === 'string' && v.id ? v.id : newId()
  const question = typeof v.question === 'string' && v.question.trim() ? v.question.trim().slice(0, 300) : undefined
  const template = knownTemplate(v.template)
  return { system: { id, name, ...(question ? { question } : {}), ...(template ? { template } : {}), traffic, design } }
}

let counter = 0
function newId(): string {
  counter++
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-${counter}`
}

/** The saved list, dropping what is not a system. Traffic that cannot run yet is kept: the player is still editing it. */
export function loadSystems(raw: string | null): FreeSystem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: FreeSystem[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    const read = readSystem(item, false)
    if ('error' in read || seen.has(read.system.id)) continue
    seen.add(read.system.id)
    out.push(read.system)
  }
  return out
}

// CRUD: each returns a new list.

export function createSystem(
  list: FreeSystem[],
  opts: { name?: string; traffic?: Traffic; question?: string; template?: string; design?: unknown } = {},
): { list: FreeSystem[]; system: FreeSystem } {
  const template = knownTemplate(opts.template)
  const system: FreeSystem = {
    id: newId(),
    name: cleanName(opts.name ?? '') || `Sistema ${list.length + 1}`,
    ...(opts.question ? { question: opts.question } : {}),
    ...(template ? { template } : {}),
    traffic: structuredClone(opts.traffic ?? defaultTraffic()),
    design: opts.design ? cleanDesign(opts.design) : null,
  }
  return { list: [...list, system], system }
}

/** A blank name leaves the system as it was. */
export function renameSystem(list: FreeSystem[], id: string, name: string): FreeSystem[] {
  const clean = cleanName(name)
  return clean ? list.map((s) => (s.id === id ? { ...s, name: clean } : s)) : list
}

export function duplicateSystem(list: FreeSystem[], id: string): { list: FreeSystem[]; system: FreeSystem | null } {
  const index = list.findIndex((s) => s.id === id)
  if (index === -1) return { list, system: null }
  const source = list[index]
  const system: FreeSystem = { ...structuredClone(source), id: newId(), name: cleanName(`${source.name} (cópia)`) }
  return { list: [...list.slice(0, index + 1), system, ...list.slice(index + 1)], system }
}

export const deleteSystem = (list: FreeSystem[], id: string): FreeSystem[] => list.filter((s) => s.id !== id)

export const updateTraffic = (list: FreeSystem[], id: string, traffic: Traffic): FreeSystem[] =>
  list.map((s) => (s.id === id ? { ...s, traffic } : s))

/** Keeps the board's drawing on the system; something that cannot be drawn is ignored. */
export function updateDesign(list: FreeSystem[], id: string, design: unknown): FreeSystem[] {
  const clean = cleanDesign(design)
  return clean ? list.map((s) => (s.id === id ? { ...s, design: clean } : s)) : list
}

// Level

/** The base rate, with each spike replacing it for its window (the highest wins where spikes overlap). */
function phases(t: Traffic): TrafficPhase[] {
  const spikes = t.spikes.filter((s) => num(s.from) && num(s.to) && num(s.rps) && s.from < s.to)
  const marks = [...new Set([0, ...spikes.flatMap((s) => [s.from, s.to])])].filter((m) => m >= 0).sort((a, b) => a - b)
  const out: TrafficPhase[] = []
  for (const from of marks) {
    const covering = spikes.filter((s) => from >= s.from && from < s.to)
    const rps = covering.length ? Math.max(...covering.map((s) => s.rps)) : t.rps
    if (out.length === 0 || out[out.length - 1].rps !== rps) out.push({ from, rps })
  }
  return out
}

/** Goals that never fail: free mode shows what was measured and nothing else. */
const NO_GOALS = { minAvailability: 0, maxP99Ms: Infinity, maxCost: Infinity }

/** The level a system plays. Never throws: traffic being edited may not be valid yet (running is blocked then). */
export function levelOf(system: FreeSystem): Level {
  const t = system.traffic
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const share = CLASSES.map((c) => `${pct(num(t.mix[c]) ? t.mix[c] : 0)} ${CLASS_NAME[c]}`).join(', ')
  const briefing = [
    `${num(t.rps) ? t.rps.toLocaleString('pt-BR') : '?'} req/s: ${share}.`,
    system.question,
    'Modo livre: sem metas. O selo mostra só o que foi medido.',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    id: `livre-${system.id}`,
    title: system.name,
    briefing,
    durationS: num(t.durationS) && t.durationS > 0 ? Math.floor(t.durationS) : 60,
    mix: { static: t.mix.static, read: t.mix.read, write: t.mix.write },
    traffic: phases(t),
    failures: t.failures.filter((f) => num(f.from) && num(f.to) && num(f.index)).map((f) => ({ ...f })),
    ...(t.hotKey > 0 ? { hotKey: t.hotKey } : {}),
    goals: { ...NO_GOALS },
  }
}

// Export and import

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  system: { name: string; question?: string; template?: string; traffic: Traffic; design: SavedDesign | null }
}

export function exportSystem(system: FreeSystem): string {
  const { name, question, template, traffic, design } = system
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    system: { name, ...(question ? { question } : {}), ...(template ? { template } : {}), traffic, design },
  }
  return JSON.stringify(file, null, 2)
}

/** A file name for a system: lowercase, no accents, dashes. */
export function exportFileName(system: FreeSystem): string {
  const slug = system.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `gargalo-${slug || 'sistema'}.json`
}

/** A new system (with a new id) from the text of an exported file, or why it was refused. */
export function importSystem(text: string): { ok: true; system: FreeSystem } | { ok: false; error: string } {
  if (typeof text !== 'string' || text.length > MAX_FILE_CHARS) return { ok: false, error: 'O arquivo é grande demais para ser um sistema do gargalo.' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' }
  }
  if (!isObject(value) || value.format !== EXPORT_FORMAT) return { ok: false, error: 'Esse arquivo não é um sistema exportado pelo gargalo.' }
  if (value.version !== EXPORT_VERSION) return { ok: false, error: 'Esse arquivo vem de uma versão do gargalo que não conheço.' }
  const read = readSystem(isObject(value.system) ? { ...value.system, id: undefined } : value.system, true)
  return 'error' in read ? { ok: false, error: read.error } : { ok: true, system: read.system }
}

// Templates

export interface Template {
  id: string
  name: string
  /** What is special about the traffic, one line. */
  about: string
  /** The question that guides the drawing. */
  question: string
  traffic: Traffic
  /** What is on the drawing at the start; just the users when absent. */
  start?: Architecture
}

const node = (id: string, kind: Kind) => ({ id, kind })
const link = (source: string, target: string) => ({ source, target })

/** The id when it names a template, undefined otherwise. */
function knownTemplate(id: unknown): string | undefined {
  return typeof id === 'string' && TEMPLATES.some((t) => t.id === id) ? id : undefined
}

/** What a system's drawing starts from, and goes back to when the player starts over: its template's start, or just the users. */
export function startOf(system: Pick<FreeSystem, 'template'>): Architecture {
  return TEMPLATES.find((t) => t.id === system.template)?.start ?? { nodes: [{ id: 'client', kind: 'client' }], edges: [] }
}

export const TEMPLATES: Template[] = [
  {
    id: 'encurtador',
    name: 'Encurtador de URL',
    about: 'Quase só leitura, com alguns links virais que concentram os acessos.',
    question: 'Cada clique é uma leitura do mesmo punhado de links. O que tira esse peso do banco?',
    traffic: { rps: 2400, mix: { static: 0.02, read: 0.97, write: 0.01 }, durationS: 60, hotKey: 0.3, spikes: [], failures: [] },
    start: {
      nodes: [node('client', 'client'), node('lb', 'lb'), node('server-0', 'server'), node('server-1', 'server'), node('db', 'db')],
      edges: [link('client', 'lb'), link('lb', 'server-0'), link('lb', 'server-1'), link('server-0', 'db'), link('server-1', 'db')],
    },
  },
  {
    id: 'chat',
    name: 'Chat',
    about: 'Muitas escritas pequenas, uma a cada mensagem enviada.',
    question: 'As mensagens chegam mais rápido do que o banco grava. Como aceitar tudo sem deixar ninguém esperando?',
    traffic: { rps: 1800, mix: { static: 0.05, read: 0.3, write: 0.65 }, durationS: 60, hotKey: 0, spikes: [], failures: [] },
  },
  {
    id: 'feed',
    name: 'Feed de rede social',
    about: 'Leitura pesada e fan-out: um post de quem tem muitos seguidores vira milhares de leituras.',
    question: 'Quando alguém muito seguido posta, todos os seguidores pedem a mesma coisa. Onde guardar o que muita gente lê?',
    traffic: { rps: 3200, mix: { static: 0.25, read: 0.65, write: 0.1 }, durationS: 60, hotKey: 0.2, spikes: [{ from: 25, to: 40, rps: 5000 }], failures: [] },
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    about: 'Tráfego calmo e uma liquidação que quadruplica os pedidos, com a cobrança feita por uma API de outra empresa.',
    question: 'Na liquidação a fila para pagar cresce e um servidor cai. Como seguir vendendo mesmo assim?',
    traffic: {
      rps: 500,
      mix: { static: 0.3, read: 0.5, write: 0.2 },
      durationS: 60,
      hotKey: 0,
      spikes: [{ from: 20, to: 45, rps: 2000 }],
      failures: [{ kind: 'server', index: 0, from: 30, to: 42 }],
    },
    start: {
      nodes: [node('client', 'client'), node('lb', 'lb'), node('server-0', 'server'), node('server-1', 'server'), node('db', 'db'), node('payment', 'payment')],
      edges: [link('client', 'lb'), link('lb', 'server-0'), link('lb', 'server-1'), link('server-0', 'db'), link('server-1', 'db'), link('server-0', 'payment'), link('server-1', 'payment')],
    },
  },
]
