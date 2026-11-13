import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
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
import type { Connection, Edge, IsValidConnection, OnBeforeDelete, OnNodeDrag, OnSelectionChangeFunc } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { BrandMark } from './BrandMark'
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
import type { Editor } from './editorContext'
import { Inspector } from './Inspector'
import { ALTERNATIVES } from './alternatives'
import { KindIcon } from './KindIcon'
import { CareerMap } from './CareerMap'
import { COMPANIES, CURRENT_KEY, PASSED_KEY, findStage, levelStatus, loadProgress, pieceUnlock, startArchitecture } from './career'
import type { Progress, Stage } from './career'
import { NodeCard } from './NodeCard'
import { NodeRunStats } from './NodeRunStats'
import type { ComponentNode } from './NodeCard'
import { RemovableEdge } from './RemovableEdge'
import { Sparkline } from './Sparkline'
import { runLevel } from './sim/engine'
import type { FailureReason, RunSummary, TickResult } from './sim/engine'
import { bottleneck, timeline } from './sim/debrief'
import type { Bottleneck } from './sim/debrief'
import { costPerMillion, mostSaturated } from './sim/metrics'
import { SPECS, canConnect, totalCost } from './sim/model'
import type { Architecture, Kind, Level } from './sim/model'

const nodeTypes = { component: NodeCard }
const edgeTypes = { removable: RemovableEdge }
const PALETTE: Kind[] = ['cdn', 'lb', 'server', 'cache', 'db', 'replica', 'queue', 'worker']
const COLUMN: Record<Kind, number> = { client: 0, cdn: 200, lb: 400, server: 600, cache: 820, db: 1020, queue: 820, worker: 1020, replica: 1240 }
/** Pieces that share a column with another start lower, so they don't land on top of it. */
const FIRST_ROW: Partial<Record<Kind, number>> = { queue: 320, worker: 320 }
const TICK_MS = 120
const TOAST_MS = 6000
const LONG_PRESS_MS = 550

type BoardRemoval = Removal<ComponentNode, Edge>

interface MenuState {
  x: number
  y: number
  target: { node: ComponentNode } | { edge: Edge }
  /** Where focus goes back to when the menu closes. */
  opener: HTMLElement | null
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

const designKey = (level: Level) => `gargalo:design:${level.id}`

interface Design {
  nodes: ComponentNode[]
  edges: Edge[]
}

/** The level's starting architecture laid out in columns, pieces of the same kind stacked. */
function freshDesign(stage: Stage): Design {
  const arch = startArchitecture(stage)
  const nodes = arch.nodes.map((n): ComponentNode => {
    const same = arch.nodes.filter((m) => m.kind === n.kind)
    const y = 120 + (same.indexOf(n) - (same.length - 1) / 2) * 110
    return {
      id: n.id,
      type: 'component',
      position: { x: COLUMN[n.kind], y },
      data: { kind: n.kind },
      ...(n.kind === 'client' ? { deletable: false } : {}),
    }
  })
  return { nodes, edges: arch.edges.map((e) => ({ id: `${e.source}->${e.target}`, ...e })) }
}

function loadDesign(stage: Stage): Design {
  try {
    const raw = localStorage.getItem(designKey(stage.level))
    if (raw) return JSON.parse(raw) as Design
  } catch {
    // Storage unavailable or corrupt: start from scratch.
  }
  return freshDesign(stage)
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not being able to save is fine; everything still works this session.
  }
}

