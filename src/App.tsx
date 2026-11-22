import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent, ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, Edge, IsValidConnection, OnBeforeDelete, OnConnectEnd, OnConnectStart, OnNodeDrag, OnSelectionChangeFunc } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { TopBar } from './TopBar'
import { navigate, pathOf, screenOf } from './route'
import type { Screen } from './route'
import { LockIcon } from './LockIcon'
import { ContextMenu } from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import {
  applyRemoval,
  eventPoint,
  isEmptyRemoval,
  planRemoval,
  pointInRect,
  pushBounded,
  removalMessage,
  undoRemoval,
} from './editing'
import type { Removal } from './editing'
import { EditorContext } from './editorContext'
import { dialogOpen, isTyping } from './keys'
import type { Editor } from './editorContext'
import { CodePanel } from './CodePanel'
import { serverCode } from './serverCode'
import { Inspector } from './Inspector'
import { ALTERNATIVES } from './alternatives'
import { KindIcon } from './KindIcon'
import { COMPANIES, CURRENT_KEY, PASSED_KEY, findStage, levelStatus, loadProgress, pieceUnlock, startArchitecture } from './career'
import type { Progress, Stage } from './career'
import { DAILY_KEY, dailyLevel, dailyXp, loadDaily, localDate, shareText, streak } from './daily'
import type { Daily, DailyRecord } from './daily'
import { TrafficEditor } from './TrafficEditor'
import { FREE_KEY, TEMPLATES, createSystem, deleteSystem, duplicateSystem, importSystem, levelOf, loadSystems, renameSystem, startOf, updateDesign, updateTraffic, validateTraffic } from './freeMode'
import type { FreeSystem, SavedDesign } from './freeMode'
import { Stars } from './Stars'
import { GoalRow } from './GoalRow'
import { FAST_SHARE, RESULTS_KEY, THRIFTY_SHARE, loadResults, record, resultOf, starGaps, xpGain } from './score'
import type { LevelResult, Results } from './score'
import { NodeCard } from './NodeCard'
import { RegionArea } from './RegionArea'
import type { RegionAreaNode } from './RegionArea'
import { NodeRunStats } from './NodeRunStats'
import type { ComponentNode } from './NodeCard'
import { MAX_EDGES, MAX_NODES, parseDesign } from './savedDesign'
import { drawShareCard } from './shareImage'
import { decodeShare, encodeShare } from './shareLink'
import { LinkPanel } from './LinkPanel'
import type { LinkPolicy } from './LinkPanel'
import { RemovableEdge } from './RemovableEdge'
import { Sparkline } from './Sparkline'
import { isDown } from './sim/engine'
import type { FailureReason, NodeStats, RunSummary, TickResult } from './sim/engine'
import { runInBackground } from './sim/runner'
import { bottleneck, nodeName, timeline } from './sim/debrief'
import type { Bottleneck } from './sim/debrief'
import { costPerMillion, mostSaturated } from './sim/metrics'
import { HOME_REGION, PROTOCOLS, REGIONS, SPECS, balanceOf, canConnect, canSetBalance, instanceCapacity, connectRefusal, endpointsOf, levelRegions, lockedLink, openEdges, regionOf, totalCost } from './sim/model'
import type { Architecture, Kind, Level, Region } from './sim/model'

// Screens away from the board load when first opened.
const CareerMap = lazy(() => import('./CareerMap').then((m) => ({ default: m.CareerMap })))
const FreeSystems = lazy(() => import('./FreeSystems').then((m) => ({ default: m.FreeSystems })))
const Profile = lazy(() => import('./Profile').then((m) => ({ default: m.Profile })))

const nodeTypes = { component: NodeCard, region: RegionArea }
const DELETE_KEYS = ['Backspace', 'Delete']
const FIT_VIEW = { maxZoom: 1, padding: 0.3 }
/** How long the drawing must stay still before it is saved. */
const SAVE_DELAY_MS = 300
const edgeTypes = { removable: RemovableEdge }
const PALETTE: Kind[] = ['dns', 'cdn', 'limiter', 'gateway', 'lb', 'server', 'cache', 'db', 'shard', 'replica', 'queue', 'worker', 'storage', 'topic', 'search']
const COLUMN: Record<Kind, number> = {
  client: 0,
  dns: 200,
  cdn: 200,
  limiter: 300,
  gateway: 400,
  lb: 400,
  server: 600,
  cache: 820,
  db: 1020,
  shard: 1020,
  queue: 820,
  worker: 1020,
  replica: 1240,
  payment: 820,
  storage: 400,
  topic: 820,
  search: 1240,
}
/** Pieces that share a column with another start lower, so they don't land on top of it. */
const FIRST_ROW: Partial<Record<Kind, number>> = { dns: -230, queue: 320, worker: 320, limiter: -110, gateway: 150, payment: -160, shard: -340, storage: -330, topic: 540, search: -220 }
/** Height of the canvas band each region keeps: São Paulo on top, then Virgínia, then Frankfurt. */
const REGION_BAND = 900
const bandOf = (region: Region) => (Object.keys(REGIONS) as Region[]).indexOf(region)
const TICK_MS = 120
const TOAST_MS = 6000
const PANEL_KEY = 'gargalo:panel'
const LONG_PRESS_MS = 550

type BoardRemoval = Removal<ComponentNode, Edge>
/** What undo puts back: a removal, or the whole drawing as it was before starting over. */
type UndoEntry = BoardRemoval | { reset: Design }

const undoMessage = (entry: UndoEntry) => ('reset' in entry ? 'Desenho recomeçado.' : removalMessage(entry))

/** A fresh id for a piece the player adds. */
const pieceId = (kind: Kind) => `${kind}-${Date.now().toString(36)}`

interface MenuState {
  x: number
  y: number
  target: { node: ComponentNode } | { edge: Edge }
  /** Where focus goes back to when the menu closes: the piece or link it was opened on. */
  opener: HTMLElement | SVGElement | null
}


/** What the board needs to play a level: a career stage or the daily challenge. */
interface Play {
  level: Level
  /** The drawing when no design is saved. */
  start: Architecture
  /** Pieces in the palette. */
  pieces: Kind[]
  unlock: (kind: Kind) => ReturnType<typeof pieceUnlock>
  /** Caption of the goals sheet. */
  sheet: string
  /** A design opened from a shared link: shown instead of the saved one, and never saved over it. */
  shared?: ReturnType<typeof parseDesign>
  /** Career phases can be shared as an image and a link. */
  linkable?: boolean
  /** Company id, for its line colour (data-company, DESIGN.md). */
  company?: string
  /** Makes a result worth sharing; the Result then offers to copy it. */
  share?: (stars: number, cost: number, p99Ms: number) => string
  /** A free-mode system: no goals to pass, nothing recorded, the drawing lives on the system. */
  free?: {
    design: SavedDesign | null
    onDesign: (design: unknown) => void
    /** Why the simulation cannot run yet, when it cannot. */
    blocked?: string
  }
}

const DAILY_PIECES: Kind[] = ['client', 'cdn', 'limiter', 'lb', 'server', 'cache', 'db']

function careerPlay(stage: Stage, shared?: Play['shared']): Play {
  return {
    shared,
    linkable: true,
    company: stage.company.id,
    level: stage.level,
    start: startArchitecture(stage),
    pieces: PALETTE,
    unlock: (kind) => pieceUnlock(kind, stage.companyIndex),
    sheet: `Folha ${stage.number}/${stage.company.levels.length + 1}`,
  }
}

function dailyPlay(daily: Daily): Play {
  return {
    level: daily.level,
    start: { nodes: [{ id: 'client', kind: 'client' }], edges: [] },
    pieces: PALETTE.filter((k) => DAILY_PIECES.includes(k)),
    unlock: () => ({ unlocked: true }),
    sheet: daily.date.split('-').reverse().join('/'),
    share: (stars, cost, p99Ms) => shareText(daily, stars, cost, p99Ms),
  }
}

function freePlay(system: FreeSystem, level: Level, blocked?: string, onDesign: (design: unknown) => void = () => {}): Play {
  return {
    level,
    start: startOf(system),
    pieces: [...PALETTE, 'payment'],
    unlock: () => ({ unlocked: true }),
    sheet: 'Modo livre',
    free: { design: system.design, onDesign, blocked },
  }
}

const designKey = (level: Level) => `gargalo:design:${level.id}`

interface Design {
  nodes: ComponentNode[]
  edges: Edge[]
  /** Option picked for each code challenge of the level. */
  fixes?: Record<string, string>
}

/** The level's starting architecture laid out in columns, pieces of the same kind stacked. */
function freshDesign(arch: Architecture): Design {
  const nodes = arch.nodes.map((n): ComponentNode => {
    // Kinds that share a column with another (payment above the cache) keep their own row.
    const same = arch.nodes.filter((m) => m.kind === n.kind && regionOf(m) === regionOf(n))
    const y = (FIRST_ROW[n.kind] ?? 120) + (same.indexOf(n) - (same.length - 1) / 2) * 110 + bandOf(regionOf(n)) * REGION_BAND
    return {
      id: n.id,
      type: 'component',
      position: { x: COLUMN[n.kind], y },
      data: { kind: n.kind, ...(n.region ? { region: n.region } : {}), ...(n.balance ? { balance: n.balance } : {}) },
      // The users and pieces run by another company stay on the drawing.
      ...(n.kind === 'client' || SPECS[n.kind].external ? { deletable: false } : {}),
    }
  })
  return {
    nodes,
    edges: arch.edges.map(({ source, target, ...policy }) => ({
      id: `${source}->${target}`,
      source,
      target,
      ...(Object.keys(policy).length ? { data: policy } : {}),
    })),
  }
}

