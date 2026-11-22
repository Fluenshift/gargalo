import { Fragment, useState } from 'react'
import { Stars } from './Stars'
import { loadSavedResults, revealedHints } from './oficina/progress'
import { info, type CheckInfo, type Verdict } from './oficina/projeto/checklist'
import { buildContext } from './oficina/projeto/context'
import { docsFor } from './oficina/projeto/docs'
import { explain } from './oficina/projeto/explain'
import type { Project } from './oficina/projeto/project'
import { resumeStage, runStage, saveStageResult, stagePassed, type ProjectCourse, type StageResult } from './oficina/projeto/stage'

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** The Etapa panel: the current stage, its acceptance tests and checklist, hints, explained errors, "copiar contexto" and the framework's docs. */
export function Etapa({ project, course, warming, onGoTo }: { project: Project; course: ProjectCourse; warming: boolean; onGoTo: (file: string, line?: number) => void }) {
  const [saved, setSaved] = useState(loadSavedResults)
  const [index, setIndex] = useState(() => resumeStage(course, loadSavedResults()))
  const [run, setRun] = useState<{ result: StageResult; xp: number }>()
  const [running, setRunning] = useState(false)
  // Failed runs per stage this visit: one hint each.
  const [failed, setFailed] = useState<Record<string, number>>({})
  // Hints per stage the player asked for with "Ver próxima dica", on top of hint 1 and one per failed run.
  const [revealed, setRevealed] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('')

  const stage = course.stages[index]
  const passed = stagePassed(saved, course.id, stage.id)
  const failure = run?.result.tests.find((t) => !t.passed)
  const explanation = failure && explain(failure)
  const visibleHints = revealedHints(stage.hints, failed[stage.id] ?? 0, revealed[stage.id] ?? 0)
  // Before a run, what the checklist asks; after, how the code did.
  const checks: (CheckInfo & Partial<Verdict>)[] = run?.result.checklist ?? stage.checklist.map((c) => info(c.id))

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
      } else setFailed((f) => ({ ...f, [stage.id]: (f[stage.id] ?? 0) + 1 }))
      setRun({ result, xp })
      const count = `${result.tests.filter((t) => t.passed).length} de ${stage.tests.length} testes passaram.`
      const newHint = !result.passed && (failed[stage.id] ?? 0) < stage.hints.length
      setStatus(result.passed ? `${count} ${result.stars} de 3 estrelas.` : `${count}${newHint ? ' Uma dica nova foi liberada.' : ''}`)
    } catch (err) {
      setStatus(`Os testes não rodaram: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
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
      <p className="oficina__statement">{stage.statement}</p>
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

      <div className="etapa__actions">
        <button type="button" className="btn btn--primary btn--small" onClick={start} disabled={running}>
          Rodar testes
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={copy}>
          Copiar contexto
        </button>
      </div>
      <p className="oficina__status" role="status" aria-live="polite">
        {status || (warming ? 'Carregando o Postgres do navegador…' : '')}
      </p>

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

      <details className="etapa__docs">
        <summary>Documentação</summary>
        {docsFor(project.framework).map((section) => (
          <section key={section.title} className="projeto__slot">
            <h4 className="projeto__label">{section.title}</h4>
            {section.entries.map((e) => (
              <div key={e.title}>
                <p>
                  <strong>{e.title}.</strong> {e.text}
                </p>
                {e.code && <pre className="code code--wrap">{e.code}</pre>}
              </div>
            ))}
          </section>
        ))}
      </details>
    </div>
  )
}
