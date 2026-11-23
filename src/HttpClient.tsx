import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  EMPTY_DRAFT,
  METHODS,
  addToHistory,
  hasBody,
  jsonProblem,
  loadClient,
  prettyBody,
  removeSaved,
  saveClient,
  saveRequest,
  toRequest,
  type ClientState,
  type Draft,
  type Method,
} from './oficina/projeto/http'
import type { Project } from './oficina/projeto/project'
import { request } from './oficina/projeto/runner'
import type { RequestOutcome } from './oficina/projeto/runtime'

const statusClass = (status: number) => (status < 300 ? 'is-ok' : status < 500 ? 'is-warm' : 'is-hot')

/** The project's HTTP client: compose a request, send it to the dev database, read the answer, keep history and saved requests. `prefill` opens with that request and sends it once. */
export function HttpClient({ project, onSent, warming, prefill }: { project: Project; onSent: (draft: Draft, outcome: RequestOutcome) => void; warming: boolean; prefill?: Draft }) {
  const id = useId()
  const [draft, setDraft] = useState<Draft>(prefill ?? EMPTY_DRAFT)
  const [state, setState] = useState<ClientState>(() => loadClient(project.id))
  const [outcome, setOutcome] = useState<RequestOutcome | null>(null)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState('')
  const [saveName, setSaveName] = useState('')

  const keep = (next: ClientState) => {
    setState(next)
    saveClient(project.id, next)
  }
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setProblem('')
  }

  const sendDraft = async (draft: Draft) => {
    const built = toRequest(draft)
    if ('error' in built) return setProblem(built.error)
    setProblem(jsonProblem(draft) ?? '')
    setSending(true)
    const result = await request(project, built.request)
    setSending(false)
    setOutcome(result)
    onSent(draft, result)
    keep({ ...state, history: addToHistory(state.history, { ...draft, status: result.response?.status, ms: result.ms, at: Date.now() }) })
  }
  const send = (e: FormEvent) => {
    e.preventDefault()
    void sendDraft(draft)
  }
  // Once per prefill (only a new one sends): StrictMode runs effects twice, and a new prefill is a new object.
  const sentPrefill = useRef<Draft>(undefined)
  useEffect(() => {
    if (!prefill || sentPrefill.current === prefill) return
    sentPrefill.current = prefill
    void sendDraft(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new prefill sends; sendDraft changes every render
  }, [prefill])

  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = saveName.trim()
    if (!name) return
    keep({ ...state, saved: saveRequest(state.saved, { ...draft, name }) })
    setSaveName('')
  }

  const load = (d: Draft) => {
    setDraft({ method: d.method, path: d.path, headers: d.headers, body: d.body })
    setProblem('')
  }

  const response = outcome?.response
  const contentType = response?.headers['content-type'] ?? ''

  return (
    <div className="http">
      <form className="http__form" onSubmit={send} aria-label="Requisição">
        <div className="http__line">
          <label htmlFor={`${id}-method`} className="sr-only">
            Método
          </label>
          <select id={`${id}-method`} value={draft.method} onChange={(e) => edit({ method: e.target.value as Method })}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label htmlFor={`${id}-path`} className="sr-only">
            Caminho
          </label>
          <input id={`${id}-path`} type="text" value={draft.path} spellCheck={false} onChange={(e) => edit({ path: e.target.value })} />
          <button type="submit" className="btn btn--primary btn--small" disabled={sending} aria-busy={sending}>
            Enviar
          </button>
        </div>
        <label htmlFor={`${id}-headers`} className="projeto__label">
          Headers
        </label>
        <textarea id={`${id}-headers`} rows={2} value={draft.headers} spellCheck={false} placeholder="Authorization: Bearer …" onChange={(e) => edit({ headers: e.target.value })} />
        {hasBody(draft.method) && (
          <>
            <label htmlFor={`${id}-body`} className="projeto__label">
              Corpo
            </label>
            <textarea id={`${id}-body`} rows={5} value={draft.body} spellCheck={false} placeholder='{ "nome": "vela" }' onChange={(e) => edit({ body: e.target.value })} />
          </>
        )}
      </form>

      <p className="oficina__status" role="status" aria-live="polite">
        {problem || (sending ? 'Enviando…' : warming ? 'Carregando o Postgres do navegador…' : '')}
      </p>

      {outcome && (
        <section className="http__response" aria-label="Resposta">
          {response ? (
            <>
              <p className="http__meta">
                <span className={`http__status ${statusClass(response.status)}`}>{response.status}</span> · {Math.round(outcome.ms)} ms
                {outcome.metrics.queries > 0 && ` · ${outcome.metrics.queries} consulta${outcome.metrics.queries > 1 ? 's' : ''}`}
              </p>
              <details className="http__headers">
                <summary>Headers da resposta ({Object.keys(response.headers).length})</summary>
                <pre className="code code--wrap">{Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
              </details>
              {response.body ? <pre className="code code--wrap">{prettyBody(response.body, contentType)}</pre> : <p className="oficina__note">Sem corpo.</p>}
            </>
          ) : (
            <p className="http__error">{outcome.error?.message ?? 'Sem resposta.'}</p>
          )}
        </section>
      )}

      <form className="http__save" onSubmit={save}>
        <label htmlFor={`${id}-name`} className="sr-only">
          Nome para salvar a requisição
        </label>
        <input id={`${id}-name`} type="text" value={saveName} placeholder="Nome, ex.: criar produto" onChange={(e) => setSaveName(e.target.value)} />
        <button type="submit" className="btn btn--ghost btn--small" disabled={!saveName.trim()}>
          Salvar
        </button>
      </form>

      {state.saved.length > 0 && (
        <section aria-labelledby={`${id}-saved`}>
          <h4 id={`${id}-saved`} className="projeto__label">
            Salvas
          </h4>
          <ul className="http__list">
            {state.saved.map((s) => (
              <li key={s.name}>
                <button type="button" className="http__item" onClick={() => load(s)}>
                  <span className="http__method">{s.method}</span> {s.name}
                </button>
                <button type="button" className="projeto__close" aria-label={`Apagar ${s.name}`} onClick={() => keep({ ...state, saved: removeSaved(state.saved, s.name) })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.history.length > 0 && (
        <section aria-labelledby={`${id}-history`}>
          <h4 id={`${id}-history`} className="projeto__label">
            Histórico
          </h4>
          <ul className="http__list">
            {state.history.map((h) => (
              <li key={h.at}>
                <button type="button" className="http__item" onClick={() => load(h)}>
                  <span className="http__method">{h.method}</span> {h.path}
                  <span className={`http__status ${h.status ? statusClass(h.status) : 'is-hot'}`}>{h.status ?? 'erro'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
