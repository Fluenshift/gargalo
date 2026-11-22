import { syntaxHighlighting } from '@codemirror/language'
import { javascript, typescriptLanguage } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import { GoalRow } from './GoalRow'
import { Stars } from './Stars'
import { TopBar } from './TopBar'
import type { RequestMetrics, TestResult } from './oficina/exercise'
import { EXERCISES, type OficinaExercise } from './oficina/exercises'
import { MIN_AVAILABILITY, OFICINA_ARCH, loadLevel, requestCost, oficinaStars } from './oficina/load'
import { allPassed, byCompany, clearCode, loadCode, loadSavedResults, resultId, saveCode, saveResult, unlockedHints } from './oficina/progress'
import { prewarm, runTests } from './oficina/runner'
import type { RunSummary } from './sim/engine'
import { runInBackground } from './sim/runner'

/** Token classes for the editor and the reference block alike; colours are the --code-* tokens in App.css (.tok-*). */
const highlight = tagHighlighter([
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tok-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'tok-comment' },
  { tag: [tags.typeName, tags.className], class: 'tok-type' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName))], class: 'tok-function' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], class: 'tok-punctuation' },
])

/** Read-only TypeScript, coloured like the editor. */
function Code({ code }: { code: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = []
    highlightCode(
      code,
      typescriptLanguage.parser.parse(code),
      highlight,
      (text, classes) => out.push(classes ? <span key={out.length} className={classes}>{text}</span> : text),
      () => out.push('\n'),
    )
    return out
  }, [code])
  return <pre className="code code--wrap">{parts}</pre>
}

const editorTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: 'var(--text-xs)' },
  '&.cm-focused': { outline: 'var(--focus-width) solid var(--focus)', outlineOffset: '2px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content, .cm-gutter': { minHeight: '240px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--ink-soft)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--sunk)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--line)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--line)', color: 'inherit' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--ink)', color: 'var(--on-ink)' },
})

function Editor({ exercise, onView }: { exercise: OficinaExercise; onView: (view: EditorView | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      doc: loadCode(exercise.id, exercise.starter),
      extensions: [
        basicSetup,
        // Tab indents; Esc then Tab (CodeMirror's own escape) leaves the editor.
        keymap.of([indentWithTab]),
        javascript({ typescript: true }),
        syntaxHighlighting(highlight),
        editorTheme,
        EditorView.contentAttributes.of({ 'aria-label': 'Código do handler', 'aria-describedby': 'oficina-keys' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setSaveFailed(!saveCode(exercise.id, u.state.doc.toString()))
        }),
      ],
    })
    onView(view)
    return () => {
      onView(null)
      view.destroy()
    }
  }, [exercise, onView])
  return (
    <>
      <div ref={host} className="oficina__editor" />
      <p id="oficina-keys" className="oficina__note">
        Tab indenta. Para sair do editor pelo teclado, aperte Esc e depois Tab.
        {saveFailed && ' O navegador não deixou salvar: o código vale só nesta visita.'}
      </p>
    </>
  )
}

const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))

/** Optional per-request figures the executor may add to a result; shown as they come. */
const METRIC_LABELS: Record<string, string> = { queries: 'consultas', rowsRead: 'linhas lidas', ms: 'ms', durationMs: 'ms' }
const KNOWN = new Set(['name', 'passed', 'message', 'expected', 'received', 'line'])
const metrics = (r: TestResult) =>
  Object.entries(r)
    .filter(([k, v]) => !KNOWN.has(k) && typeof v === 'number')
    .map(([k, v]) => `${v} ${METRIC_LABELS[k] ?? k}`)

interface Run {
  which: 'visible' | 'all'
  results: TestResult[]
  /** A submission that passed every test, run at the exercise's target load. */
  load?: { summary: RunSummary; cost: RequestMetrics; stars: number; xp: number }
}