function toArchitecture(nodes: ComponentNode[], edges: Edge[]): Architecture {
  return {
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  }
}

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.9995 ? 0 : 1)}%`
const ms = (n: number) => `${Math.round(n)} ms`
const money = (n: number) => `$${n.toFixed(2).replace('.', ',')}`
const count = (n: number) => Math.round(n).toLocaleString('pt-BR')

const REASONS: [FailureReason, string][] = [
  ['overload', 'sobrecarga'],
  ['down', 'fora do ar'],
  ['noRoute', 'sem rota'],
]

/** "120 por sobrecarga, 30 sem rota", or undefined when nothing was lost. */
function lostByReason(failed: Record<FailureReason, number>, unit = ''): string | undefined {
  const parts = REASONS.filter(([r]) => failed[r] >= 0.5).map(([r, name]) => `${count(failed[r])}${unit} por ${name}`)
  return parts.length ? parts.join(', ') : undefined
}

function hints(summary: RunSummary, ticks: TickResult[]): string[] {
  const total = ticks.reduce((s, t) => s + t.rps, 0) || 1
  const out: string[] = []
  if (summary.failed.noRoute / total > 0.001)
    out.push('Algumas requisições não tinham para onde ir. Confira se os usuários chegam a um servidor e se cada servidor chega ao banco.')
  if (summary.failed.overload / total > 0.001)
    out.push('Algum componente passou da capacidade e começou a descartar requisições. Arraste o controle acima até o momento em que algo fica vermelho.')
  if (summary.failed.down / total > 0.001)
    out.push('Requisições foram mandadas para um servidor fora do ar. Um load balancer para de enviar tráfego a servidores que caem.')
  if (!summary.passed.p99 && out.length === 0)
    out.push('Nada caiu, mas está lento. Componentes perto do limite formam fila; folga de capacidade derruba o p99.')
  if (summary.staleReadRate >= 0.01)
    out.push(`${pct(summary.staleReadRate)} das leituras devolveram dado velho. Réplicas atrasam mais quando recebem muitas escritas ou estão cheias de leituras; uma réplica sem ligação do banco nunca é atualizada.`)
  if (summary.backlogAtEnd >= 1)
    out.push(`A rodada terminou com ${count(summary.backlogAtEnd)} mensagens esperando na fila. Se o backlog não esvazia, o problema só foi adiado: ponha mais workers.`)
  if (summary.async.lost >= 1)
    out.push(`${count(summary.async.lost)} escritas foram aceitas pela fila e se perderam depois. Confira se os workers chegam ao banco e se ele aguenta o ritmo deles.`)
  if (!summary.passed.cost)
    out.push('Acima do orçamento. Procure o componente que resolve o gargalo gastando menos.')
  return out
}

export default function App() {
  const [progress, setProgress] = useState<Progress>(() => loadProgress(readStorage))
  const [view, setView] = useState<'board' | 'map'>('board')
  const { passed, current } = progress
  const stage = findStage(current)!
  const { company } = stage

  useEffect(() => save(CURRENT_KEY, current), [current])

  const markPassed = useCallback((id: string) => {
    setProgress((prev) => {
      if (prev.passed.includes(id)) return prev
      const next = [...prev.passed, id]
      save(PASSED_KEY, next)
      return { ...prev, passed: next }
    })
  }, [])

  const play = (levelId: string) => {
    setProgress((prev) => ({ ...prev, current: levelId }))
    setView('board')
  }

  if (view === 'map')
    return <CareerMap passed={passed} current={current} onPlay={play} onClose={() => setView('board')} />

  return (
    <ReactFlowProvider key={stage.level.id}>
      <Board
        stage={stage}
        onPassed={markPassed}
        nav={
          <nav className="levels" aria-labelledby="levels-company">
            <div className="levels__head">
              <h2 id="levels-company">
                <span className="levels__where">Empresa {stage.companyIndex + 1}</span> {company.name}
              </h2>
              <button type="button" className="levels__map" onClick={() => setView('map')}>
                Mapa da carreira
              </button>
            </div>
            {[...company.levels, company.boss].map((l, i) => {
              const status = levelStatus(l.id, passed)
              const isBoss = l === company.boss
              const current = l.id === stage.level.id
              return (
                <button
                  key={l.id}
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
                  {status === 'done' && <span className="tick" aria-label="concluída">✓</span>}
                  {status === 'locked' && <LockIcon label="bloqueada" />}
                </button>
              )
            })}
          </nav>
        }
      />
    </ReactFlowProvider>
  )
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One level's editor and simulation. Remounted per level so each starts from its saved design. */
function Board({ stage, nav, onPassed }: { stage: Stage; nav: ReactNode; onPassed: (id: string) => void }) {
  const { level } = stage
  const { fitView } = useReactFlow()
  /** Id of a just-added node to bring into view once React Flow has measured it. */
  const pendingFit = useRef<string | null>(null)
  const [initial] = useState(() => loadDesign(stage))
  const [nodes, setNodes, onNodesChange] = useNodesState<ComponentNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges)
  const [run, setRun] = useState<{ ticks: TickResult[]; summary: RunSummary } | null>(null)
  /** How many simulated seconds are on screen; scrubbable once the run ends. */
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(false)
  const running = playing && run !== null && shown < run.ticks.length

  const finished = run !== null && !running
  const tick = run && shown > 0 ? run.ticks[shown - 1] : undefined
  const arch = useMemo(() => toArchitecture(nodes, edges), [nodes, edges])
  const cost = totalCost(arch)

  useEffect(() => save(designKey(level), { nodes, edges }), [level, nodes, edges])

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

  useEffect(() => {
    if (finished && run.summary.passed.all) onPassed(level.id)
  }, [finished, run, onPassed, level.id])

  const editable = !running
  const clearRun = useCallback(() => {
    setRun(null)
    setShown(0)
    setPlaying(false)
  }, [])

  // Removal, undo and the context menu. Every removal goes through `commitRemoval`.
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])
  const [undoStack, setUndoStack] = useState<BoardRemoval[]>([])
  const [toast, setToast] = useState<BoardRemoval | null>(null)
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
    const back = undoRemoval(nodesRef.current, edgesRef.current, last)
    setNodes(back.nodes)
    setEdges(back.edges)
    setUndoStack((st) => st.slice(0, -1))
    setToast(null)
    clearRun()
  }, [editable, undoStack, setNodes, setEdges, clearRun])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (isTyping(e.target)) return
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

  const openMenu = (x: number, y: number, target: MenuState['target'], opener: Element | null) => {
    if (!editable) return
    if ('node' in target && target.node.deletable === false) return
    // Keyboard-opened menus (Shift+F10) report 0,0: open at the element instead.
    if (x === 0 && y === 0 && opener) {
      const r = opener.getBoundingClientRect()
      x = r.left + r.width / 2
      y = r.top + r.height / 2
    }
    setMenu({ x, y, target, opener: opener instanceof HTMLElement ? opener : null })
  }

  const closeMenu = useCallback(() => {
    setMenu((m) => {
      if (m?.opener?.isConnected) m.opener.focus()
      return null
    })
  }, [])

  const duplicate = (node: ComponentNode) => {
    clearRun()
    const id = `${node.data.kind}-${Date.now().toString(36)}`
    setNodes((ns) => [
      ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
      {
        id,
        type: 'component',
        position: { x: node.position.x + 32, y: node.position.y + 32 },
        data: { kind: node.data.kind },
        selected: true,
      },
    ])
  }

  const menuItems = (target: MenuState['target']): MenuItem[] =>
    'node' in target
      ? [
          { label: 'Duplicar', onSelect: () => duplicate(target.node) },
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
    (c) => canConnect(arch, c.source, c.target),
    [arch],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      clearRun()
      setEdges((es) => addEdge(c, es))
    },
    [setEdges, clearRun],
  )

  const addComponent = (kind: Kind) => {
    clearRun()
    const sameKind = nodes.filter((n) => n.data.kind === kind).length
    const id = `${kind}-${Date.now().toString(36)}`
    setNodes((ns) => [
      ...ns,
      { id, type: 'component', position: { x: COLUMN[kind], y: (FIRST_ROW[kind] ?? 20) + sameKind * 100 }, data: { kind } },
    ])
    pendingFit.current = id
  }

  // Concepts panel: the single selected piece, or a kind opened from the parts list.
  const [listInfo, setListInfo] = useState<{ kind: Kind; opener: HTMLElement } | null>(null)
  const selected = nodes.filter((n) => n.selected)
  const inspected = listInfo?.kind ?? (selected.length === 1 ? selected[0].data.kind : null)

  const openInfo = (kind: Kind, opener: HTMLElement) => {
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
    if (picked.length > 0) setListInfo(null)
  }, [])

  const reset = () => {
    const fresh = freshDesign(stage)
    setNodes(fresh.nodes)
    setEdges(fresh.edges)
    setUndoStack([])
    setToast(null)
    clearRun()
  }

  const start = () => {
    setMenu(null)
    setRun(runLevel(arch, level, Date.now() & 0xffff))
    setShown(0)
    setPlaying(true)
  }

  const displayNodes = useMemo(
    () => (tick ? nodes.map((n) => ({ ...n, data: { ...n.data, stats: tick.nodes[n.id] } })) : nodes),
    [nodes, tick],
  )
  const displayEdges = useMemo(() => {
    const labelOf = (id: string) => {
      const n = nodes.find((x) => x.id === id)
      return n ? SPECS[n.data.kind].label : id
    }
    const base = edges.map((e) => ({
      ...e,
      type: 'removable',
      ariaLabel: `Ligação de ${labelOf(e.source)} para ${labelOf(e.target)}`,
    }))
    if (!tick) return base
    const peak = Math.max(1, ...Object.values(tick.edges))
    return base.map((e) => {
      const rps = tick.edges[`${e.source}->${e.target}`] ?? 0
      return {
        ...e,
        animated: rps > 0,
        label: rps > 0 ? `${Math.round(rps)}/s` : undefined,
        style: { strokeWidth: 1.5 + 6 * (rps / peak), opacity: rps > 0 ? 1 : 0.35 },
      }
    })
  }, [nodes, edges, tick])

  const visible = run ? run.ticks.slice(0, shown) : []
  const g = level.goals
  const measured = finished ? run.summary : undefined
  const saturated = tick && mostSaturated(tick)
  const perMillion = costPerMillion(cost, level)
  const selectNode = (id: string) => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })))

  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <h1>
            <BrandMark size={52} />
            gargalo
          </h1>
          <p>Monte a arquitetura. O tráfego vem depois.</p>
        </header>

        {nav}

        <p className="brief">{level.briefing}</p>

        <section className="parts" aria-labelledby="parts-title">
          <h2 id="parts-title">Peças</h2>
          <ul>
            {PALETTE.map((kind) => {
              const unlock = pieceUnlock(kind, stage.companyIndex)
              return (
              <li key={kind} className={unlock.unlocked ? undefined : 'is-locked'}>
                <button className="part" onClick={() => addComponent(kind)} disabled={!editable || !unlock.unlocked}>
                  <KindIcon kind={kind} size={22} />
                  <span className="part__name">
                    {SPECS[kind].label}
                    {!unlock.unlocked && <LockIcon />}
                  </span>
                  {unlock.unlocked ? (
                    <span className="part__spec">
                      {SPECS[kind].capacity.toLocaleString('pt-BR')} req/s, ${SPECS[kind].cost}/mês
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
            Clique numa peça para pôr no desenho, ou no ⓘ para ler sobre ela. Arraste da bolinha direita de um componente até outro para ligar.
            Para remover, arraste a peça até a lixeira, use o × da peça ou ligação selecionada, ou o menu do clique
            direito (toque longo no celular). Ctrl+Z desfaz.
          </p>
        </section>
      </aside>

      <main className="stage">
        <div className="workspace">
          <div
            className="canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
          >
            <EditorContext.Provider value={editor}>
              <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={(changes) => {
                  if (editable) onEdgesChange(changes)
                }}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                nodesConnectable={editable}
                nodesDraggable={editable}
                deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
                onBeforeDelete={onBeforeDelete}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeContextMenu={(e, node) => {
                  e.preventDefault()
                  openMenu(e.clientX, e.clientY, { node }, e.currentTarget as Element)
                }}
                onEdgeContextMenu={(e, edge) => {
                  e.preventDefault()
                  openMenu(e.clientX, e.clientY, { edge }, e.currentTarget as Element)
                }}
                onMoveStart={() => setMenu(null)}
                onSelectionChange={onSelectionChange}
                onPaneClick={() => setListInfo(null)}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                minZoom={0.2}
              >
                <Background variant={BackgroundVariant.Lines} gap={24} color="var(--grid)" />
                <Controls showInteractive={false} position="top-left" />
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
              {toast && (
                <div className="toast">
                  <span>{removalMessage(toast)}</span>
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

          {inspected && (
            <Inspector
              kind={inspected}
              onClose={closeInfo}
              focusOnOpen={listInfo !== null}
              escapeCloses={!menu}
            >
              {/* A piece picked on the canvas also shows how it did in the run on screen. */}
              {!listInfo && selected.length === 1 && run && shown > 0 && (
                <NodeRunStats ticks={run.ticks} nodeId={selected[0].id} shown={shown} />
              )}
            </Inspector>
          )}
        </div>

        <footer className="console">
          <div className="console__actions">
            <button className="run" onClick={start} disabled={running}>
              {running ? `Simulando ${shown}s de ${level.durationS}s` : run ? 'Rodar de novo' : 'Rodar simulação'}
            </button>
            <button className="ghost" onClick={reset} disabled={running}>
              Recomeçar fase
            </button>
          </div>

          <div className="meters">
            <Meter name="Tráfego" value={tick ? `${count(tick.rps)} req/s` : '—'}>
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

          {finished && (
            <Result
              summary={run.summary}
              ticks={run.ticks}
              arch={arch}
              levelId={level.id}
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
                Folha {stage.number}/{stage.company.levels.length + 1}
              </span>
              <span className="sheet__title">{level.title}</span>
            </caption>
            <thead>
              <tr>
                <th scope="col">Meta</th>
                <th scope="col">Exigido</th>
                <th scope="col">Medido</th>
              </tr>
            </thead>
            <tbody>
              <GoalRow
                name="Disponibilidade"
                required={`≥ ${pct(g.minAvailability)}`}
                value={measured && pct(measured.availability)}
                ok={measured?.passed.availability}
              />
              <GoalRow
                name="Latência p99"
                required={`≤ ${ms(g.maxP99Ms)}`}
                value={measured && ms(measured.p99Ms)}
                ok={measured?.passed.p99}
              />
              <GoalRow name="Custo mensal" required={`≤ $${g.maxCost}`} value={`$${cost}`} ok={cost <= g.maxCost} />
              {g.maxStaleReads !== undefined && (
                <GoalRow
                  name="Leituras desatualizadas"
                  required={`≤ ${pct(g.maxStaleReads)}`}
                  value={measured && pct(measured.staleReadRate)}
                  ok={measured?.passed.stale}
                />
              )}
              <tr>
                <th scope="row">Custo por 1 mi de req.</th>
                <td>—</td>
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

function GoalRow({ name, required, value, ok }: { name: string; required: string; value?: string; ok?: boolean }) {
  const state = value === undefined ? '' : ok ? 'is-ok' : 'is-fail'
  return (
    <tr className={state}>
      <th scope="row">{name}</th>
      <td>{required}</td>
      <td>
        {value ?? '—'}
        {value !== undefined && <span className="sheet__mark">{ok ? ' ✓' : ' ✗'}</span>}
      </td>
    </tr>
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
  latency: () => 'Nada se perdeu, mas foi onde as requisições mais esperaram.',
}

function Result({
  summary,
  ticks,
  arch,
  levelId,
  onSeek,
  onConcept,
}: {
  summary: RunSummary
  ticks: TickResult[]
  arch: Architecture
  levelId: string
  /** Shows the given second on the canvas. */
  onSeek: (t: number) => void
  onConcept: (kind: Kind, opener: HTMLElement) => void
}) {
  const events = timeline(arch, ticks)
  const neck = bottleneck(arch, ticks)
  return (
    <section className={`result ${summary.passed.all ? 'result--pass' : 'result--fail'}`} aria-live="polite">
      <h2>
        {summary.passed.all
          ? 'Fase concluída. As três metas foram cumpridas.'
          : 'Ainda não. Veja no selo da folha qual meta falhou.'}
      </h2>
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
      {hints(summary, ticks).map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
      {summary.passed.all &&
        ALTERNATIVES[levelId]?.map((text) => (
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
