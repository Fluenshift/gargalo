import { javascript } from '@codemirror/lang-javascript'
import { highlightCode } from '@lezer/highlight'
import { Fragment, useEffect, useState, type ReactNode, type RefObject, useRef } from 'react'
import { Stars } from './Stars'
import { highlight } from './oficina/editor'
import { loadSavedResults, revealedHints } from './oficina/progress'
import { info, type CheckInfo, type Verdict } from './oficina/projeto/checklist'
import { buildContext } from './oficina/projeto/context'
import { docsFor } from './oficina/projeto/docs'
import { explain } from './oficina/projeto/explain'
import type { Prefill } from './oficina/projeto/http'
import type { Project } from './oficina/projeto/project'
import { checkStep, missingInFile, resumeStage, runStage, saveStageResult, splitStatement, stagePassed, stepFor, stepRequest, type ProjectCourse, type Stage, type StageResult } from './oficina/projeto/stage'

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

const stepKey = (course: string, stage: string) => `gargalo:passo:${course}:${stage}`

/** The step remembered for a course and stage (0 when unknown), and a way to change it. */
function useStep(course: string, stageId: string, last: number) {
  const [step, setStep] = useState(() => {
    try {
      return Math.min(Math.max(Number(localStorage.getItem(stepKey(course, stageId))) || 0, 0), last)
    } catch {
      return 0
    }
  })
  const go = (i: number) => {
    setStep(i)
    try {
      localStorage.setItem(stepKey(course, stageId), String(i))
    } catch {
      // Private mode or full storage: the step is just not remembered.
    }
  }
  return [step, go] as const
}

const tsParser = javascript({ typescript: true }).language.parser

/** Read-only code with the editor's token colours. */
function Code({ code, label }: { code: string; label: string }) {
  const parts: ReactNode[] = []
  highlightCode(
    code,
    tsParser.parse(code),
    highlight,
    (text, classes) => parts.push(classes ? <span key={parts.length} className={classes}>{text}</span> : text),
    () => parts.push('\n'),
  )
  return (
    <pre className="code code--wrap passos__code" tabIndex={0} aria-label={label}>
      {parts}
    </pre>
  )
}

/** Text where `[term](doc-id)` becomes a link to that docs entry. */
const linked = (text: string, onDoc: (id: string) => void) =>
  text.split(/\[([^\]]+)\]\(([\w-]+)\)/).map((part, i, all) =>
    i % 3 === 1 ? (
      <button key={i} type="button" className="levels__map" onClick={() => onDoc(all[i + 1])}>
        {part}
      </button>
    ) : i % 3 === 2 ? null : (
      part
    ),
  )

interface GuidedProps {
  course: string
  stage: Stage
  project: Project
  runRef: RefObject<HTMLButtonElement | null>
  onOpenFile: (path: string) => void
  onTry: (prefill: Prefill) => void
  onDoc: (id: string) => void
}