/** Exercise company name to its career company's id (the line colour); the warm-up has none. */
const COMPANY_ID: Record<string, string> = { Startup: 'startup', 'E-commerce': 'ecommerce', Fintech: 'fintech' }

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.9995 ? 0 : 1).replace('.', ',')}%`
const decimal = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR')

/** The pill shows only the route ("GET /ola"); the rest of the title is for screen readers. */
const route = (title: string) => title.split(': ')[0]

export default function Oficina() {
  const heading = useRef<HTMLHeadingElement>(null)
  const view = useRef<EditorView | null>(null)
  const [current, setCurrent] = useState(EXERCISES[0])
  const [run, setRun] = useState<Run | null>(null)
  const [running, setRunning] = useState<'visible' | 'all' | null>(null)
  const [announce, setAnnounce] = useState('')
  // Per exercise: failed submissions this visit (one hint each) and whether it passed (saved with its result).
  const [failed, setFailed] = useState<Record<string, number>>({})
  const [passed, setPassed] = useState<Record<string, number>>(() => {
    const saved = loadSavedResults()
    return Object.fromEntries(EXERCISES.filter((e) => saved[resultId(e.id)]).map((e) => [e.id, saved[resultId(e.id)].stars]))
  })
  const [resetKey, setResetKey] = useState(0)
  const [warming, setWarming] = useState(true)
  useEffect(() => heading.current?.focus(), [])
  // A failed warm-up is reported by the first run, which tries again.
  useEffect(() => {
    prewarm().catch(() => {}).finally(() => setWarming(false))
  }, [])
  const onView = useCallback((v: EditorView | null) => {
    view.current = v
  }, [])

  const open = (exercise: OficinaExercise) => {
    setCurrent(exercise)
    setRun(null)
    setAnnounce('')
  }

  const start = async (which: 'visible' | 'all') => {
    if (!view.current || running) return
    setRunning(which)
    setAnnounce(which === 'all' ? 'Enviando: rodando todos os testes…' : 'Rodando os testes visíveis…')
    const exercise = current
    const results = await runTests(view.current.state.doc.toString(), exercise, which)
    const ok = allPassed(results)
    const count = `${results.filter((r) => r.passed).length} de ${results.length} testes passaram.`
    let load: Run['load']
    if (which === 'all' && ok) {
      const cost = requestCost(results)
      const { summary } = await runInBackground(OFICINA_ARCH, loadLevel(exercise, cost), 1)
      const stars = oficinaStars(true, summary, exercise.load, cost)
      const { xp } = saveResult(exercise.id, { stars, cost: summary.cost, p99Ms: summary.p99Ms, availability: summary.availability })
      load = { summary, cost, stars, xp }
    }
    setRunning(null)
    setRun({ which, results, load })
    if (which === 'all') {
      if (ok) setPassed((p) => ({ ...p, [exercise.id]: Math.max(p[exercise.id] ?? 0, load!.stars) }))
      else setFailed((f) => ({ ...f, [exercise.id]: (f[exercise.id] ?? 0) + 1 }))
    }
    const unlocked = which === 'all' && !ok && (failed[exercise.id] ?? 0) < exercise.hints.length
    setAnnounce(
      which === 'all' && ok
        ? `${count} ${load!.stars} de 3 estrelas. Enviado: a solução de referência está liberada.`
        : `${count}${unlocked ? ' Uma dica nova foi liberada.' : ''}`,
    )
  }

  const reset = () => {
    if (!confirm('Apagar o seu código deste exercício e voltar ao código inicial?')) return
    clearCode(current.id)
    setResetKey((k) => k + 1)
    setRun(null)
    setAnnounce('Código de volta ao início.')
  }

  const goToLine = (line: number) => {
    const v = view.current
    if (!v || line < 1 || line > v.state.doc.lines) return
    v.dispatch({ selection: { anchor: v.state.doc.line(line).from }, scrollIntoView: true })
    v.focus()
  }

  // Arrow keys move between the strip's buttons (they stay tabbable too).
  const arrows = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!step) return
    const pills = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.oficina__pill:not(:disabled)')]
    const next = pills[pills.indexOf(document.activeElement as HTMLButtonElement) + step]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  const hints = unlockedHints(current.hints, failed[current.id] ?? 0)

  return (
    <>
    <TopBar screen="oficina" />
    <div className="career free oficina">
      <header className="career__head">
        <h1 ref={heading} tabIndex={-1}>
          Oficina
        </h1>
        <p className="career__lede">
          Escreva o handler de verdade, em TypeScript, e rode os testes aqui no navegador. Rodar testes usa só os visíveis; Enviar roda também os
          escondidos. Cada envio que falha libera uma dica.
        </p>
      </header>

      <nav className="oficina__strip" aria-label="Exercícios" onKeyDown={arrows}>
        {byCompany(EXERCISES).map(([company, items]) => (
          <div key={company} className="oficina__group" role="group" aria-label={company} data-company={COMPANY_ID[company]}>
            <span className="oficina__co">{company}</span>
            {items.map((e) => (
              <button
                key={e.id}
                type="button"
                className="oficina__pill"
                aria-pressed={e.id === current.id}
                disabled={running !== null}
                onClick={() => open(e)}
              >
                {route(e.title)}
                <span className="sr-only">{e.title.slice(route(e.title).length)}</span>
                {passed[e.id] !== undefined && (
                  <span className="oficina__done">
                    {' '}
                    <Stars count={passed[e.id]} />
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="oficina__layout">
        <div className="oficina__left">
          <section className="oficina__work" aria-labelledby="oficina-title">
          <p className="phase__where">{current.company}</p>
          <h2 id="oficina-title" className="oficina__title">
            {current.title}
          </h2>
          <p className="oficina__statement">{current.statement}</p>

          <Editor key={`${current.id}:${resetKey}`} exercise={current} onView={onView} />

          <div className="oficina__actions">
            <button type="button" className="btn btn--ghost" onClick={() => start('visible')} disabled={running !== null} aria-busy={running === 'visible'}>
              Rodar testes
            </button>
            <button type="button" className="btn btn--primary" onClick={() => start('all')} disabled={running !== null} aria-busy={running === 'all'}>
              Enviar
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={reset} disabled={running !== null}>
              Voltar ao início
            </button>
          </div>

          <p className="oficina__status" role="status" aria-live="polite">
            {announce || (warming ? 'Carregando o Postgres do navegador…' : '')}
          </p>

          </section>
        </div>

        <div className="oficina__right">
          {run && (
            <section aria-labelledby="oficina-results">
              <h3 id="oficina-results">{run.which === 'all' ? 'Resultado do envio' : 'Testes visíveis'}</h3>
              {run.load && (
                <>
                  <div className="stars-line">
                    <Stars count={run.load.stars} />
                    {run.load.xp > 0 && <span className="stars-line__xp">+{run.load.xp} XP</span>}
                  </div>
                  <table className="sheet oficina__sheet">
                    <caption>
                      <span className="sheet__title">Na carga de {current.load.rps} req/s</span>
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
                        name="Latência p99"
                        required={`≤ ${current.load.p99Ms} ms`}
                        value={`${Math.round(run.load.summary.p99Ms)} ms`}
                        ok={run.load.summary.passed.p99}
                      />
                      <GoalRow
                        name="Disponibilidade"
                        required={`≥ ${pct(MIN_AVAILABILITY)}`}
                        value={pct(run.load.summary.availability)}
                        ok={run.load.summary.passed.availability}
                      />
                      <GoalRow
                        name="Consultas por requisição"
                        required={`≤ ${current.load.queriesPerRequest}`}
                        value={decimal(run.load.cost.queries)}
                        ok={run.load.cost.queries <= current.load.queriesPerRequest}
                      />
                    </tbody>
                  </table>
                </>
              )}
              <ol className="oficina__results">
                {run.results.map((r, i) => {
                  const extra = metrics(r)
                  const hidden = i >= current.visible.length
                  return (
                    <li key={i} className={r.passed ? 'is-passed' : 'is-failed'}>
                      <p className="oficina__test">
                        <span>{r.passed ? 'Passou' : 'Falhou'}</span> {r.name}
                        {hidden && <span className="oficina__hidden"> (escondido)</span>}
                      </p>
                      {r.message && (
                        <p>
                          {r.message}
                          {r.line !== undefined && (
                            <>
                              {' '}
                              <button type="button" className="levels__map" onClick={() => goToLine(r.line!)}>
                                Linha {r.line}
                              </button>
                            </>
                          )}
                        </p>
                      )}
                      {/* A hidden test says what failed, not the answer it wanted. */}
                      {'expected' in r && !hidden && (
                        <div className="oficina__diff">
                          <div>
                            <h4>Esperado</h4>
                            <pre className="code code--wrap">{show(r.expected)}</pre>
                          </div>
                          <div>
                            <h4>Recebido</h4>
                            <pre className="code code--wrap">{show(r.received)}</pre>
                          </div>
                        </div>
                      )}
                      {extra.length > 0 && <p className="oficina__metrics">{extra.join(' · ')}</p>}
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          {hints.length > 0 && (
            <section aria-labelledby="oficina-hints">
              <h3 id="oficina-hints">Dicas</h3>
              <ol className="oficina__hints">
                {hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            </section>
          )}

          {passed[current.id] !== undefined && (
            <section aria-labelledby="oficina-reference">
              <h3 id="oficina-reference">Solução de referência</h3>
              <p className="oficina__statement">{current.explanation}</p>
              <Code code={current.reference} />
            </section>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
