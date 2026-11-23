import { EditorView } from 'codemirror'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { codeExtensions } from './oficina/editor'
import { ENTRY, isScript, logLocation, pathProblem, renamed, treeOf, without } from './oficina/projeto/files'
import {
  type Framework,
  type Project,
  type ProjectEntry,
  loadProject,
  loadProjectList,
  removeProject,
  saveProject,
  saveProjectList,
  starter,
  blank,
} from './oficina/projeto/project'
import { exportFiles, slugOf } from './oficina/projeto/exportar'
import { forgetClient, loadClient, type Draft } from './oficina/projeto/http'
import { buildOpenApi, requestsOf } from './oficina/projeto/openapi'
import { loadSavedResults } from './oficina/progress'
import { zip } from './oficina/projeto/zip'
import { applyMigrations, dropDev, listTables, prewarm, resetDev, tableRows } from './oficina/projeto/runner'
import { Etapa } from './Etapa'
import { HttpClient } from './HttpClient'
import { COURSES, courseOf } from './oficina/projeto/courses'
import { OpenApi } from './OpenApi'
import type { CodeError, LogLine, RequestOutcome, Route, TableRows } from './oficina/projeto/runtime'
import { PROJETOS_PATH, followLink, navigate } from './route'

const FRAMEWORKS: [Framework, string, string][] = [
  ['hono', 'Hono', 'um framework leve: menos código repetido em cada rota. Bom para começar.'],
  ['fetch', 'fetch puro', 'a API padrão da web, sem framework: você escreve o roteamento à mão.'],
]
const frameworkName = (f: Framework) => FRAMEWORKS.find(([k]) => k === f)![1]
const projectPath = (id: string) => `${PROJETOS_PATH}/${encodeURIComponent(id)}`
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** One text field with its action; `submit` returns why the value is refused, or undefined when it was taken. Esc cancels. */
function NameForm({ label, initial, action, submit, onCancel }: { label: string; initial: string; action: string; submit: (value: string) => string | undefined; onCancel: () => void }) {
  const id = useId()
  const [value, setValue] = useState(initial)
  const [problem, setProblem] = useState<string>()
  return (
    <form
      className="projeto__form"
      onSubmit={(e) => {
        e.preventDefault()
        setProblem(submit(value.trim()))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        // The form opens on a click that asked for it, so the field takes the focus.
        autoFocus
        spellCheck={false}
        aria-invalid={problem !== undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => setValue(e.target.value)}
      />
      <span className="projeto__form-actions">
        <button type="submit" className="btn btn--ghost btn--small">
          {action}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>
          Cancelar
        </button>
      </span>
      {problem && (
        <p id={`${id}-problem`} className="projeto__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  )
}

/** The editor for one file of the project; its text is read once, when the file's tab opens. */
function FileEditor({ path, text, onChange, onView }: { path: string; text: string; onChange: (code: string) => void; onView: (view: EditorView | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const initial = useRef(text)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  })
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      doc: initial.current,
      extensions: codeExtensions({ label: `Código de ${path}`, describedBy: 'projeto-keys', typescript: isScript(path), onChange: (code) => change.current(code) }),
    })
    onView(view)
    return () => {
      onView(null)
      view.destroy()
    }
    // shortcut: a new view per tab, so switching tabs loses the cursor and undo history; keep EditorStates per path if players miss them.
  }, [path, onView])
  return <div ref={host} className="oficina__editor projeto__editor" />
}

interface ConsoleLine extends LogLine {
  error?: CodeError
}

/** The dev database: its tables and rows, apply migrations, reset. */
function Banco({ project }: { project: Project }) {
  const [tables, setTables] = useState<string[]>()
  const [table, setTable] = useState<string>()
  const [rows, setRows] = useState<TableRows>()
  const [busy, setBusy] = useState<'load' | 'migrate' | 'reset' | null>('load')
  const [status, setStatus] = useState('')
  const current = useRef(project)
  useEffect(() => {
    current.current = project
  })

  const refresh = useCallback(async (keep?: string) => {
    const names = await listTables(current.current)
    setTables(names)
    const show = keep && names.includes(keep) ? keep : undefined
    setTable(show)
    setRows(show ? await tableRows(current.current, show) : undefined)
  }, [])

  const act = async (what: 'load' | 'migrate' | 'reset', run: () => Promise<string>) => {
    setBusy(what)
    try {
      setStatus(await run())
    } catch (err) {
      setStatus(message(err))
    }
    setBusy(null)
  }

  useEffect(() => {
    refresh()
      .then(() => setStatus(''))
      .catch((err: unknown) => setStatus(message(err)))
      .finally(() => setBusy(null))
  }, [project.id, refresh])

  const migrate = () =>
    act('migrate', async () => {
      const applied = await applyMigrations(current.current)
      await refresh(table)
      return applied.length ? `Aplicadas: ${applied.join(', ')}.` : 'Nenhuma migração pendente.'
    })

  const reset = () => {
    if (!confirm('Apagar todas as tabelas e dados do banco de desenvolvimento deste projeto?')) return
    void act('reset', async () => {
      await resetDev(current.current)
      await refresh()
      return 'Banco resetado: sem tabelas. Aplique as migrações de novo.'
    })
  }

  const open = (name: string) =>
    act('load', async () => {
      setTable(name)
      setRows(await tableRows(current.current, name))
      return ''
    })

  const cell = (v: unknown) => (v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v))

  return (
    <div className="projeto__banco">
      <div className="oficina__actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={migrate} disabled={busy !== null} aria-busy={busy === 'migrate'}>
          Aplicar migrações
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={reset} disabled={busy !== null} aria-busy={busy === 'reset'}>
          Resetar banco
        </button>
      </div>
      <p className="oficina__status" role="status" aria-live="polite">
        {status || (busy === 'load' && !tables ? 'Abrindo o banco do projeto…' : '')}
      </p>
      {tables && (
        <div className="projeto__tables" role="group" aria-label="Tabelas">
          {tables.length === 0 && <p className="oficina__note">Nenhuma tabela. Escreva uma migração em migrations/ e aplique.</p>}
          {tables.map((t) => (
            <button key={t} type="button" className="oficina__pill" aria-pressed={t === table} disabled={busy !== null} onClick={() => open(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {table && rows && (
        <div className="projeto__rows" tabIndex={0} role="region" aria-label={`Linhas de ${table}`}>
          <table className="sheet projeto__sheet">
            <caption>
              <span className="sheet__title">
                {table}: {rows.rows.length === 0 ? 'vazia' : `${rows.rows.length} ${rows.rows.length === 1 ? 'linha' : 'linhas'}`}
              </span>
            </caption>
            <thead>
              <tr>
                {rows.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((r, i) => (
                <tr key={i}>
                  {rows.columns.map((c) => (
                    <td key={c}>{cell(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** One open project: file tree, editor tabs, the Banco and Console panels, and the slots for the HTTP client and the stage. */
function ProjectView({ entry }: { entry: ProjectEntry }) {
  const [project, setProject] = useState<Project>(() => loadProject(entry.id) ?? starter(entry.id, entry.framework))
  // A course that starts blank has no src/index.ts yet: open a file that exists.
  const [first] = useState(() => (ENTRY in project.files ? ENTRY : (Object.keys(project.files)[0] ?? ENTRY)))
  const [tabs, setTabs] = useState<string[]>([first])
  const [active, setActive] = useState(first)
  const [form, setForm] = useState<'new' | 'rename' | null>(null)
  // When the name form closes (done, cancelled or Esc), focus goes back to the button that opened it, not to the page.
  const formOpener = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (form === null) formOpener.current?.focus()
  }, [form])
  const [panel, setPanel] = useState<'banco' | 'console'>('banco')
  const [side, setSide] = useState<'requisicao' | 'etapa' | 'openapi'>('etapa')
  // "Testar agora" in a guided step: the request the Requisição tab opens with and sends once.
  const [prefill, setPrefill] = useState<Draft>()
  const pick = (next: typeof side) => {
    setSide(next)
    setPrefill(undefined)
  }
  const [routes, setRoutes] = useState<Route[]>()
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const [saveFailed, setSaveFailed] = useState(false)
  const [warming, setWarming] = useState(true)
  const view = useRef<EditorView | null>(null)
  const pendingLine = useRef<number | null>(null)
  const latest = useRef(project)

  useEffect(() => {
    prewarm()
      .catch(() => {})
      .finally(() => setWarming(false))
  }, [])
  // Autosave a moment after typing stops, and once more on leaving.
  useEffect(() => {
    latest.current = project
    const timer = setTimeout(() => setSaveFailed(!saveProject(project)), 400)
    return () => clearTimeout(timer)
  }, [project])
  useEffect(() => {
    // Closing the tab skips React's unmount: save on pagehide too, so the last keystrokes are kept.
    const flush = () => void saveProject(latest.current)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  const files = project.files
  const setFiles = (next: (f: Record<string, string>) => Record<string, string>) => setProject((p) => ({ ...p, files: next(p.files) }))

  const moveTo = (v: EditorView, line: number) => {
    const at = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines)).from
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    v.focus()
  }
  const onView = useCallback((v: EditorView | null) => {
    view.current = v
    if (v && pendingLine.current !== null) {
      moveTo(v, pendingLine.current)
      pendingLine.current = null
    }
  }, [])

  const open = (path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActive(path)
    setForm(null)
  }
  /** Opens the file an error points at and puts the cursor on its line. */
  const goTo = (file: string, line = 1) => {
    if (!Object.hasOwn(files, file)) return
    if (file === active && view.current) return moveTo(view.current, line)
    pendingLine.current = line
    open(file)
  }
  /** "Abrir <arquivo>" in a guided step: opens it, created empty when it does not exist yet. */
  const openOrCreate = (path: string) => {
    if (!Object.hasOwn(files, path)) setFiles((f) => ({ ...f, [path]: '' }))
    open(path)
  }
  const close = (path: string) => {
    const left = tabs.filter((t) => t !== path)
    setTabs(left.length ? left : [ENTRY])
    if (path === active) setActive(left.at(-1) ?? ENTRY)
  }

  const create = (path: string) => {
    const problem = pathProblem(path, files)
    if (problem) return problem
    setFiles((f) => ({ ...f, [path]: '' }))
    open(path)
  }
  const rename = (path: string) => {
    if (path === active) return void setForm(null)
    const problem = pathProblem(path, files, active)
    if (problem) return problem
    setFiles((f) => renamed(f, active, path))
    setTabs((t) => t.map((p) => (p === active ? path : p)))
    setActive(path)
    setForm(null)
  }
  const remove = () => {
    if (active === ENTRY || !confirm(`Apagar ${active}?`)) return
    setFiles((f) => without(f, active))
    close(active)
  }

  // Every request the HTTP client sends leaves a line in the Console, then the project's own logs.
  const record = (method: string, sent: string, outcome: RequestOutcome) => {
    if (outcome.routes) setRoutes(outcome.routes)
    const head: ConsoleLine = { level: outcome.error ? 'error' : 'log', text: `${method} ${sent} → ${outcome.response?.status ?? 'erro'} · ${Math.round(outcome.ms)} ms` }
    const error: ConsoleLine[] = outcome.error ? [{ level: 'error', text: outcome.error.message, error: outcome.error }] : []
    setLogs((l) => [...l, head, ...outcome.logs, ...error])
  }

  /** "Baixar projeto": a zip that runs outside the browser (see exportar.ts), made here and handed over as a download. */
  const download = () => {
    const { history, saved } = loadClient(project.id)
    const openapi = buildOpenApi({ title: entry.name, routes, requests: requestsOf(history, saved) })
    const bytes = zip(exportFiles(project, { name: entry.name, course: courseOf(entry.course), results: loadSavedResults(), openapi }))
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
    Object.assign(document.createElement('a'), { href: url, download: `${slugOf(entry.name)}.zip` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 0) // revoking in the same tick cancels the download in some browsers
  }

  const rows = treeOf(Object.keys(files))

  return (
    <div className="projeto">
      <div className="projeto__head">
        <a className="levels__map" href={PROJETOS_PATH} onClick={followLink}>
          ← Projetos
        </a>
        <h2 className="oficina__title">{entry.name}</h2>
        <span className="projeto__framework">{frameworkName(project.framework)}</span>
        <button type="button" className="btn btn--ghost btn--small" onClick={download}>
          Baixar projeto
        </button>
      </div>

      <section className="projeto__files" aria-labelledby="projeto-files">
        <h3 id="projeto-files" className="projeto__label">
          Arquivos
        </h3>
        <div className="projeto__file-actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={(e) => { formOpener.current = e.currentTarget; setForm('new') }}>
            Novo arquivo
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={(e) => { formOpener.current = e.currentTarget; setForm('rename') }} disabled={active === ENTRY} title={active === ENTRY ? `${ENTRY} é a entrada do projeto` : undefined}>
            Renomear
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={remove} disabled={active === ENTRY} title={active === ENTRY ? `${ENTRY} não pode ser apagado` : undefined}>
            Apagar
          </button>
        </div>
        {form === 'new' && <NameForm label="Caminho do arquivo" initial="src/routes/" action="Criar" submit={create} onCancel={() => setForm(null)} />}
        {form === 'rename' && <NameForm label={`Novo caminho de ${active}`} initial={active} action="Renomear" submit={rename} onCancel={() => setForm(null)} />}
        <ul className="projeto__tree" aria-label="Arquivos do projeto">
          {rows.map((r) => (
            <li key={`${r.kind}:${r.path}`} style={{ '--depth': r.depth } as React.CSSProperties}>
              {r.kind === 'folder' ? (
                <span className="projeto__folder">{r.name}/</span>
              ) : (
                <button type="button" aria-current={r.path === active ? 'true' : undefined} onClick={() => open(r.path)}>
                  {r.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="projeto__main" aria-label="Editor">
        <div className="projeto__tabs" role="group" aria-label="Arquivos abertos">
          {tabs.map((t) => (
            <span key={t} className="projeto__tab">
              <button type="button" aria-pressed={t === active} onClick={() => setActive(t)} title={t}>
                {t.split('/').at(-1)}
              </button>
              {tabs.length > 1 && (
                <button type="button" className="projeto__close" aria-label={`Fechar ${t}`} onClick={() => close(t)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <FileEditor key={active} path={active} text={files[active] ?? ''} onChange={(code) => setFiles((f) => ({ ...f, [active]: code }))} onView={onView} />
        <p id="projeto-keys" className="oficina__note">
          {active} · salvo sozinho. Tab indenta; Esc e depois Tab sai do editor.
          {saveFailed && ' O navegador não deixou salvar: o projeto vale só nesta visita.'}
        </p>

        <div className="projeto__panel">
          <div className="segmented segmented--small" role="group" aria-label="Painel">
            <button type="button" aria-pressed={panel === 'banco'} onClick={() => setPanel('banco')}>
              Banco
            </button>
            <button type="button" aria-pressed={panel === 'console'} onClick={() => setPanel('console')}>
              Console{logs.length > 0 && ` (${logs.length})`}
            </button>
          </div>
          {panel === 'banco' ? (
            <Banco project={project} />
          ) : (
            <div className="projeto__console">
              {logs.length === 0 ? (
                <p className="oficina__note">Os console.log das requisições aparecem aqui.</p>
              ) : (
                <>
                  <ol aria-label="Console">
                    {logs.map((l, i) => {
                      // A thrown error carries its place; one Hono caught and logged ends with it.
                      const at = l.error?.file ? { file: l.error.file, line: l.error.line } : logLocation(l.text)
                      return (
                        <li key={i} className={`projeto__log is-${l.level}`}>
                          <span className="projeto__level">{l.level}</span> {l.text}
                          {at && Object.hasOwn(files, at.file) && (
                            <>
                              {' '}
                              <button type="button" className="levels__map" onClick={() => goTo(at.file, at.line)}>
                                Ir para {at.file}
                                {at.line !== undefined && `:${at.line}`}
                              </button>
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => setLogs([])}>
                    Limpar
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* The right panel: the HTTP client, or the stage of the course. */}
      <aside className="projeto__side" aria-label="Requisição e etapa">
        <div className="segmented segmented--small" role="group" aria-label="Painel da direita">
          <button type="button" aria-pressed={side === 'etapa'} onClick={() => pick('etapa')}>
            Etapa
          </button>
          <button type="button" aria-pressed={side === 'requisicao'} onClick={() => pick('requisicao')}>
            Requisição
          </button>
          <button type="button" aria-pressed={side === 'openapi'} onClick={() => pick('openapi')}>
            OpenAPI
          </button>
        </div>
        {side === 'requisicao' ? (
          <>
            {/* Came from "Testar agora": the way back to the step, where the player was. */}
            {prefill && (
              <button type="button" className="btn btn--ghost btn--small projeto__back" onClick={() => pick('etapa')}>
                ← Voltar ao passo
              </button>
            )}
            <HttpClient project={project} warming={warming} prefill={prefill} onSent={(d, outcome) => record(d.method, d.path, outcome)} />
          </>
        ) : side === 'openapi' ? (
          <OpenApi project={project} name={entry.name} routes={routes} />
        ) : (
          <Etapa
            project={project}
            course={courseOf(entry.course)}
            warming={warming}
            onGoTo={goTo}
            onOpenFile={openOrCreate}
            onTry={(draft) => {
              setPrefill(draft)
              setSide('requisicao')
            }}
          />
        )}
      </aside>
    </div>
  )
}

/** The Projetos tab: the list, or the project `open` names. */
export function Projetos({ open }: { open?: string }) {
  const [list, setList] = useState(loadProjectList)
  const [name, setName] = useState('')
  const [framework, setFramework] = useState<Framework>('hono')
  const [courseId, setCourseId] = useState(COURSES[0].id)
  const [renaming, setRenaming] = useState<string>()
  const [status, setStatus] = useState('')
  const update = (next: ProjectEntry[]) => {
    setList(next)
    if (!saveProjectList(next)) setStatus('O navegador não deixou salvar: os projetos valem só nesta visita.')
  }

  if (open !== undefined) {
    const entry = list.find((p) => p.id === open)
    if (entry) return <ProjectView key={entry.id} entry={entry} />
    return (
      <p>
        Projeto não encontrado.{' '}
        <a className="levels__map" href={PROJETOS_PATH} onClick={followLink}>
          Ver os projetos
        </a>
      </p>
    )
  }

  const start = (course: string, fw: Framework, projectName: string) => {
    const id = crypto.randomUUID().slice(0, 8)
    const first = courseOf(course).starter
    const base = courseOf(course).blank ? blank(id, fw) : starter(id, fw)
    const created = first ? { ...first, id } : { ...base, files: { ...base.files, ...courseOf(course).baseFiles } }
    saveProject(created)
    update([...list, { id, name: projectName, framework: created.framework, course }])
    setName('')
    navigate(projectPath(id))
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    start(courseId, framework, name.trim() || `Projeto ${list.length + 1}`)
  }

  // First visit: one obvious way in (the course built for beginners, in Hono); the full form stays below for anyone who knows what they want.
  const firstTime = list.length === 0

  const remove = async (entry: ProjectEntry) => {
    if (!confirm(`Apagar o projeto ${entry.name}, com os arquivos e o banco de desenvolvimento dele?`)) return
    removeProject(entry.id)
    forgetClient(entry.id)
    update(list.filter((p) => p.id !== entry.id))
    try {
      await dropDev(entry)
      setStatus(`Projeto ${entry.name} apagado.`)
    } catch (err) {
      setStatus(`Projeto ${entry.name} apagado, mas o banco dele não: ${message(err)}`)
    }
  }

  return (
    <div className="projetos">
      {firstTime && (
        <section className="projetos__start" aria-labelledby="projetos-start">
          <h2 id="projetos-start">Nunca escreveu uma API? Comece por aqui.</h2>
          <p>
            Você começa com um projeto vazio e cada passo diz o que abrir, o que digitar e por quê. Em poucos minutos, a sua primeira rota responde no
            navegador.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => start(COURSES[0].id, 'hono', 'Minha primeira API')}>
            Começar do zero
          </button>
        </section>
      )}

      <form className="projetos__new" onSubmit={create} aria-labelledby="projetos-new">
        <h2 id="projetos-new" className="projeto__label">
          {firstTime ? 'Ou escolha o curso' : 'Novo projeto'}
        </h2>
        <label htmlFor="projetos-name">Nome</label>
        <input id="projetos-name" type="text" value={name} placeholder={`Projeto ${list.length + 1}`} onChange={(e) => setName(e.target.value)} />
        <fieldset className="projetos__framework projetos__choices">
          <legend>Curso</legend>
          {COURSES.map((c) => (
            <label key={c.id}>
              <input type="radio" name="course" value={c.id} checked={courseId === c.id} onChange={() => setCourseId(c.id)} />
              <span>
                {c.title} <span className="projetos__hint">· {c.summary}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {/* A course with its own starter (the code review) fixes the framework. */}
        {!courseOf(courseId).starter && (
          <fieldset className="projetos__framework projetos__choices">
            <legend>Framework</legend>
            {FRAMEWORKS.map(([f, label, hint]) => (
              <label key={f}>
                <input type="radio" name="framework" value={f} checked={framework === f} onChange={() => setFramework(f)} />
                <span>
                  {label} <span className="projetos__hint">· {hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {/* On a first visit "Começar do zero" is the one primary action. */}
        <button type="submit" className={`btn ${firstTime ? 'btn--ghost' : 'btn--primary'}`}>
          Criar projeto
        </button>
      </form>

      <p className="oficina__status" role="status" aria-live="polite">
        {status}
      </p>

      <section aria-labelledby="projetos-list">
        <h2 id="projetos-list" className="projeto__label">
          Seus projetos
        </h2>
        {list.length === 0 ? (
          <p className="oficina__note">Nenhum projeto ainda.</p>
        ) : (
          <ul className="projetos__list">
            {list.map((p) => (
              <li key={p.id}>
                {renaming === p.id ? (
                  <NameForm
                    label={`Novo nome de ${p.name}`}
                    initial={p.name}
                    action="Salvar"
                    submit={(value) => {
                      if (!value) return 'Escreva um nome.'
                      update(list.map((q) => (q.id === p.id ? { ...q, name: value } : q)))
                      setRenaming(undefined)
                    }}
                    onCancel={() => setRenaming(undefined)}
                  />
                ) : (
                  <>
                    <a className="projetos__name" href={projectPath(p.id)} onClick={followLink}>
                      {p.name}
                    </a>
                    <span className="projeto__framework">{frameworkName(p.framework)}</span>
                    <span className="projetos__actions">
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => setRenaming(p.id)} aria-label={`Renomear ${p.name}`}>
                        Renomear
                      </button>
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => remove(p)} aria-label={`Apagar ${p.name}`}>
                        Apagar
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