/** A stage's guided steps (#137), one at a time: the concept, the pattern in code, its docs, and a check of that step alone. */
function Guiado({ course, stage, project, runRef, onOpenFile, onTry, onDoc }: GuidedProps) {
  const steps = stage.steps!.map((s) => stepFor(s, project.framework))
  const last = steps.length - 1
  const [step, go] = useStep(course, stage.id, last)
  // Per step this visit: true once "Conferir passo" passed, or what is missing.
  const [checked, setChecked] = useState<Record<number, true | string>>({})
  const [checking, setChecking] = useState(false)
  const s = steps[step]
  const card = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  // After Voltar/Prosseguir the panel keeps its scroll: bring the new step's title into view and give it focus, not on first render.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    const el = card.current
    const panel = el?.closest<HTMLElement>('.projeto__side')
    // Wide screens: the sticky panel scrolls on its own, so move only it (the editor stays put). Narrow: the page scrolls.
    if (el && panel && panel.scrollHeight > panel.clientHeight) {
      const top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 12
      panel.scrollTo({ top, behavior: 'smooth' })
    } else el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    title.current?.focus({ preventScroll: true })
  }, [step])
  const docs = docsFor(project.framework).flatMap((d) => d.entries)
  const result = checked[step]
  const request = s.check?.kind === 'request' ? s.check : undefined

  const check = async () => {
    const c = s.check!
    const at = step
    const done = (r: true | string) => setChecked((all) => ({ ...all, [at]: r }))
    if (c.kind === 'file') return done(missingInFile(project.files, c) ?? true)
    setChecking(true)
    try {
      done((await checkStep(project, c, stage.seed)) ?? true)
    } catch (err) {
      done(`Não deu para conferir: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  const next = () => {
    if (s.check && result !== true && !confirm('Você ainda não conferiu este passo. Prosseguir mesmo assim?')) return
    go(step + 1)
  }

  return (
    <div className="passos">
      <p className="oficina__statement">{stage.statement}</p>
      <section ref={card} className="passos__card" aria-label="Passo a passo">
        <p className="passos__count">
          Passo {step + 1} de {steps.length}
        </p>
        <div className="passos__body" aria-live="polite">
          <h4 ref={title} tabIndex={-1} className="passos__title">
            {s.title}
          </h4>
          {s.do ? (
            <p className="passos__do">
              <strong>Faça agora:</strong> {s.do}
            </p>
          ) : (
            <p className="oficina__statement">{linked(s.learn, onDoc)}</p>
          )}
        </div>
        {s.example && (
          <div className="passos__example">
            <p className="projeto__label">{s.example.exact ? `Digite em ${s.example.file}` : `Exemplo${s.example.file ? ` · ${s.example.file}` : ''}`}</p>
            <Code code={s.example.code} label={`${s.example.exact ? 'Código para digitar' : 'Exemplo de código'}: ${s.title}`} />
            {s.example.note && <p className="passos__note">{s.example.note}</p>}
          </div>
        )}
        {s.do && (
          <div className="passos__why">
            <p className="projeto__label">Por quê</p>
            <p className="oficina__statement">{linked(s.learn, onDoc)}</p>
          </div>
        )}
        {s.docs && (
          <p className="passos__docs">
            Ver na documentação:{' '}
            {s.docs.map((id, i) => {
              const e = docs.find((d) => d.id === id)
              return (
              <Fragment key={id}>
                {e?.url && (
                  <>
                    <a className="levels__map" href={e.url} target="_blank" rel="noopener noreferrer">
                      {e.title} ↗
                    </a>{' '}
                  </>
                )}
                <button type="button" className="levels__map" onClick={() => onDoc(id)}>
                  {e?.url ? 'resumo' : (e?.title ?? id)}
                </button>
                {i < s.docs!.length - 1 && ' · '}
              </Fragment>
              )
            })}
          </p>
        )}
        {(s.file || s.check) && (
          <div className="etapa__actions">
            {s.file && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onOpenFile(s.file!)}>
                Abrir {s.file}
              </button>
            )}
            {request && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onTry({ request: stepRequest(request), before: request.before })}>
                Testar agora
              </button>
            )}
            {s.check && (
              <button type="button" className="btn btn--ghost btn--small" onClick={check} disabled={checking} aria-busy={checking}>
                Conferir passo
              </button>
            )}
          </div>
        )}
        {s.check && (
          <p className={`passos__check${result === true ? ' is-ok' : result ? ' is-missing' : ''}`} role="status">
            {checking ? 'Conferindo…' : result === true ? '✓ Passo conferido.' : result}
          </p>
        )}
        <ol className="passos__dots" aria-hidden="true">
          {steps.map((_, i) => (
            <li key={i} className={i === step ? 'is-current' : i < step ? 'is-done' : undefined} />
          ))}
        </ol>
        <div className="etapa__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => go(step - 1)} disabled={step === 0}>
            Voltar
          </button>
          {step < last ? (
            <button type="button" className="btn btn--primary btn--small" onClick={next}>
              Prosseguir
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--small" onClick={() => runRef.current?.click()}>
              Rodar os testes da etapa
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

/** The statement one numbered step at a time (the owner found the whole text too long); "Ver tudo" shows it whole. The step is remembered per course and stage. */
function Passos({ course, stageId, statement, runRef }: { course: string; stageId: string; statement: string; runRef: RefObject<HTMLButtonElement | null> }) {
  const { intro, steps } = splitStatement(statement)
  const last = steps.length - 1
  const [step, go] = useStep(course, stageId, last)
  const [all, setAll] = useState(false)
  return (
    <div className="passos">
      {intro && !all && <p className="oficina__statement">{intro}</p>}
      {steps.length === 1 || all ? (
        <p className="oficina__statement passos__card">{all ? statement : steps[0]}</p>
      ) : (
        <section className="passos__card" aria-label="Passo a passo">
          <p className="passos__count">
            Passo {step + 1} de {steps.length}
          </p>
          <p className="oficina__statement passos__text" aria-live="polite" tabIndex={0}>
            {steps[step]}
          </p>
          <ol className="passos__dots" aria-hidden="true">
            {steps.map((_, i) => (
              <li key={i} className={i === step ? 'is-current' : i < step ? 'is-done' : undefined} />
            ))}
          </ol>
          <div className="etapa__actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => go(step - 1)} disabled={step === 0}>
              Voltar
            </button>
            {step < last ? (
              <button type="button" className="btn btn--primary btn--small" onClick={() => go(step + 1)}>
                Prosseguir
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--small" onClick={() => runRef.current?.focus()}>
                Último passo: rodar os testes
              </button>
            )}
          </div>
        </section>
      )}
      {steps.length > 1 && (
        <button type="button" className="levels__map passos__toggle" aria-pressed={all} onClick={() => setAll(!all)}>
          {all ? 'Ver em passos' : 'Ver tudo'}
        </button>
      )}
    </div>
  )
}

/** The Etapa panel: the current stage, its acceptance tests and checklist, hints, explained errors, "copiar contexto" and the framework's docs. */
export function Etapa({
  project,
  course,
  warming,
  onGoTo,
  onOpenFile,
  onTry,
}: {
  project: Project
  course: ProjectCourse
  warming: boolean
  onGoTo: (file: string, line?: number) => void
  onOpenFile: (path: string) => void
  onTry: (prefill: Prefill) => void
}) {
  const [saved, setSaved] = useState(loadSavedResults)
  const [index, setIndex] = useState(() => resumeStage(course, loadSavedResults()))
  const [run, setRun] = useState<{ result: StageResult; xp: number }>()
  const [running, setRunning] = useState(false)
  // Failed runs per stage this visit: one hint each.
  const [failed, setFailed] = useState<Record<string, number>>({})
  // Hints per stage the player asked for with "Ver próxima dica", on top of hint 1 and one per failed run.
  const [revealed, setRevealed] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('')
  const runRef = useRef<HTMLButtonElement>(null)
  const docsRef = useRef<HTMLDetailsElement>(null)

  const stage = course.stages[index]
  const passed = stagePassed(saved, course.id, stage.id)
  const failure = run?.result.tests.find((t) => !t.passed)
  const explanation = failure && explain(failure)
  const visibleHints = revealedHints(stage.hints, failed[stage.id] ?? 0, revealed[stage.id] ?? 0)
  // Before a run, what the checklist asks; after, how the code did.
  // Verdicts only once the tests pass: an empty project "passing" a practice is a false signal, and stars need passing tests anyway.
  const checks: (CheckInfo & Partial<Verdict>)[] = run?.result.passed ? run.result.checklist : stage.checklist.map((c) => info(c.id))

  const go = (i: number) => {
    setIndex(i)
    setRun(undefined)
    setStatus('')
  }

  const start = async () => {
    setRunning(true)
    setStatus('Rodando os testes da etapa…')
    try {
      const result = await runStage(project, stage)
      let xp = 0
      if (result.passed) {
        const kept = saveStageResult(course.id, stage.id, result)
        setSaved(kept.results)
        xp = kept.xp
      } else if (!stage.steps) setFailed((f) => ({ ...f, [stage.id]: (f[stage.id] ?? 0) + 1 }))
      setRun({ result, xp })
      const count = `${result.tests.filter((t) => t.passed).length} de ${stage.tests.length} testes passaram.`
      const newHint = !result.passed && !stage.steps && (failed[stage.id] ?? 0) < stage.hints.length
      setStatus(result.passed ? `${count} ${result.stars} de 3 estrelas.` : `${count}${newHint ? ' Uma dica nova foi liberada.' : ''}`)
    } catch (err) {
      setStatus(`Os testes não rodaram: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  /** Opens the docs and brings that entry into view. */
  const showDoc = (id: string) => {
    docsRef.current!.open = true
    const entry = document.getElementById(`doc-${id}`)
    entry?.scrollIntoView({ block: 'start' })
    entry?.focus({ preventScroll: true })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildContext({ project, stage, failure, explanation }))
      setStatus('Contexto copiado: cole num assistente.')
    } catch {
      setStatus('O navegador não deixou copiar.')
    }
  }

  return (
    <div className="projeto__slot etapa">
      <p className="projeto__label">
        {course.title} · etapa {index + 1} de {course.stages.length}
      </p>
      <h3 className="etapa__title">{stage.title}</h3>
      {stage.steps ? (
        <Guiado key={`${course.id}:${stage.id}`} course={course.id} stage={stage} project={project} runRef={runRef} onOpenFile={onOpenFile} onTry={onTry} onDoc={showDoc} />
      ) : (
        <Passos key={`${course.id}:${stage.id}`} course={course.id} stageId={stage.id} statement={stage.statement} runRef={runRef} />
      )}
      <div className="etapa__actions">
        {/* With guided steps the card holds the one primary action (Prosseguir, then "Rodar os testes da etapa"). */}
        <button type="button" ref={runRef} className={`btn ${stage.steps ? 'btn--ghost' : 'btn--primary'} btn--small`} onClick={start} disabled={running}>
          Rodar testes
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={copy}>
          Copiar contexto
        </button>
      </div>
      <p className="oficina__status" role="status" aria-live="polite">
        {status || (warming ? 'Carregando o Postgres do navegador…' : '')}
      </p>

      {run && stage.bugs && (
        <section aria-labelledby="etapa-bugs" className="projeto__slot">
          <h4 id="etapa-bugs" className="projeto__label">
            Bugs plantados
          </h4>
          <ol className="oficina__results">
            {stage.bugs(run.result.tests).map((b) => (
              <li key={b.title} className={b.fixed ? 'is-passed' : 'is-failed'}>
                <p className="oficina__test">
                  <span>{b.fixed ? 'Corrigido' : 'Ainda presente'}</span> {b.title}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {run && (
        <section aria-labelledby="etapa-results" className="projeto__slot">
          <h4 id="etapa-results" className="projeto__label">
            Testes de aceitação
          </h4>
          {run.result.passed && (
            <div className="stars-line">
              <Stars count={run.result.stars} />
              {run.xp > 0 && <span className="stars-line__xp">+{run.xp} XP</span>}
            </div>
          )}
          <ol className="oficina__results">
            {run.result.tests.map((t, i) => (
              <li key={i} className={t.passed ? 'is-passed' : 'is-failed'}>
                <p className="oficina__test">
                  <span>{t.passed ? 'Passou' : 'Falhou'}</span> {t.name}
                </p>
                {t.message && (
                  <p>
                    {t.message}
                    {t.file && Object.hasOwn(project.files, t.file) && (
                      <>
                        {' '}
                        <button type="button" className="levels__map" onClick={() => onGoTo(t.file!, t.line)}>
                          Ir para {t.file}
                          {t.line !== undefined && `:${t.line}`}
                        </button>
                      </>
                    )}
                  </p>
                )}
                {'expected' in t && (
                  <div className="oficina__diff">
                    <div>
                      <h4>Esperado</h4>
                      <pre className="code code--wrap">{show(t.expected)}</pre>
                    </div>
                    <div>
                      <h4>Recebido</h4>
                      <pre className="code code--wrap">{show(t.received)}</pre>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {explanation && (
            <div className="etapa__explain">
              <p>
                <strong>{explanation.title}</strong>
              </p>
              <p>{explanation.detail}</p>
              <p>Próximo passo: {explanation.next}</p>
            </div>
          )}
        </section>
      )}

      {/* With guided steps the stage's details stay one click away, so the current step is what the panel shows. */}
      {stage.steps ? (
        <details className="etapa__details">
          <summary>Detalhes da etapa: arquivos, boas práticas e dicas</summary>
      <p className="etapa__files">
        Arquivos:{' '}
        {stage.files.map((f, i) => (
          <Fragment key={f}>
            <span>
              {Object.hasOwn(project.files, f) ? (
                <button type="button" className="levels__map" onClick={() => onGoTo(f)}>
                  {f}
                </button>
              ) : (
                `${f} (falta)`
              )}
              {i < stage.files.length - 1 && ','}
            </span>{' '}
          </Fragment>
        ))}
      </p>

      {stage.checklist.length > 0 && (
        <section aria-labelledby="etapa-checklist" className="projeto__slot">
          <h4 id="etapa-checklist" className="projeto__label">
            Boas práticas
          </h4>
          <ol className="oficina__results">
            {checks.map((c) => (
              <li key={c.id} className={c.passed === undefined ? undefined : c.passed ? 'is-passed' : 'is-failed'}>
                <p className="oficina__test">
                  {c.passed !== undefined && <span>{c.passed ? 'Cumprida' : 'Falta'}</span>} {c.title}
                </p>
                <p>{c.passed === undefined ? c.why : c.passed ? c.message : `${c.message} ${c.fix}`}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {visibleHints.length > 0 && (
        <section aria-labelledby="etapa-hints" className="projeto__slot">
          <h4 id="etapa-hints" className="projeto__label">
            Dica {visibleHints.length} de {stage.hints.length}
          </h4>
          <ol className="oficina__hints">
            {visibleHints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {visibleHints.length < stage.hints.length && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setRevealed((r) => ({ ...r, [stage.id]: (r[stage.id] ?? 0) + 1 }))}
            >
              Ver próxima dica
            </button>
          )}
        </section>
      )}

        </details>
      ) : (
        <>
      <p className="etapa__files">
        Arquivos:{' '}
        {stage.files.map((f, i) => (
          <Fragment key={f}>
            <span>
              {Object.hasOwn(project.files, f) ? (
                <button type="button" className="levels__map" onClick={() => onGoTo(f)}>
                  {f}
                </button>
              ) : (
                `${f} (falta)`
              )}
              {i < stage.files.length - 1 && ','}
            </span>{' '}
          </Fragment>
        ))}
      </p>

      {stage.checklist.length > 0 && (
        <section aria-labelledby="etapa-checklist" className="projeto__slot">
          <h4 id="etapa-checklist" className="projeto__label">
            Boas práticas
          </h4>
          <ol className="oficina__results">
            {checks.map((c) => (
              <li key={c.id} className={c.passed === undefined ? undefined : c.passed ? 'is-passed' : 'is-failed'}>
                <p className="oficina__test">
                  {c.passed !== undefined && <span>{c.passed ? 'Cumprida' : 'Falta'}</span>} {c.title}
                </p>
                <p>{c.passed === undefined ? c.why : c.passed ? c.message : `${c.message} ${c.fix}`}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {visibleHints.length > 0 && (
        <section aria-labelledby="etapa-hints" className="projeto__slot">
          <h4 id="etapa-hints" className="projeto__label">
            Dica {visibleHints.length} de {stage.hints.length}
          </h4>
          <ol className="oficina__hints">
            {visibleHints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {visibleHints.length < stage.hints.length && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setRevealed((r) => ({ ...r, [stage.id]: (r[stage.id] ?? 0) + 1 }))}
            >
              Ver próxima dica
            </button>
          )}
        </section>
      )}

        </>
      )}
      {passed && (
        <section aria-labelledby="etapa-explanation" className="projeto__slot">
          <h4 id="etapa-explanation" className="projeto__label">
            Por quê
          </h4>
          <p className="oficina__statement">{stage.explanation}</p>
        </section>
      )}

      {course.stages.length > 1 && (
        <div className="etapa__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => go(index - 1)} disabled={running || index === 0}>
            Etapa anterior
          </button>
          {/* The next stage opens once this one's tests pass. */}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => go(index + 1)}
            disabled={running || !passed || index === course.stages.length - 1}
            title={passed ? undefined : 'Passe nos testes desta etapa para abrir a próxima'}
          >
            Próxima etapa
          </button>
        </div>
      )}

      <details className="etapa__docs" ref={docsRef}>
        <summary>Documentação</summary>
        {docsFor(project.framework).map((section) => (
          <section key={section.title} className="projeto__slot">
            <h4 className="projeto__label">{section.title}</h4>
            {section.entries.map((e) => (
              <div key={e.id} id={`doc-${e.id}`} className="etapa__doc" tabIndex={-1}>
                <p>
                  <strong>{e.title}.</strong> {e.text}
                </p>
                {e.url && (
                  <p>
                    <a className="levels__map" href={e.url} target="_blank" rel="noopener noreferrer">
                      Documentação oficial ↗
                    </a>
                  </p>
                )}
                {e.code && <pre className="code code--wrap">{e.code}</pre>}
              </div>
            ))}
          </section>
        ))}
      </details>
    </div>
  )
}