function loadDesign(play: Play): Design {
  if (play.shared) return play.shared
  if (play.free) return (play.free.design as Design | null) ?? freshDesign(play.start)
  const raw = readStorage(designKey(play.level))
  // Storage unavailable or holding something the board cannot draw: start from scratch.
  return (raw && parseDesign(raw, play.level)) || freshDesign(play.start)
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Fired on the window when the browser refuses to save (storage full or off). */
const SAVE_FAILED = 'gargalo:save-failed'

function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Everything still works this session; the player is told it will not last.
    window.dispatchEvent(new Event(SAVE_FAILED))
    return false
  }
}

/** Each day's challenge keeps its drawing under this prefix plus the date; only today's can be played. */
const DAILY_DESIGN_PREFIX = 'gargalo:design:diario-'

/** Retries, backoff, breaker and idempotency key set on a link (kept in the edge's data). */
const policyOf = (e: Edge): LinkPolicy => (e.data ?? {}) as LinkPolicy

function toArchitecture(nodes: ComponentNode[], edges: Edge[]): Architecture {
  return {
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, ...(n.data.region ? { region: n.data.region } : {}), ...(n.data.balance ? { balance: n.data.balance } : {}) })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, ...policyOf(e) })),
  }
}

/** "3 retries com backoff · breaker · chave de idempotência", or undefined for a plain link. */
function policyLabel(p: LinkPolicy): string | undefined {
  const parts: string[] = []
  if (p.protocol && p.protocol !== 'rest') parts.push(PROTOCOLS[p.protocol].label)
  if (p.retries) parts.push(`${p.retries} ${p.retries === 1 ? 'retry' : 'retries'}${p.backoff ? ' com backoff' : ''}`)
  if (p.breaker) parts.push('breaker')
  if (p.idempotent) parts.push('chave de idempotência')
  return parts.length ? parts.join(' · ') : undefined
}

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.9995 ? 0 : 1).replace('.', ',')}%`
const THRIFTY_PCT = Math.round(THRIFTY_SHARE * 100)
const FAST_PCT = Math.round(FAST_SHARE * 100)
const ms = (n: number) => `${Math.round(n)} ms`
const money = (n: number) => `$${n.toFixed(2).replace('.', ',')}`
const count = (n: number) => Math.round(n).toLocaleString('pt-BR')

const REASONS: [FailureReason, string][] = [
  ['overload', 'sobrecarga'],
  ['down', 'fora do ar'],
  ['noRoute', 'sem rota'],
  ['limited', 'limite (429)'],
  ['breaker', 'circuit breaker aberto'],
  ['flaky', 'falha transitória'],
]

/** "120 por sobrecarga, 30 sem rota", or undefined when nothing was lost. */
function lostByReason(failed: Record<FailureReason, number>, unit = ''): string | undefined {
  const parts = REASONS.filter(([r]) => failed[r] >= 0.5).map(([r, name]) => `${count(failed[r])}${unit} por ${name}`)
  return parts.length ? parts.join(', ') : undefined
}

function hints(summary: RunSummary, ticks: TickResult[], arch: Architecture, level: Level): string[] {
  const total = ticks.reduce((s, t) => s + t.rps, 0) || 1
  const out: string[] = []
  if (summary.failed.noRoute / total > 0.001)
    out.push('Algumas requisições não tinham para onde ir. Confira se os usuários chegam a um servidor e se cada servidor chega ao banco.')
  if (summary.failed.overload / total > 0.001)
    out.push('Algum componente passou da capacidade e começou a descartar requisições. Arraste o controle acima até o momento em que algo fica vermelho.')
  const stormy = arch.edges.some((e) => (e.retries ?? 0) > 0 && !e.backoff && !e.breaker)
  // A fragile piece down when the level did not take it out: load knocked it over.
  const crashedNode = arch.nodes.find(
    (node) =>
      SPECS[node.kind].crashesAbove !== undefined &&
      ticks.some((t) => t.nodes[node.id]?.down && !isDown(arch, level, node, t.t)),
  )
  const crashed = crashedNode !== undefined
  if (crashedNode) {
    const name = SPECS[crashedNode.kind].label
    out.push(
      stormy
        ? `Tentativas extras sem backoff chegam todas no mesmo segundo e multiplicam a carga de quem já está mal: ${name} recebeu a enxurrada e caiu. Ligue o backoff ou um circuit breaker na ligação.`
        : `${name} recebeu bem mais do que aguenta e caiu por alguns segundos. Reduza o que chega até ele.`,
    )
  }
  if (summary.failed.breaker / total > 0.001)
    out.push(
      `${pct(summary.failed.breaker / total)} das requisições falharam na hora num circuit breaker aberto. É o preço de deixar o destino se recuperar; o que não pode é ele cair de novo assim que fecha.`,
    )
  if (summary.failed.flaky / total > 0.001)
    out.push(
      `${pct(summary.failed.flaky / total)} das requisições falharam à toa: uma peça de outra empresa erra de vez em quando, sem relação com a carga. Uma tentativa extra resolve a maioria; numa escrita, ligue também a chave de idempotência.`,
    )
  if (summary.failed.limited / total > 0.001)
    out.push(
      `${pct(summary.failed.limited / total)} das requisições de usuários foram recusadas com 429. Recusar rápido protege o que está atrás, mas cada 429 é alguém sem resposta: dê mais capacidade ao que fica depois do limite.`,
    )
  // A crash from overload is already explained above; this one is about pieces taken out by the level.
  if (summary.failed.down / total > 0.001 && !crashed)
    out.push('Requisições foram mandadas para um servidor fora do ar. Um load balancer para de enviar tráfego a servidores que caem.')
  if (!summary.passed.p99 && out.length === 0)
    out.push(
      ticks.some((t) => Object.values(t.nodes).some((n) => n.down))
        ? 'Nenhuma requisição se perdeu, mas está lento: com uma peça fora do ar, as que sobraram ficam com a carga dela e formam fila. Folga de capacidade derruba o p99.'
        : 'Nenhuma requisição se perdeu, mas está lento. Componentes perto do limite formam fila; folga de capacidade derruba o p99.',
    )
  if (summary.staleReadRate >= 0.01)
    out.push(`${pct(summary.staleReadRate)} das leituras devolveram dado velho. Réplicas e índices de busca atrasam mais quando recebem muitas mudanças ou estão cheios de leituras; uma réplica sem ligação do banco, ou um índice que não assina um tópico, nunca é atualizado.`)
  if (!summary.passed.duplicates)
    out.push(`${pct(summary.duplicateRate)} das escritas foram executadas duas vezes: a resposta se perdeu e a tentativa extra repetiu o pedido. Ligue a chave de idempotência na ligação, para o destino reconhecer a repetição.`)
  if (summary.backlogAtEnd >= 1)
    out.push(`A rodada terminou com ${count(summary.backlogAtEnd)} mensagens esperando na fila. Se o backlog não esvazia, o problema só foi adiado: ponha mais workers.`)
  if (summary.async.lost >= 1)
    out.push(`${count(summary.async.lost)} escritas foram aceitas pela fila e se perderam depois. Confira se os workers chegam ao banco e se ele aguenta o ritmo deles.`)
  if (!summary.passed.cost)
    out.push('Acima do orçamento. Procure o componente que resolve o gargalo gastando menos.')
  return out
}

export default function App() {
  // A shared link opens its phase with the sender's design; the saved design stays untouched.
  const [shared, setShared] = useState(() => decodeShare(location.search))
  const [progress, setProgress] = useState<Progress>(() => {
    const saved = loadProgress(readStorage)
    return shared ? { ...saved, current: shared.level.id } : saved
  })
  const [results, setResults] = useState<Results>(() => loadResults(readStorage(RESULTS_KEY), progress.passed))
  const resultsRef = useRef(results)
  /** The screen the URL names; back, forward and the top bar change it through popstate. */
  const [screen, setScreen] = useState<Screen>(() => screenOf(location.pathname, location.search))
  /** Free mode: the list (id null) or a system being played; null while on the career or the daily. */
  const [free, setFree] = useState<{ id: string | null } | null>(() => (screen === 'livre' ? { id: null } : null))
  const [systems, setSystems] = useState<FreeSystem[]>(() => loadSystems(readStorage(FREE_KEY)))
  // The latest saved list, readable from the board's callbacks without re-rendering the app.
  // `render` is false for the board's drawing, which the board already shows.
  const [store] = useState(() => {
    const self = {
      list: systems,
      commit(next: FreeSystem[], render = true) {
        if (next === self.list) return
        self.list = next
        save(FREE_KEY, next)
        if (render) setSystems(next)
      },
    }
    return self
  })
  const [dailyRecord, setDailyRecord] = useState<DailyRecord>(() => loadDaily(readStorage(DAILY_KEY)))
  const dailyRef = useRef(dailyRecord)
  /** The daily challenge being played, or null while on the career. */
  const [daily, setDaily] = useState<Daily | null>(() => (screen === 'desafio' ? dailyLevel(localDate(new Date())) : null))
  const [today, setToday] = useState(() => localDate(new Date()))
  // The URL changed (back, forward, a link): show the screen it names.
  useEffect(() => {
    const onPop = () => {
      const next = screenOf(location.pathname, location.search)
      setScreen(next)
      setDaily(next === 'desafio' ? dailyLevel(today) : null)
      // Back to /livre keeps the system that was open.
      setFree((f) => (next === 'livre' ? (f ?? { id: null }) : null))
      if (next === 'livre') setSystems(store.list)
      if (next === 'fase') {
        const link = decodeShare(location.search)
        setShared(link)
        if (link) setProgress((prev) => ({ ...prev, current: link.level.id }))
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [today, store])
  // A tab left open past midnight picks up the new day when it is looked at again.
  useEffect(() => {
    const refresh = () => setToday(localDate(new Date()))
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  // Another tab saved progress, results or systems: this one picks them up, so it never writes
  // its older copy over them.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FREE_KEY || e.key === null) {
        const list = loadSystems(readStorage(FREE_KEY))
        store.list = list
        setSystems(list)
      }
      if (e.key === PASSED_KEY || e.key === RESULTS_KEY || e.key === null) {
        const saved = loadProgress(readStorage).passed
        setProgress((prev) => ({ ...prev, passed: saved }))
        const next = loadResults(readStorage(RESULTS_KEY), saved)
        resultsRef.current = next
        setResults(next)
      }
      if (e.key === DAILY_KEY || e.key === null) {
        const record = loadDaily(readStorage(DAILY_KEY))
        dailyRef.current = record
        setDailyRecord(record)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [store])

  const [unsaved, setUnsaved] = useState(false)
  useEffect(() => {
    const onFail = () => setUnsaved(true)
    window.addEventListener(SAVE_FAILED, onFail)
    return () => window.removeEventListener(SAVE_FAILED, onFail)
  }, [])

  // Drawings of past daily challenges can never be played again.
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage))
        if (key.startsWith(DAILY_DESIGN_PREFIX) && key !== `${DAILY_DESIGN_PREFIX}${today}`) localStorage.removeItem(key)
    } catch {
      // Storage unavailable: nothing to tidy.
    }
  }, [today])

  const { passed, current } = progress
  const stage = findStage(current)!
  const { company } = stage

  useEffect(() => {
    save(CURRENT_KEY, current)
  }, [current])

  /** Saves a finished run (passed list and best result) and returns the XP it added. */
  const markPassed = useCallback((id: string, result: LevelResult) => {
    setProgress((prev) => {
      if (prev.passed.includes(id)) return prev
      const next = [...prev.passed, id]
      save(PASSED_KEY, next)
      return { ...prev, passed: next }
    })
    const gain = xpGain(resultsRef.current, id, result)
    const next = record(resultsRef.current, id, result)
    if (next !== resultsRef.current) {
      resultsRef.current = next
      setResults(next)
      save(RESULTS_KEY, next)
    }
    return gain
  }, [])

  /** Saves a finished daily run, keeping the best stars of the date, and returns the XP it added. */
  const markDaily = useCallback((date: string, result: LevelResult) => {
    const before = dailyRef.current
    if (result.stars === 0 || result.stars <= (before[date] ?? 0)) return 0
    const next = { ...before, [date]: result.stars }
    dailyRef.current = next
    setDailyRecord(next)
    save(DAILY_KEY, next)
    return dailyXp(next, date) - dailyXp(before, date)
  }, [])

  /** The panel's open tab, kept across levels so picking a phase leaves the list open. */
  const [panelTab, setPanelTab] = useState<PanelTab>('parts')
  /** The level the player just opened: its button in the new board's list takes the focus. */
  const focusLevel = useRef<string | null>(null)
  const play = (levelId: string) => {
    focusLevel.current = levelId
    setShared(null)
    setProgress((prev) => ({ ...prev, current: levelId }))
    navigate(pathOf('fase'))
  }
  const backToCareer = () => navigate(pathOf('fase'))
  const saveDesign = (id: string, design: unknown) => store.commit(updateDesign(store.list, id, design), false)
  const openFreeList = () => {
    setFree({ id: null })
    navigate(pathOf('livre'))
  }
  const openSystem = (id: string) => {
    setSystems(store.list)
    setFree({ id })
  }
  const createFree = (templateId?: string) => {
    const t = TEMPLATES.find((x) => x.id === templateId)
    const { list, system } = createSystem(store.list, {
      ...(t ? { name: t.name, traffic: t.traffic, question: t.question, template: t.id, design: t.start ? freshDesign(t.start) : null } : {}),
    })
    store.commit(list)
    setFree({ id: system.id })
  }
  const importFree = (text: string): string | null => {
    const result = importSystem(text)
    if (!result.ok) return result.error
    store.commit([...store.list, result.system])
    return null
  }
  const system = free?.id ? systems.find((s) => s.id === free.id) : undefined
  const freeLevel = useMemo(() => (system ? levelOf(system) : null), [system])
  const days = streak(dailyRecord, today)

  const profile = (
    <>
      {unsaved && (
        <div className="toast toast--notice save-warning" role="status">
          <span>O navegador não deixou salvar: o que você fizer nesta aba some quando ela fechar.</span>
          <button type="button" onClick={() => setUnsaved(false)}>
            Ok
          </button>
        </div>
      )}
    </>
  )

  const top = <TopBar screen={screen} />

  if (screen === 'carreira' || screen === 'perfil')
    return (
      <>
        {top}
        <Suspense fallback={null}>
          {screen === 'carreira' ? (
            <CareerMap passed={passed} results={results} current={current} onPlay={play} />
          ) : (
            <Profile passed={passed} results={results} daily={dailyRecord} today={today} />
          )}
        </Suspense>
        {profile}
      </>
    )

  // The other screens moved to the top bar; the panel keeps only the way back.
  const backLink = (
    <span className="levels__links">
      <button type="button" className="levels__map" onClick={backToCareer}>
        Voltar à carreira
      </button>
    </span>
  )
  const streakNote = days > 0 && <p className="levels__streak">Sequência: {days} {days === 1 ? 'dia' : 'dias'}</p>

  if (free && !system)
    return (
      <>
        {top}
        {profile}
        <Suspense fallback={null}>
          <FreeSystems
          systems={systems}
          onOpen={openSystem}
          onCreate={createFree}
          onRename={(id, name) => store.commit(renameSystem(store.list, id, name))}
          onDuplicate={(id) => store.commit(duplicateSystem(store.list, id).list)}
          onDelete={(id) => store.commit(deleteSystem(store.list, id))}
          onImport={importFree}
          onClose={backToCareer}
          />
        </Suspense>
      </>
    )

  if (system && freeLevel) {
    const errors = validateTraffic(system.traffic)
    return (
      <div className="shell">
      {top}
      <ReactFlowProvider key={freeLevel.id}>
        {profile}
        <Board
          play={freePlay(system, freeLevel, errors[0], (design) => saveDesign(system.id, design))}
          onPassed={() => 0}
          where="Modo livre"
          links={
            <span className="levels__links">
              <button type="button" className="levels__map" onClick={openFreeList}>
                Meus sistemas
              </button>
              <button type="button" className="levels__map" onClick={backToCareer}>
                Voltar à carreira
              </button>
            </span>
          }
          phases={{
            label: 'Tráfego',
            content: <TrafficEditor traffic={system.traffic} errors={errors} onChange={(t) => store.commit(updateTraffic(store.list, system.id, t))} />,
          }}
          tab={panelTab}
          onTab={setPanelTab}
        />
      </ReactFlowProvider>
      </div>
    )
  }

  if (daily)
    return (
      <div className="shell">
      {top}
      <ReactFlowProvider key={daily.level.id}>
        {profile}
        <Board
          play={dailyPlay(daily)}
          onPassed={(_, result) => markDaily(daily.date, result)}
          where={daily.date.split('-').reverse().join('/')}
          note={streakNote}
          links={backLink}
          tab={panelTab}
          onTab={setPanelTab}
        />
      </ReactFlowProvider>
      </div>
    )

  return (
    <div className="shell">
    {top}
    <ReactFlowProvider key={stage.level.id}>
      {profile}
      <Board
        play={careerPlay(stage, shared?.level.id === stage.level.id ? shared.design : undefined)}
        onPassed={markPassed}
        where={`Empresa ${stage.companyIndex + 1} · ${company.name}`}
        note={streakNote}
        tab={panelTab}
        onTab={setPanelTab}
        phases={{
          label: 'Fases',
          content: (
          <nav className="levels" aria-label={`Fases da empresa ${company.name}`}>
            {[...company.levels, company.boss].map((l, i) => {
              const status = levelStatus(l.id, passed)
              const isBoss = l === company.boss
              const current = l.id === stage.level.id
              return (
                <button
                  key={l.id}
                  ref={(el) => {
                    if (el && focusLevel.current === l.id) {
                      focusLevel.current = null
                      el.focus()
                    }
                  }}
                  className={`${current ? 'is-current' : ''}${isBoss ? ' is-boss' : ''}`}
                  aria-current={current ? 'step' : undefined}
                  disabled={status === 'locked'}
                  title={status === 'locked' ? (isBoss ? 'Conclua as fases da empresa para enfrentar o chefão' : 'Conclua a fase anterior') : undefined}
                  onClick={() => play(l.id)}
                >
                  <span className="levels__n">{i + 1}</span>
                  <span className="levels__title">
                    {l.title}
                    {isBoss && <span className="levels__boss">Chefão</span>}
                  </span>
                  {status === 'done' && (
                    <span className="levels__marks">
                      <span className="tick" aria-label="concluída">✓</span>
                      {results[l.id] && <Stars count={results[l.id].stars} />}
                    </span>
                  )}
                  {status === 'locked' && <LockIcon label="bloqueada" />}
                </button>
              )
            })}
          </nav>
          ),
        }}
      />
    </ReactFlowProvider>
    </div>
  )
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** One level's editor and simulation. Remounted per level so each starts from its saved design. */
type PanelTab = 'phases' | 'parts'
const PANEL_TABS: PanelTab[] = ['phases', 'parts']

type BoardProps = {
  play: Play
  /** Where the level sits (company, daily, free mode), above its title. */
  where: string
  note?: ReactNode
  /** The way back (to the career, to the free systems), in the panel header; the other screens are in the top bar. */
  links?: ReactNode
  /** What the first panel tab holds (the company's phases, the free system's traffic); without it the panel shows only the pieces. */
  phases?: { label: string; content: ReactNode }
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onPassed: (id: string, result: LevelResult) => number
}

function Board({ play, where, note, links, phases, tab, onTab, onPassed }: BoardProps) {
  const { level } = play
  const { fitView } = useReactFlow()
  /** Id of a just-added node to bring into view once React Flow has measured it. */
  const pendingFit = useRef<string | null>(null)
  const [initial] = useState(() => loadDesign(play))
  const [nodes, setNodes, onNodesChange] = useNodesState<ComponentNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges)
  const [fixes, setFixes] = useState<Record<string, string>>(() => initial.fixes ?? {})
  /** Id of the code challenge whose code is open on the side panel. */
  const [codeId, setCodeId] = useState<string | null>(null)
  const [run, setRun] = useState<{ ticks: TickResult[]; summary: RunSummary } | null>(null)
  /** How many simulated seconds are on screen; scrubbable once the run ends. */
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** A run is being computed: the drawing waits for its result. */
  const [computing, setComputing] = useState(false)
  /** Bumped whenever a run in progress stops mattering (the drawing changed, the board closed). */
  const runId = useRef(0)
  useEffect(() => () => void runId.current++, [])
  const running = playing && run !== null && shown < run.ticks.length

  const finished = run !== null && !running
  const tick = run && shown > 0 ? run.ticks[shown - 1] : undefined
  // The design as the engine sees it. Moving or selecting pieces leaves it as it was, so it keeps its
  // identity and nothing that reads it is redone on every frame of a drag.
  const designJson = JSON.stringify({ ...toArchitecture(nodes, edges), ...(Object.keys(fixes).length ? { fixes } : {}) })
  const arch = useMemo((): Architecture => JSON.parse(designJson), [designJson])
  const cost = totalCost(arch)

  const onDesign = useRef(play.free?.onDesign)
  // The drawing is saved once it stops changing for a moment, and at once when the board closes.
  const pendingSave = useRef<(() => void) | null>(null)
  useEffect(() => {
    pendingSave.current = () => {
      if (play.shared) return
      if (onDesign.current) onDesign.current({ nodes, edges })
      else save(designKey(level), { nodes, edges, fixes })
    }
    const id = setTimeout(() => {
      pendingSave.current?.()
      pendingSave.current = null
    }, SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [level, nodes, edges, fixes, play.shared])
  useEffect(() => {
    const flush = () => {
      pendingSave.current?.()
      pendingSave.current = null
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    const added = nodes.find((n) => n.id === pendingFit.current)
    if (!added?.measured?.width) return
    pendingFit.current = null
    fitView({ padding: 0.3, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 250 })
  }, [nodes, fitView])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setShown((s) => s + 1), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  const recorded = useRef<typeof run>(null)
  const [gain, setGain] = useState(0)
  useEffect(() => {
    if (play.free || !finished || !run.summary.passed.all || recorded.current === run) return
    recorded.current = run
    setGain(onPassed(level.id, resultOf(run.summary, level)))
  }, [finished, run, onPassed, level, play.free])

  const editable = !running && !computing
  const clearRun = useCallback(() => {
    runId.current++
    setComputing(false)
    setRun(null)
    setShown(0)
    setPlaying(false)
  }, [])
  // A free system whose traffic changed no longer has the run on screen to show.
  const lastLevel = useRef(level)
  useEffect(() => {
    if (lastLevel.current === level) return
    lastLevel.current = level
    clearRun()
  }, [level, clearRun])

  // Removal, undo and the context menu. Every removal goes through `commitRemoval`.
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [toast, setToast] = useState<UndoEntry | null>(null)
  /** Why the last connection the player tried was refused. */
  const [notice, setNotice] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => readStorage(PANEL_KEY) !== JSON.stringify('closed'))
  const togglePanel = () => {
    focusToggle.current = true
    setPanelOpen((open) => {
      save(PANEL_KEY, open ? 'closed' : 'open')
      return !open
    })
  }
  // The button pressed disappears with the panel or comes back inside it: focus follows.
  const focusToggle = useRef(false)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focusToggle.current) return
    focusToggle.current = false
    ;(panelOpen ? collapseRef : expandRef).current?.focus()
  }, [panelOpen])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragging, setDragging] = useState(false)
  const [overTrash, setOverTrash] = useState(false)
  const trashRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef(new Map<string, { x: number; y: number }>())

  const commitRemoval = useCallback(
    (removal: BoardRemoval) => {
      if (isEmptyRemoval(removal)) return
      const after = applyRemoval(nodesRef.current, edgesRef.current, removal)
      setNodes(after.nodes)
      setEdges(after.edges)
      setUndoStack((st) => pushBounded(st, removal))
      setToast(removal)
      clearRun()
    },
    [setNodes, setEdges, clearRun],
  )

  const remove = useCallback(
    (nodeIds: string[], edgeIds: string[] = []) => {
      if (!editable) return
      commitRemoval(planRemoval(nodesRef.current, edgesRef.current, nodeIds, edgeIds))
    },
    [editable, commitRemoval],
  )

  const undo = useCallback(() => {
    if (!editable) return
    const last = undoStack.at(-1)
    if (!last) return
    setUndoStack((st) => st.slice(0, -1))
    setToast(null)
    clearRun()
    if ('reset' in last) {
      setNodes(last.reset.nodes)
      setEdges(last.reset.edges)
      setFixes(last.reset.fixes ?? {})
      return
    }
    // A piece the drawing takes only once does not come back when another took its place.
    const count = new Map<Kind, number>()
    for (const n of nodesRef.current) count.set(n.data.kind, (count.get(n.data.kind) ?? 0) + 1)
    const refused: Kind[] = []
    const back = undoRemoval(nodesRef.current, edgesRef.current, last, (n) => {
      const seen = (count.get(n.data.kind) ?? 0) + 1
      if (seen > (SPECS[n.data.kind].maxCount ?? Infinity)) {
        refused.push(n.data.kind)
        return false
      }
      count.set(n.data.kind, seen)
      return true
    })
    setNodes(back.nodes)
    setEdges(back.edges)
    if (refused.length) setNotice(`${SPECS[refused[0]].label} já está no desenho e só cabe um: o que foi removido não voltou.`)
  }, [editable, undoStack, setNodes, setEdges, clearRun])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), TOAST_MS)
    return () => clearTimeout(id)
  }, [notice])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (isTyping(e.target) || dialogOpen()) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const editor: Editor = useMemo(() => ({ editable, remove }), [editable, remove])

  /** React Flow's Delete/Backspace: do the removal ourselves so it can be undone. */
  const onBeforeDelete: OnBeforeDelete<ComponentNode, Edge> = useCallback(
    async ({ nodes: ns, edges: es }) => {
      remove(
        ns.map((n) => n.id),
        es.map((e) => e.id),
      )
      return false
    },
    [remove],
  )

  const isOverTrash = (event: Event | { clientX: number; clientY: number }) => {
    const p = eventPoint(event)
    const rect = trashRef.current?.getBoundingClientRect()
    return !!p && !!rect && pointInRect(p.x, p.y, rect)
  }

  const onNodeDragStart: OnNodeDrag<ComponentNode> = (_e, _node, dragged) => {
    dragStart.current = new Map(dragged.map((n) => [n.id, { ...n.position }]))
    setDragging(dragged.some((n) => n.deletable !== false))
  }

  const onNodeDrag: OnNodeDrag<ComponentNode> = (event, _node, dragged) => {
    const removable = dragged.some((n) => n.deletable !== false)
    setOverTrash(editable && removable && isOverTrash(event))
  }

  const onNodeDragStop: OnNodeDrag<ComponentNode> = (event, _node, dragged) => {
    const drop = editable && isOverTrash(event)
    setOverTrash(false)
    setDragging(false)
    if (!drop) return
    // Undo should put pieces back where they were before the drag, not on the trash.
    const before = nodesRef.current.map((n) => {
      const pos = dragStart.current.get(n.id)
      return pos ? { ...n, position: pos } : n
    })
    commitRemoval(
      planRemoval(
        before,
        edgesRef.current,
        dragged.map((n) => n.id),
      ),
    )
  }

  const openMenu = useCallback((x: number, y: number, target: MenuState['target'], opener: Element | null) => {
    if (!editable) return
    if ('node' in target && target.node.deletable === false) return
    // Keyboard-opened menus (Shift+F10) report 0,0: open at the element instead.
    if (x === 0 && y === 0 && opener) {
      const r = opener.getBoundingClientRect()
      x = r.left + r.width / 2
      y = r.top + r.height / 2
    }
    setMenu({ x, y, target, opener: opener instanceof HTMLElement || opener instanceof SVGElement ? opener : null })
  }, [editable])
  const onNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: ComponentNode) => {
      e.preventDefault()
      openMenu(e.clientX, e.clientY, { node }, e.currentTarget as Element)
    },
    [openMenu],
  )
  const onEdgeContextMenu = useCallback(
    (e: ReactMouseEvent, edge: Edge) => {
      e.preventDefault()
      openMenu(e.clientX, e.clientY, { edge }, e.currentTarget as Element)
    },
    [openMenu],
  )
  const onEdgesChangeWhenEditable: typeof onEdgesChange = useCallback(
    (changes) => {
      if (editable) onEdgesChange(changes)
    },
    [editable, onEdgesChange],
  )
  const closeMenuOnMove = useCallback(() => setMenu(null), [])

  const closeMenu = useCallback(() => {
    setMenu((m) => {
      // A removed piece took its focus with it: the canvas gets it back.
      if (m?.opener?.isConnected) m.opener.focus()
      else canvasRef.current?.focus()
      return null
    })
  }, [])

  const duplicate = (node: ComponentNode) => {
    if (!canAdd(node.data.kind)) return
    clearRun()
    const id = pieceId(node.data.kind)
    setNodes((ns) => [
      ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
      {
        id,
        type: 'component',
        position: { x: node.position.x + 32, y: node.position.y + 32 },
        data: { kind: node.data.kind, ...(node.data.region ? { region: node.data.region } : {}), ...(node.data.balance ? { balance: node.data.balance } : {}) },
        selected: true,
      },
    ])
  }

  const menuItems = (target: MenuState['target']): MenuItem[] =>
    'node' in target
      ? [
          ...(canAdd(target.node.data.kind) ? [{ label: 'Duplicar', onSelect: () => duplicate(target.node) }] : []),
          { label: 'Remover', onSelect: () => remove([target.node.id]) },
        ]
      : [{ label: 'Remover', onSelect: () => remove([], [target.edge.id]) }]

  // Long-press opens the menu on touch screens that never fire contextmenu (iOS).
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null)
  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current.timer)
    longPress.current = null
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    cancelLongPress()
    if (e.pointerType !== 'touch' || !editable) return
    const el = e.target as Element
    const nodeEl = el.closest<HTMLElement>('.react-flow__node')
    const edgeEl = el.closest<HTMLElement>('.react-flow__edge')
    const { clientX: x, clientY: y } = e
    const timer = window.setTimeout(() => {
      longPress.current = null
      const node = nodeEl && nodesRef.current.find((n) => n.id === nodeEl.dataset.id)
      const edge = edgeEl && edgesRef.current.find((ed) => ed.id === edgeEl.dataset.id)
      if (node) openMenu(x, y, { node }, nodeEl)
      else if (edge) openMenu(x, y, { edge }, null)
    }, LONG_PRESS_MS)
    longPress.current = { timer, x, y }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const lp = longPress.current
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) cancelLongPress()
  }

  const isValidConnection: IsValidConnection = useCallback(
    (c) => canConnect(arch, c.source, c.target, level),
    [arch, level],
  )

  // A drop on a piece that refuses the link says why instead of silently doing nothing.
  /** Where a link started when it is made by clicking one handle and then another. */
  const clickStart = useRef<{ nodeId: string; handleType: 'source' | 'target' } | null>(null)
  const onClickConnectStart: OnConnectStart = (_event, { nodeId, handleType }) => {
    clickStart.current = nodeId && handleType ? { nodeId, handleType } : null
  }
  const onClickConnectEnd: OnConnectEnd = (event) => {
    const start = clickStart.current
    clickStart.current = null
    const end = event.target instanceof Element ? event.target.closest<HTMLElement>('.react-flow__node')?.dataset.id : undefined
    if (!start || !end || end === start.nodeId) return
    const [source, target] = start.handleType === 'target' ? [end, start.nodeId] : [start.nodeId, end]
    const why = connectRefusal(arch, source, target, level)
    if (why) setNotice(why)
  }

  const onConnectEnd: OnConnectEnd = (_event, state) => {
    if (state.isValid || !state.fromNode || !state.toNode) return
    const [source, target] =
      state.fromHandle?.type === 'target' ? [state.toNode.id, state.fromNode.id] : [state.fromNode.id, state.toNode.id]
    setNotice(connectRefusal(arch, source, target, level))
  }

  const onConnect = useCallback(
    (c: Connection) => {
      if (edgesRef.current.length >= MAX_EDGES) {
        setNotice(`Cabem até ${MAX_EDGES} ligações num desenho.`)
        return
      }
      setNotice(null)
      clearRun()
      // The same id the links a level starts with have, so undo and saving see one link per pair.
      setEdges((es) => addEdge({ ...c, id: `${c.source}->${c.target}` }, es))
    },
    [setEdges, clearRun],
  )

  const atMax = (kind: Kind) => nodes.filter((n) => n.data.kind === kind).length >= (SPECS[kind].maxCount ?? Infinity)
  /** Whether one more piece of `kind` fits the drawing. */
  const canAdd = (kind: Kind) => !atMax(kind) && nodes.length < MAX_NODES

  const addComponent = (kind: Kind) => {
    if (atMax(kind)) return
    if (nodes.length >= MAX_NODES) {
      setNotice(`Cabem até ${MAX_NODES} peças num desenho.`)
      return
    }
    clearRun()
    const sameKind = nodes.filter((n) => n.data.kind === kind).length
    const id = pieceId(kind)
    setNodes((ns) => [
      ...ns,
      { id, type: 'component', position: { x: COLUMN[kind], y: (FIRST_ROW[kind] ?? 20) + sameKind * 100 }, data: { kind } },
    ])
    pendingFit.current = id
  }

  // Concepts panel: the single selected piece, or a kind opened from the parts list.
  const [listInfo, setListInfo] = useState<{ kind: Kind; opener: HTMLElement } | null>(null)
  const closeListInfo = useCallback(() => setListInfo(null), [])
  const selected = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)
  const selectedLink = selected.length === 0 && selectedEdges.length === 1 ? selectedEdges[0] : undefined
  const codeChallenge = level.code?.find((c) => c.id === codeId)
  /** The picked code divides on its own, so the player has no say in it. */
  const forcedBalance = !!level.code?.some((c) => c.options.some((o) => o.balance && o.id === fixes[c.id]))
  const inspected = listInfo?.kind ?? (selected.length === 1 ? selected[0].data.kind : null)
  // What the selected server runs, written from where its open links go.
  const inspectedCode =
    !listInfo && selected.length === 1 && selected[0].data.kind === 'server'
      ? serverCode(
          openEdges(arch, level)
            .filter((e) => e.source === selected[0].id)
            .map((edge) => ({ kind: arch.nodes.find((n) => n.id === edge.target)!.kind, edge })),
          Object.fromEntries(endpointsOf(level).map((e) => [e.class, e.route])),
        )
      : undefined

  const openInfo = (kind: Kind, opener: HTMLElement) => {
    setCodeId(null)
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
    setListInfo({ kind, opener })
  }

  const closeInfo = useCallback(() => {
    setListInfo((info) => {
      if (info?.opener.isConnected) info.opener.focus()
      return null
    })
    setNodes((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns))
  }, [setNodes])

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: picked }) => {
    if (picked.length > 0) {
      setListInfo(null)
      setCodeId(null)
    }
  }, [])

  const reset = () => {
    const fresh = freshDesign(play.start)
    const before: UndoEntry = { reset: { nodes: nodesRef.current, edges: edgesRef.current, fixes } }
    setNodes(fresh.nodes)
    setEdges(fresh.edges)
    setUndoStack((st) => pushBounded(st, before))
    setToast(before)
    setFixes({})
    setCodeId(null)
    clearRun()
  }

  const start = () => {
    if (play.free?.blocked || computing) return
    setMenu(null)
    setGain(0)
    const id = ++runId.current
    setComputing(true)
    void runInBackground(arch, level, Date.now() & 0xffff).then((result) => {
      if (runId.current !== id) return
      setComputing(false)
      setRun(result)
      setShown(0)
      setPlaying(true)
    })
  }

  // Multi-region levels (or designs already spread out) show the regions on the canvas.
  const regionChoices = useMemo(() => {
    const used = nodes.map((n) => regionOf({ id: n.id, ...n.data })).filter((_, i) => !SPECS[nodes[i].data.kind].global)
    const all = new Set<Region>([...levelRegions(level), ...used])
    return levelRegions(level).length > 1 || used.some((r) => r !== HOME_REGION)
      ? (Object.keys(REGIONS) as Region[]).filter((r) => all.has(r))
      : []
  }, [nodes, level])
  const multiRegion = regionChoices.length > 0

  // A piece keeps its display object until the piece, its numbers on screen or the level change,
  // so a drag re-renders the piece being dragged and not the others.
  const [cardCache] = useState(() => new WeakMap<ComponentNode, { stats?: NodeStats; level: Level; card: ComponentNode }>())
  const displayNodes = useMemo((): (ComponentNode | RegionAreaNode)[] => {
    const cards = nodes.map((n) => {
      const stats = tick?.nodes[n.id]
      const kept = cardCache.get(n)
      if (kept && kept.stats === stats && kept.level === level) return kept.card
      const capacity = instanceCapacity(level, { id: n.id, kind: n.data.kind })
      const card = { ...n, data: { ...n.data, ...(capacity !== SPECS[n.data.kind].capacity ? { capacity } : {}), ...(stats ? { stats } : {}) } }
      cardCache.set(n, { stats, level, card })
      return card
    })
    if (!multiRegion) return cards
    const PAD = 28
    const areas = regionChoices.flatMap((region): RegionAreaNode[] => {
      const inside = cards.filter((n) => !SPECS[n.data.kind].global && regionOf({ id: n.id, ...n.data }) === region)
      if (inside.length === 0) return []
      const left = Math.min(...inside.map((n) => n.position.x)) - PAD
      const top = Math.min(...inside.map((n) => n.position.y)) - PAD - 12
      const right = Math.max(...inside.map((n) => n.position.x + (n.measured?.width ?? 184))) + PAD
      const bottom = Math.max(...inside.map((n) => n.position.y + (n.measured?.height ?? 90))) + PAD
      const down = !!tick && !!level.regionOutages?.some((o) => o.region === region && tick.t >= o.from && tick.t < o.to)
      return [
        {
          id: `region-${region}`,
          type: 'region',
          position: { x: left, y: top },
          width: right - left,
          height: bottom - top,
          data: { region, down },
          zIndex: -1,
          selectable: false,
          draggable: false,
          connectable: false,
          focusable: false,
          deletable: false,
        },
      ]
    })
    return [...areas, ...cards]
  }, [nodes, tick, multiRegion, regionChoices, level, cardCache])
  // The links only need each piece's name, which a drag does not change.
  const labels = useMemo(() => new Map(arch.nodes.map((n) => [n.id, SPECS[n.kind].label])), [arch])
  const displayEdges = useMemo(() => {
    const labelOf = (id: string) => labels.get(id) ?? id
    const base = edges.map((e) => ({
      ...e,
      type: 'removable',
      ariaLabel: `Ligação de ${labelOf(e.source)} para ${labelOf(e.target)}`,
      label: policyLabel(policyOf(e)),
    }))
    if (!tick) return base
    const peak = Math.max(1, ...Object.values(tick.edges))
    return base.map((e) => {
      const rps = tick.edges[`${e.source}->${e.target}`] ?? 0
      const breaker = tick.breakers[`${e.source}->${e.target}`]
      // The dotted line already shows an open breaker; its words go to screen readers, so labels don't pile up.
      const state = breaker === 'open' ? ', circuit breaker aberto' : breaker === 'half-open' ? ', circuit breaker testando' : ''
      return {
        ...e,
        animated: rps > 0,
        ariaLabel: `${e.ariaLabel}${state}`,
        label: rps > 0 ? `${Math.round(rps)}/s` : undefined,
        className: breaker ? `edge--${breaker}` : undefined,
        style: { strokeWidth: 1.5 + 6 * (rps / peak), opacity: rps > 0 || breaker ? 1 : 0.35 },
      }
    })
  }, [labels, edges, tick])

  const visible = run ? run.ticks.slice(0, shown) : []
  const g = level.goals
  // Free mode has no goals: the sheet only shows what was measured.
  const free = !!play.free
  const measured = finished ? run.summary : undefined
  const saturated = tick && mostSaturated(tick)
  const perMillion = costPerMillion(cost, level)
  const selectNode = (id: string) => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })))
  // Two tabs: either arrow moves to the other one, Home and End go to the ends.
  const onTabKey = (e: ReactKeyboardEvent) => {
    const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    const next: PanelTab | null = e.key === 'Home' ? 'phases' : e.key === 'End' ? 'parts' : arrow ? (tab === 'phases' ? 'parts' : 'phases') : null
    if (!next) return
    e.preventDefault()
    onTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <div className={`app${panelOpen ? '' : ' is-collapsed'}`} data-company={play.company}>
      <aside className="panel" id="panel" hidden={!panelOpen}>
        <header className="brand">
          <p className="phase__where">{where}</p>
          <button
            ref={collapseRef}
            type="button"
            className="panel__toggle"
            onClick={togglePanel}
            aria-expanded={panelOpen}
            aria-controls="panel"
            aria-label="Recolher painel"
          >
            <PanelIcon />
          </button>
          {links && (
            <nav className="brand__links" aria-label="Voltar">
              {links}
            </nav>
          )}
        </header>

        <div className="phase">
          <h1 className="phase__title">{level.title}</h1>
          {note}
        </div>

        <p className="brief">{level.briefing}</p>
        {play.shared && <p className="hint">Desenho de um link compartilhado: o que você mudar aqui não é salvo.</p>}

        {phases && (
          <>
            <div className="segmented panel__tabs" role="tablist" aria-label="Painel da fase" onKeyDown={onTabKey}>
              {PANEL_TABS.map((t) => (
                <button
                  key={t}
                  id={`tab-${t}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls={`tabpanel-${t}`}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => onTab(t)}
                >
                  {t === 'phases' ? phases.label : 'Peças'}
                </button>
              ))}
            </div>
            <div className="panel__tabpanel" id="tabpanel-phases" role="tabpanel" aria-labelledby="tab-phases" hidden={tab !== 'phases'}>
              {phases.content}
            </div>
          </>
        )}

        <section
          className="parts panel__tabpanel"
          {...(phases ? { id: 'tabpanel-parts', role: 'tabpanel', 'aria-labelledby': 'tab-parts' } : { 'aria-labelledby': 'parts-title' })}
          hidden={!!phases && tab !== 'parts'}
        >
          {!phases && <h2 id="parts-title">Peças</h2>}
          <ul>
            {play.pieces.map((kind) => {
              const unlock = play.unlock(kind)
              return (
              <li key={kind} className={unlock.unlocked ? undefined : 'is-locked'}>
                <button className="part" onClick={() => addComponent(kind)} disabled={!editable || !unlock.unlocked || atMax(kind)}>
                  <KindIcon kind={kind} size={22} />
                  <span className="part__name">
                    {SPECS[kind].label}
                    {!unlock.unlocked && <LockIcon />}
                  </span>
                  {unlock.unlocked ? (
                    <span className="part__spec">
                      {SPECS[kind].capacity.toLocaleString('pt-BR')} req/s, ${SPECS[kind].cost}/mês
                      {atMax(kind) && ` · já no desenho, ${SPECS[kind].maxCount === 1 ? 'só cabe um' : `até ${SPECS[kind].maxCount}`}`}
                    </span>
                  ) : (
                    <span className="part__spec">
                      {unlock.by ? `Bloqueada até a empresa ${COMPANIES.indexOf(unlock.by) + 1}, ${unlock.by.name}.` : 'Bloqueada. Chega numa próxima empresa.'}
                    </span>
                  )}
                  <span className="part__desc">{SPECS[kind].description}</span>
                </button>
                <button
                  type="button"
                  className={`part__info${listInfo?.kind === kind ? ' is-open' : ''}`}
                  aria-label={`Sobre ${SPECS[kind].label}`}
                  aria-pressed={listInfo?.kind === kind}
                  title={`Sobre ${SPECS[kind].label}`}
                  onClick={(e) => (listInfo?.kind === kind ? closeInfo() : openInfo(kind, e.currentTarget))}
                >
                  <InfoIcon />
                </button>
              </li>
              )
            })}
          </ul>
          <p className="help">
            Clique numa peça para pôr no desenho, ou no ⓘ para ler sobre ela. Arraste da bolinha direita de um componente até outro para ligar,
            ou selecione a peça e use Ligar a, no painel dela.
            Para remover, arraste a peça até a lixeira, use o × da peça ou ligação selecionada, ou o menu do clique
            direito (toque longo no celular). Ctrl+Z desfaz.
          </p>
        </section>
      </aside>

      <main className="stage">
        <div className="workspace">
          <div
            ref={canvasRef}
            className="canvas"
            tabIndex={-1}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
          >
            <EditorContext.Provider value={editor}>
              <ReactFlow
                // Region areas are inert (not selectable, draggable or deletable), so no handler ever sees one.
                nodes={displayNodes as ComponentNode[]}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChangeWhenEditable}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onClickConnectStart={onClickConnectStart}
                onClickConnectEnd={onClickConnectEnd}
                autoPanOnNodeDrag={false}
                selectNodesOnDrag={false}
                isValidConnection={isValidConnection}
                nodesConnectable={editable}
                nodesDraggable={editable}
                deleteKeyCode={editable ? DELETE_KEYS : null}
                onBeforeDelete={onBeforeDelete}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                onMoveStart={closeMenuOnMove}
                onSelectionChange={onSelectionChange}
                onPaneClick={closeListInfo}
                fitView
                fitViewOptions={FIT_VIEW}
                minZoom={0.2}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--grid)" />
                <Controls showInteractive={false} position="top-left" />
                {!panelOpen && (
                  <button
                    ref={expandRef}
                    type="button"
                    className="panel__open"
                    onClick={togglePanel}
                    aria-expanded={false}
                    aria-controls="panel"
                  >
                    <PanelIcon />
                    Painel da fase
                  </button>
                )}
              </ReactFlow>
            </EditorContext.Provider>

            {editable && (
              <div
                ref={trashRef}
                className={`trash${dragging ? ' is-armed' : ''}${overTrash ? ' is-over' : ''}`}
                aria-hidden
              >
                <TrashIcon />
                <span>{overTrash ? 'Solte para remover' : 'Lixeira'}</span>
              </div>
            )}

            <div className="toast-slot" role="status" aria-live="polite">
              {notice && (
                <div className="toast toast--notice">
                  <span>{notice}</span>
                  <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">
                    Ok
                  </button>
                </div>
              )}
              {toast && (
                <div className="toast">
                  <span>{undoMessage(toast)}</span>
                  <button type="button" onClick={undo} disabled={!editable}>
                    Desfazer
                  </button>
                </div>
              )}
            </div>

            {menu && editable && (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                label={'node' in menu.target ? 'Ações da peça' : 'Ações da ligação'}
                items={menuItems(menu.target)}
                onClose={closeMenu}
              />
            )}
          </div>

          {codeChallenge && (
            <CodePanel
              challenge={codeChallenge}
              route={endpointsOf(level).find((e) => e.class === codeChallenge.class)?.route ?? ''}
              picked={fixes[codeChallenge.id]}
              editable={editable}
              onPick={(optionId) => {
                clearRun()
                const next = { ...fixes, [codeChallenge.id]: optionId }
                setFixes(next)
                // Links the new code forbids go away, with the reason.
                const drawn = { ...toArchitecture(nodes, edges), fixes: next }
                const open = new Set(openEdges(drawn, level))
                const kept = edges.filter((_, i) => open.has(drawn.edges[i]))
                const gone = edges.length - kept.length
                if (gone === 0) return
                const kind = new Map(nodes.map((n) => [n.id, n.data.kind]))
                const e = edges.find((_, i) => !open.has(drawn.edges[i]))!
                const reason = lockedLink(level, next, kind.get(e.source)!, kind.get(e.target)!)
                setEdges(kept)
                setNotice(`${gone === 1 ? '1 ligação removida' : `${gone} ligações removidas`}: ${reason}`)
              }}
              onClose={() => setCodeId(null)}
            />
          )}
          {!codeChallenge && !inspected && selectedLink && (
            <LinkPanel
              from={SPECS[nodes.find((n) => n.id === selectedLink.source)!.data.kind].label}
              to={SPECS[nodes.find((n) => n.id === selectedLink.target)!.data.kind].label}
              fromKind={nodes.find((n) => n.id === selectedLink.source)!.data.kind}
              toKind={nodes.find((n) => n.id === selectedLink.target)!.data.kind}
              policy={policyOf(selectedLink)}
              state={tick ? (tick.breakers[`${selectedLink.source}->${selectedLink.target}`] ?? 'closed') : undefined}
              editable={editable}
              onChange={(policy) => {
                clearRun()
                setEdges((es) => es.map((e) => (e.id === selectedLink.id ? { ...e, data: { ...policy } } : e)))
              }}
              onClose={() => setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))}
            />
          )}
          {!codeChallenge && inspected && (
            <Inspector
              kind={inspected}
              level={level}
              code={inspectedCode}
              fixes={fixes}
              onOpenCode={level.code ? setCodeId : undefined}
              onClose={closeInfo}
              focusOnOpen={listInfo !== null}
              escapeCloses={!menu}
              capacity={!listInfo && selected.length === 1 ? instanceCapacity(level, { id: selected[0].id, kind: selected[0].data.kind }) : undefined}
              links={
                !listInfo && selected.length === 1
                  ? {
                      targets: nodes
                        .filter((n) => canConnect(arch, selected[0].id, n.id, level))
                        .map((n) => ({ id: n.id, label: capitalize(nodeName(arch, n.id)) })),
                      editable,
                      onLink: (target) => {
                        const fits = edgesRef.current.length < MAX_EDGES
                        onConnect({ source: selected[0].id, target, sourceHandle: null, targetHandle: null })
                        if (fits) setNotice(`Ligado a ${nodeName(arch, target)}.`)
                      },
                    }
                  : undefined
              }
              balance={
                !listInfo && selected.length === 1 && SPECS[selected[0].data.kind].balances && (canSetBalance(level, fixes) || forcedBalance)
                  ? {
                      value: balanceOf({ id: selected[0].id, ...selected[0].data }, level, fixes),
                      forced: forcedBalance,
                      editable,
                      onChange: (b) => {
                        clearRun()
                        setNodes((ns) => ns.map((n) => (n.id === selected[0].id ? { ...n, data: { ...n.data, balance: b } } : n)))
                      },
                    }
                  : undefined
              }
              region={
                multiRegion && !listInfo && selected.length === 1 && !SPECS[selected[0].data.kind].global
                  ? {
                      value: regionOf({ id: selected[0].id, ...selected[0].data }),
                      choices: regionChoices,
                      editable,
                      onChange: (r) => {
                        clearRun()
                        setNodes((ns) =>
                          ns.map((n) => {
                            if (n.id !== selected[0].id) return n
                            const { region: _old, ...rest } = n.data
                            // Each region keeps its own band of the canvas, so the areas never overlap.
                            const y = n.position.y + (bandOf(r) - bandOf(regionOf({ id: n.id, ...n.data }))) * REGION_BAND
                            return { ...n, position: { ...n.position, y }, data: r === HOME_REGION ? rest : { ...rest, region: r } }
                          }),
                        )
                      },
                    }
                  : undefined
              }
            >
              {/* A piece picked on the canvas also shows how it did in the run on screen. */}
              {!listInfo && selected.length === 1 && run && shown > 0 && (
                <NodeRunStats ticks={run.ticks} nodeId={selected[0].id} kind={selected[0].data.kind} shown={shown} />
              )}
            </Inspector>
          )}
        </div>

        <footer className="console">
          <div className="console__actions">
            <button className="btn btn--primary run" onClick={start} disabled={running || computing || !!play.free?.blocked} aria-busy={running || computing}>
              {computing ? 'Simulando…' : running ? `Simulando ${shown}s de ${level.durationS}s` : run ? 'Rodar de novo' : 'Rodar simulação'}
            </button>
            <button className="btn btn--ghost" onClick={reset} disabled={running || computing}>
              {play.free ? 'Recomeçar desenho' : 'Recomeçar fase'}
            </button>
            {play.free?.blocked && <p className="hint" role="status">Para rodar, corrija o tráfego: {play.free.blocked}</p>}
          </div>

          <div className="meters">
            <Meter
              name="Tráfego"
              value={tick ? `${count(tick.rps)} req/s` : '—'}
              sub={tick && tick.botRps > 0 ? `mais ${count(tick.botRps)} req/s de um bot` : undefined}
            >
              {saturated && (
                <button className="meter__link" onClick={() => selectNode(saturated)}>
                  Mais carregado: {SPECS[nodes.find((n) => n.id === saturated)!.data.kind].label}{' '}
                  {Math.round(tick!.nodes[saturated].utilization * 100)}%
                </button>
              )}
            </Meter>
            <Meter
              name="Disponibilidade"
              value={tick ? pct(tick.rps ? tick.served / tick.rps : 1) : '—'}
              bad={!!tick && tick.rps > 0 && tick.served / tick.rps < g.minAvailability}
              sub={tick && lostByReason(tick.failed, '/s') && `Perdendo ${lostByReason(tick.failed, '/s')}`}
            >
              <Sparkline
                label="Disponibilidade por segundo"
                values={visible.map((t) => (t.rps ? t.served / t.rps : 1))}
                length={level.durationS}
                goal={g.minAvailability}
                min={0.8}
                max={1}
              />
            </Meter>
            <Meter
              name="Latência p99"
              value={tick ? ms(tick.p99Ms) : '—'}
              bad={!!tick && tick.p99Ms > g.maxP99Ms}
              sub={tick && `p50 ${ms(tick.p50Ms)}, p95 ${ms(tick.p95Ms)}`}
            >
              <Sparkline
                label="p99 por segundo"
                values={visible.map((t) => t.p99Ms)}
                length={level.durationS}
                goal={g.maxP99Ms}
                max={g.maxP99Ms * 2}
              />
            </Meter>
          </div>

          {finished && (
            <label className="scrub">
              <span>
                Rever o momento {shown - 1}s de {run.ticks.length}s
              </span>
              <input
                type="range"
                min={1}
                max={run.ticks.length}
                value={shown}
                onChange={(e) => {
                  // Scrubbing back must not resume playback from there.
                  setPlaying(false)
                  setShown(Number(e.target.value))
                }}
              />
            </label>
          )}

          {/* Always on the page, so screen readers announce the verdict when it arrives. */}
          <p className="sr-only" role="status" aria-live="polite">
            {finished ? verdictOf(free, run.summary.passed.all && !free) : ''}
          </p>

          {finished && (
            <Result
              summary={run.summary}
              ticks={run.ticks}
              arch={arch}
              level={level}
              free={!!play.free}
              share={play.share}
              sheet={play.linkable ? play.sheet : undefined}
              shareQuery={() => encodeShare(level.id, { nodes, edges, fixes })}
              xpGained={gain}
              onSeek={(t) => {
                setPlaying(false)
                setShown(t + 1)
              }}
              onConcept={openInfo}
            />
          )}

          <table className="sheet">
            <caption>
              <span className="sheet__n">
                {play.sheet}
              </span>
              <span className="sheet__title">{level.title}</span>
            </caption>
            <thead>
              <tr>
                <th scope="col">Meta</th>
                {!free && <th scope="col">Exigido</th>}
                <th scope="col">Medido</th>
              </tr>
            </thead>
            <tbody>
              <GoalRow
                name="Disponibilidade"
                required={free ? undefined : `≥ ${pct(g.minAvailability)}`}
                value={measured && pct(measured.availability)}
                ok={free ? undefined : measured?.passed.availability}
              />
              <GoalRow
                name="Latência p99"
                required={free ? undefined : `≤ ${ms(g.maxP99Ms)}`}
                value={measured && ms(measured.p99Ms)}
                ok={free ? undefined : measured?.passed.p99}
              />
              <GoalRow name="Custo mensal" required={free ? undefined : `≤ $${g.maxCost}`} value={`$${cost}`} ok={free ? undefined : cost <= g.maxCost} />
              {g.maxStaleReads !== undefined && (
                <GoalRow
                  name="Leituras desatualizadas"
                  required={`≤ ${pct(g.maxStaleReads)}`}
                  value={measured && pct(measured.staleReadRate)}
                  ok={measured?.passed.stale}
                />
              )}
              {g.maxDuplicates !== undefined && (
                <GoalRow
                  name="Transferências duplicadas"
                  required={`≤ ${pct(g.maxDuplicates)}`}
                  value={measured && pct(measured.duplicateRate)}
                  ok={measured?.passed.duplicates}
                />
              )}
              <tr>
                <th scope="row">Custo por 1 mi de req.</th>
                {!free && <td>—</td>}
                <td className="sheet__info">{perMillion === undefined ? '—' : money(perMillion)}</td>
              </tr>
            </tbody>
          </table>
        </footer>
      </main>
    </div>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
    </svg>
  )
}

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="trash__icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Meter({
  name,
  value,
  bad,
  sub,
  children,
}: {
  name: string
  value: string
  bad?: boolean
  /** A smaller line under the value. */
  sub?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={`meter${bad ? ' is-bad' : ''}`}>
      <span className="meter__name">{name}</span>
      <span className="meter__value">{value}</span>
      {sub && <span className="meter__sub">{sub}</span>}
      {children}
    </div>
  )
}

