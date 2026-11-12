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
import type { Connection, Edge, IsValidConnection, OnBeforeDelete, OnNodeDrag } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { BrandMark } from './BrandMark'
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
import { KindIcon } from './KindIcon'
import { LEVELS } from './levels'
import { NodeCard } from './NodeCard'
import type { ComponentNode } from './NodeCard'
import { RemovableEdge } from './RemovableEdge'
import { Sparkline } from './Sparkline'
import { runLevel } from './sim/engine'
import type { RunSummary, TickResult } from './sim/engine'
import { SPECS, canConnect, totalCost } from './sim/model'
import type { Architecture, Kind, Level } from './sim/model'

const nodeTypes = { component: NodeCard }
const edgeTypes = { removable: RemovableEdge }
const PALETTE: Kind[] = ['cdn', 'lb', 'server', 'cache', 'db']
const COLUMN: Record<Kind, number> = { client: 0, cdn: 200, lb: 400, server: 600, cache: 820, db: 1020 }
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
const PASSED_KEY = 'gargalo:passed'

interface Design {
  nodes: ComponentNode[]
  edges: Edge[]
}

function freshDesign(): Design {
  return {
    nodes: [{ id: 'client', type: 'component', position: { x: 0, y: 120 }, data: { kind: 'client' }, deletable: false }],
    edges: [],
  }
}

function loadDesign(level: Level): Design {
  try {
    const raw = localStorage.getItem(designKey(level))
    if (raw) return JSON.parse(raw) as Design
  } catch {
    // Storage unavailable or corrupt: start from scratch.
  }
  return freshDesign()
}

function loadPassed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PASSED_KEY) ?? '[]') as string[]
  } catch {
    return []
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
  if (!summary.passed.cost)
    out.push('Acima do orçamento. Procure o componente que resolve o gargalo gastando menos.')
  return out
}

export default function App() {
  const [levelIdx, setLevelIdx] = useState(0)
  const [passed, setPassed] = useState<string[]>(loadPassed)
  const level = LEVELS[levelIdx]

  const markPassed = useCallback((id: string) => {
    setPassed((prev) => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      save(PASSED_KEY, next)
      return next
    })
  }, [])

  return (
    <ReactFlowProvider key={level.id}>
      <Board
        level={level}
        number={levelIdx + 1}
        onPassed={markPassed}
      nav={
        <nav className="levels" aria-label="Fases">
          {LEVELS.map((l, i) => (
            <button
              key={l.id}
              className={i === levelIdx ? 'is-current' : ''}
              aria-current={i === levelIdx ? 'step' : undefined}
              onClick={() => setLevelIdx(i)}
            >
              <span className="levels__n">{i + 1}</span>
              <span className="levels__title">{l.title}</span>
              {passed.includes(l.id) && <span className="tick" aria-label="concluída">✓</span>}
            </button>
          ))}
        </nav>
      }
      />
    </ReactFlowProvider>
  )
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One level's editor and simulation. Remounted per level so each starts from its saved design. */
function Board({
  level,
  number,
  nav,
  onPassed,
}: {
  level: Level
  number: number
  nav: ReactNode
  onPassed: (id: string) => void
}) {
  const { fitView } = useReactFlow()
  /** Id of a just-added node to bring into view once React Flow has measured it. */
  const pendingFit = useRef<string | null>(null)
  const [initial] = useState(() => loadDesign(level))
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
      { id, type: 'component', position: { x: COLUMN[kind], y: 20 + sameKind * 100 }, data: { kind } },
    ])
    pendingFit.current = id
  }

  const reset = () => {
    const fresh = freshDesign()
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
            {PALETTE.map((kind) => (
              <li key={kind}>
                <button className="part" onClick={() => addComponent(kind)} disabled={!editable}>
                  <KindIcon kind={kind} size={22} />
                  <span className="part__name">{SPECS[kind].label}</span>
                  <span className="part__spec">
                    {SPECS[kind].capacity.toLocaleString('pt-BR')} req/s, ${SPECS[kind].cost}/mês
                  </span>
                  <span className="part__desc">{SPECS[kind].description}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="help">
            Clique numa peça para pôr no desenho. Arraste da bolinha direita de um componente até outro para ligar.
            Para remover, arraste a peça até a lixeira, use o × da peça ou ligação selecionada, ou o menu do clique
            direito (toque longo no celular). Ctrl+Z desfaz.
          </p>
        </section>
      </aside>

      <main className="stage">
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
            <Meter name="Tráfego" value={tick ? `${Math.round(tick.rps).toLocaleString('pt-BR')} req/s` : '—'} />
            <Meter
              name="Disponibilidade"
              value={tick ? pct(tick.rps ? tick.served / tick.rps : 1) : '—'}
              bad={!!tick && tick.rps > 0 && tick.served / tick.rps < g.minAvailability}
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
            <Meter name="p99" value={tick ? ms(tick.p99Ms) : '—'} bad={!!tick && tick.p99Ms > g.maxP99Ms}>
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
                Rever o segundo {shown} de {run.ticks.length}
              </span>
              <input
                type="range"
                min={1}
                max={run.ticks.length}
                value={shown}
                onChange={(e) => setShown(Number(e.target.value))}
              />
            </label>
          )}

          {finished && <Result summary={run.summary} ticks={run.ticks} />}

          <table className="sheet">
            <caption>
              <span className="sheet__n">
                Folha {number}/{LEVELS.length}
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
            </tbody>
          </table>
        </footer>
      </main>
    </div>
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

function Meter({ name, value, bad, children }: { name: string; value: string; bad?: boolean; children?: ReactNode }) {
  return (
    <div className={`meter${bad ? ' is-bad' : ''}`}>
      <span className="meter__name">{name}</span>
      <span className="meter__value">{value}</span>
      {children}
    </div>
  )
}

function Result({ summary, ticks }: { summary: RunSummary; ticks: TickResult[] }) {
  return (
    <section className={`result ${summary.passed.all ? 'result--pass' : 'result--fail'}`} aria-live="polite">
      <h2>
        {summary.passed.all
          ? 'Fase concluída. As três metas foram cumpridas.'
          : 'Ainda não. Veja no selo da folha qual meta falhou.'}
      </h2>
      {hints(summary, ticks).map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
    </section>
  )
}
