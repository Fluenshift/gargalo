import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import type { TestResult } from './oficina/exercise'
import { EXERCISES, type OficinaExercise } from './oficina/exercises'
import { allPassed, byCompany, clearCode, loadCode, saveCode, unlockedHints } from './oficina/progress'
import { runTests } from './oficina/runner'

/** Colour means load state only, so the code is told apart by weight, style and ink-soft, never by hue. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.controlKeyword], fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string), tags.number, tags.bool, tags.null], color: 'var(--ink-soft)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--ink-soft)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className], fontStyle: 'italic' },
])

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
}

export default function Oficina() {
  const heading = useRef<HTMLHeadingElement>(null)
  const view = useRef<EditorView | null>(null)
  const [current, setCurrent] = useState(EXERCISES[0])
  const [run, setRun] = useState<Run | null>(null)
  const [running, setRunning] = useState<'visible' | 'all' | null>(null)
  const [announce, setAnnounce] = useState('')
  // Per exercise, for this visit: failed submissions (one hint each) and whether it passed.
  const [failed, setFailed] = useState<Record<string, number>>({})
  const [passed, setPassed] = useState<Record<string, boolean>>({})
  const [resetKey, setResetKey] = useState(0)
  useEffect(() => heading.current?.focus(), [])
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
    setRunning(null)
    setRun({ which, results })
    if (which === 'all') {
      if (ok) setPassed((p) => ({ ...p, [exercise.id]: true }))
      else setFailed((f) => ({ ...f, [exercise.id]: (f[exercise.id] ?? 0) + 1 }))
    }
    const unlocked = which === 'all' && !ok && (failed[exercise.id] ?? 0) < exercise.hints.length
    setAnnounce(
      which === 'all' && ok
        ? `${count} Enviado: a solução de referência está liberada.`
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

  const hints = unlockedHints(current.hints, failed[current.id] ?? 0)

  return (
    <div className="career free oficina">
      <header className="career__head">
        <p className="career__brand">
          <BrandMark size={28} />
          gargalo
        </p>
        <h1 ref={heading} tabIndex={-1}>
          Oficina
        </h1>
        <p className="career__lede">
          Escreva o handler de verdade, em TypeScript, e rode os testes aqui no navegador. Rodar testes usa só os visíveis; Enviar roda também os
          escondidos. Cada envio que falha libera uma dica.
        </p>
        <div className="career__actions">
          <a className="btn btn--ghost" href="/">
            Voltar ao jogo
          </a>
        </div>
        <ThemeToggle />
      </header>

      <div className="oficina__layout">
        <nav className="oficina__list" aria-label="Exercícios">
          {byCompany(EXERCISES).map(([company, items]) => (
            <section key={company}>
              <h2>{company}</h2>
              <ul>
                {items.map((e) => (
                  <li key={e.id}>
                    <button type="button" aria-current={e.id === current.id ? 'true' : undefined} disabled={running !== null} onClick={() => open(e)}>
                      {e.title}
                      {passed[e.id] && <span className="oficina__done"> · passou</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

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
            {announce}
          </p>

          {run && (
            <section aria-labelledby="oficina-results">
              <h3 id="oficina-results">{run.which === 'all' ? 'Resultado do envio' : 'Testes visíveis'}</h3>
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

          {passed[current.id] && (
            <section aria-labelledby="oficina-reference">
              <h3 id="oficina-reference">Solução de referência</h3>
              <p className="oficina__statement">{current.explanation}</p>
              <pre className="code">{current.reference}</pre>
            </section>
          )}
        </section>
      </div>
    </div>
  )
}