const BOTTLENECK_TEXT: Record<Bottleneck['reason'], (lost: number) => string> = {
  drops: (lost) => `Descartou ${count(lost)} requisições por excesso de carga.`,
  down: (lost) => `Ficou fora do ar sem outra peça para assumir, e ${count(lost)} requisições se perderam.`,
  limited: (lost) => `Recusou ${count(lost)} requisições de usuários com 429: o que está atrás dele não aguentava mais.`,
  latency: () => 'Nada se perdeu, mas foi onde as requisições mais esperaram.',
}

/** What the run's result says first: the verdict, also read out by screen readers. */
function verdictOf(free: boolean, won: boolean): string {
  if (free) return 'Rodada concluída. O selo da folha mostra o que foi medido.'
  return won ? 'Fase concluída. Todas as metas foram cumpridas.' : 'Ainda não. Veja no selo da folha qual meta falhou.'
}

function Result({
  summary,
  ticks,
  arch,
  level,
  free,
  share,
  sheet,
  shareQuery,
  xpGained,
  onSeek,
  onConcept,
}: {
  summary: RunSummary
  ticks: TickResult[]
  arch: Architecture
  level: Level
  /** Free mode: nothing to pass, so no verdict, stars or XP. */
  free: boolean
  /** Builds the text to copy for a passing run (the daily challenge). */
  share?: Play['share']
  /** Caption of the goals sheet when the phase can be shared as image and link. */
  sheet?: string
  /** Query string that reopens this phase with the drawing on screen. */
  shareQuery: () => string
  /** XP this run added to the saved result. */
  xpGained: number
  /** Shows the given second on the canvas. */
  onSeek: (t: number) => void
  onConcept: (kind: Kind, opener: HTMLElement) => void
}) {
  const events = useMemo(() => timeline(arch, ticks), [arch, ticks])
  const neck = useMemo(() => bottleneck(arch, ticks), [arch, ticks])
  const tips = useMemo(() => hints(summary, ticks, arch, level), [summary, ticks, arch, level])
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const won = summary.passed.all && !free
  const stars = won ? resultOf(summary, level).stars : 0
  const gaps = starGaps(summary, level)
  return (
    <section className={`result ${free ? 'result--free' : won ? 'result--pass' : 'result--fail'}`}>
      <h2>{verdictOf(free, won)}</h2>
      {won && (
        <div className="stars-line">
          <Stars count={stars} />
          {xpGained > 0 && <span className="stars-line__xp">+{xpGained} XP</span>}
          {share && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(share(stars, summary.cost, summary.p99Ms))
                  setCopied('ok')
                } catch {
                  setCopied('fail')
                }
              }}
            >
              {copied === 'ok' ? 'Copiado' : 'Copiar resultado'}
            </button>
          )}
          {sheet && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                const url = `${location.origin}${location.pathname}${shareQuery()}`
                const g = level.goals
                const image = await drawShareCard({
                  sheet,
                  title: level.title,
                  stars,
                  rows: [
                    { label: 'Disponibilidade', value: pct(summary.availability), goal: `meta: ${pct(g.minAvailability)}` },
                    { label: 'Latência p99', value: ms(summary.p99Ms), goal: `meta: até ${ms(g.maxP99Ms)}` },
                    { label: 'Custo por mês', value: money(summary.cost), goal: `meta: até ${money(g.maxCost)}` },
                  ],
                }).catch(() => null)
                if (!image) return setShareNote('Não deu para gerar a imagem.')
                const file = new File([image], `gargalo-${level.id}.png`, { type: 'image/png' })
                const text = `gargalo, ${sheet.toLowerCase()}: ${level.title} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
                if (navigator.canShare?.({ files: [file] })) {
                  try {
                    await navigator.share({ files: [file], text, url })
                    setShareNote(null)
                  } catch (e) {
                    // The player closing the share sheet is not an error.
                    if (!(e instanceof DOMException && e.name === 'AbortError')) setShareNote('Não deu para compartilhar.')
                  }
                  return
                }
                const a = document.createElement('a')
                a.href = URL.createObjectURL(file)
                a.download = file.name
                a.click()
                URL.revokeObjectURL(a.href)
                try {
                  await navigator.clipboard.writeText(url)
                  setShareNote('Imagem baixada e link copiado.')
                } catch {
                  setShareNote(`Imagem baixada. Seu navegador bloqueou a cópia; o link é ${url}`)
                }
              }}
            >
              Compartilhar
            </button>
          )}
          {shareNote && (
            <p className="hint" role="status">
              {shareNote}
            </p>
          )}
          {copied === 'fail' && <p className="hint">Não deu para copiar. Seu navegador bloqueou a área de transferência.</p>}
          {!gaps.thrifty.earned && <p className="hint">Gaste até {THRIFTY_PCT}% do orçamento ({money(gaps.thrifty.limit)}) para ganhar mais uma estrela.</p>}
          {!gaps.fast.earned && <p className="hint">Deixe o p99 até {FAST_PCT}% da meta ({ms(gaps.fast.limit)}) para ganhar mais uma estrela.</p>}
        </div>
      )}
      {neck && (
        <p className="debrief__neck">
          Gargalo principal: <strong>{SPECS[neck.kind].label}</strong>. {BOTTLENECK_TEXT[neck.reason](neck.lost)}{' '}
          <button className="meter__link" onClick={(e) => onConcept(neck.kind, e.currentTarget)}>
            Ver o conceito
          </button>
        </p>
      )}
      {lostByReason(summary.failed)?.includes(', ') && (
        <p className="hint">Requisições perdidas na rodada: {lostByReason(summary.failed)}.</p>
      )}
      {tips.map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
      {won &&
        ALTERNATIVES[level.id]?.map((text) => (
          <p key={text} className="hint">
            <strong>Outro caminho:</strong> {text}
          </p>
        ))}
      {events.length > 0 && (
        <details className="debrief">
          <summary>O que aconteceu na rodada ({events.length})</summary>
          <ol>
            {events.map((e) => (
              <li key={`${e.t}-${e.text}`} className={`debrief__event is-${e.tone}`}>
                <button className="debrief__t" onClick={() => onSeek(e.t)} aria-label={`Rever o momento ${e.t}s`}>
                  {e.t}s
                </button>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
