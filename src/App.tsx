import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type { Connection, Edge, IsValidConnection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { LEVELS } from './levels'
import { NodeCard } from './NodeCard'
import type { ComponentNode } from './NodeCard'
import { Sparkline } from './Sparkline'
import { runLevel } from './sim/engine'
import type { RunSummary, TickResult } from './sim/engine'
import { SPECS, canConnect, totalCost } from './sim/model'
import type { Architecture, Kind, Level } from './sim/model'

const nodeTypes = { component: NodeCard }
const PALETTE: Kind[] = ['cdn', 'lb', 'server', 'cache', 'db']
const COLUMN: Record<Kind, number> = { client: 0, cdn: 200, lb: 400, server: 600, cache: 820, db: 1020 }
const TICK_MS = 120

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
    <Board
      key={level.id}
      level={level}
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
              {l.title}
              {passed.includes(l.id) && <span className="tick" aria-label="concluída">✓</span>}
            </button>
          ))}
        </nav>
      }
    />
  )
}

/** One level's editor and simulation. Remounted per level so each starts from its saved design. */
function Board({ level, nav, onPassed }: { level: Level; nav: ReactNode; onPassed: (id: string) => void }) {
  const [initial] = useState(() => loadDesign(level))
  const [nodes, setNodes, onNodesChange] = useNodesState<ComponentNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges)
  const [run, setRun] = useState<{ ticks: TickResult[]; summary: RunSummary } | null>(null)
  /** How many simulated seconds are on screen; scrubbable once the run ends. */
  const [shown, setShown] = useState(0)
  const [running, setRunning] = useState(false)

  const finished = run !== null && !running
  const tick = run && shown > 0 ? run.ticks[shown - 1] : undefined
  const arch = useMemo(() => toArchitecture(nodes, edges), [nodes, edges])
  const cost = totalCost(arch)

  useEffect(() => save(designKey(level), { nodes, edges }), [level, nodes, edges])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setShown((s) => s + 1), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (running && run && shown >= run.ticks.length) setRunning(false)
  }, [running, run, shown])

  useEffect(() => {
    if (finished && run.summary.passed.all) onPassed(level.id)
  }, [finished, run, onPassed, level.id])

  const editable = !running
  const clearRun = useCallback(() => {
    setRun(null)
    setShown(0)
    setRunning(false)
  }, [])

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
  }

  const reset = () => {
    const fresh = freshDesign()
    setNodes(fresh.nodes)
    setEdges(fresh.edges)
    clearRun()
  }

  const start = () => {
    setRun(runLevel(arch, level, Date.now() & 0xffff))
    setShown(0)
    setRunning(true)
  }

  const displayNodes = useMemo(
    () => (tick ? nodes.map((n) => ({ ...n, data: { ...n.data, stats: tick.nodes[n.id] } })) : nodes),
    [nodes, tick],
  )
  const displayEdges = useMemo(() => {
    if (!tick) return edges
    const peak = Math.max(1, ...Object.values(tick.edges))
    return edges.map((e) => {
      const rps = tick.edges[`${e.source}->${e.target}`] ?? 0
      return {
        ...e,
        animated: rps > 0,
        label: rps > 0 ? `${Math.round(rps)}/s` : undefined,
        style: { strokeWidth: 1.5 + 6 * (rps / peak), opacity: rps > 0 ? 1 : 0.35 },
      }
    })
  }, [edges, tick])

  const visible = run ? run.ticks.slice(0, shown) : []
  const g = level.goals

  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <h1>gargalo</h1>
          <p>Monte a arquitetura. O tráfego vem depois.</p>
        </header>

        {nav}

        <section className="brief">
          <p>{level.briefing}</p>
          <ul className="goals">
            <li>Disponibilidade de pelo menos {pct(g.minAvailability)}</li>
            <li>p99 de até {ms(g.maxP99Ms)}</li>
            <li className={cost > g.maxCost ? 'over' : ''}>
              Custo até ${g.maxCost}/mês <strong>(atual: ${cost})</strong>
            </li>
          </ul>
        </section>

        <section className="palette">
          <h2>Adicionar componente</h2>
          {PALETTE.map((kind) => (
            <button key={kind} onClick={() => addComponent(kind)} disabled={!editable}>
              <span className="palette__name">{SPECS[kind].label}</span>
              <span className="palette__meta">
                {SPECS[kind].capacity.toLocaleString('pt-BR')} req/s, ${SPECS[kind].cost}/mês
              </span>
              <span className="palette__desc">{SPECS[kind].description}</span>
            </button>
          ))}
          <p className="help">
            Arraste da bolinha direita de um componente até outro para conectar. Selecione e aperte Delete para remover.
          </p>
        </section>
      </aside>

      <main className="stage">
        <div className="canvas">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={(changes) => {
              if (editable) onEdgesChange(changes)
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodesConnectable={editable}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            onNodesDelete={clearRun}
            onEdgesDelete={clearRun}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          >
            <Background variant={BackgroundVariant.Lines} gap={24} color="var(--grid)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <footer className="console">
          <div className="console__actions">
            <button className="run" onClick={start} disabled={running}>
              {running ? `Simulando… ${shown}s de ${level.durationS}s` : run ? 'Rodar de novo' : 'Rodar simulação'}
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

          {finished && <Result summary={run.summary} level={level} ticks={run.ticks} />}
        </footer>
      </main>
    </div>
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

function Result({ summary, level, ticks }: { summary: RunSummary; level: Level; ticks: TickResult[] }) {
  const g = level.goals
  const rows: [string, string, boolean][] = [
    ['Disponibilidade', `${pct(summary.availability)} (meta ${pct(g.minAvailability)})`, summary.passed.availability],
    ['p99 da rodada', `${ms(summary.p99Ms)} (meta ${ms(g.maxP99Ms)})`, summary.passed.p99],
    ['Custo', `$${summary.cost}/mês (meta $${g.maxCost})`, summary.passed.cost],
  ]
  return (
    <section className={`result ${summary.passed.all ? 'result--pass' : 'result--fail'}`} aria-live="polite">
      <h2>{summary.passed.all ? 'Fase concluída' : 'Ainda não'}</h2>
      <ul>
        {rows.map(([name, value, ok]) => (
          <li key={name} className={ok ? 'ok' : 'fail'}>
            <span aria-hidden>{ok ? '✓' : '✗'}</span> {name}: {value}
          </li>
        ))}
      </ul>
      {hints(summary, ticks).map((h) => (
        <p key={h} className="hint">
          {h}
        </p>
      ))}
    </section>
  )
}
