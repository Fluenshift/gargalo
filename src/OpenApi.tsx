import { useMemo, useState } from 'react'
import { loadClient } from './oficina/projeto/http'
import { buildOpenApi, requestsOf, stringify } from './oficina/projeto/openapi'
import type { Project } from './oficina/projeto/project'
import type { Route } from './oficina/projeto/runtime'

/** The project's generated OpenAPI: the operations as a list, the JSON as is, and a download. Reads the HTTP client's history when it opens. */
export function OpenApi({ project, name, routes }: { project: Project; name: string; routes?: Route[] }) {
  const [view, setView] = useState<'lista' | 'json'>('lista')
  const doc = useMemo(() => {
    const { history, saved } = loadClient(project.id)
    return buildOpenApi({ title: name, routes, requests: requestsOf(history, saved) })
  }, [project.id, name, routes])
  const json = stringify(doc)
  const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method, statuses: Object.keys(op.responses) })),
  )

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'openapi.json' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="projeto__slot">
      <div className="projeto__get">
        <div className="segmented segmented--small" role="group" aria-label="Formato do OpenAPI">
          <button type="button" aria-pressed={view === 'lista'} onClick={() => setView('lista')}>
            Lista
          </button>
          <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>
            JSON
          </button>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={download}>
          Baixar openapi.json
        </button>
      </div>
      {operations.length === 0 ? (
        <p className="oficina__note">Nenhuma rota ainda. Envie uma requisição na aba Requisição e o documento aparece aqui.</p>
      ) : view === 'json' ? (
        <pre className="oficina__note" tabIndex={0} aria-label="Documento OpenAPI em JSON">
          {json}
        </pre>
      ) : (
        <ul className="oficina__note" aria-label="Operações">
          {operations.map((o) => (
            <li key={`${o.method} ${o.path}`}>
              <b>{o.method.toUpperCase()}</b> {o.path} · {o.statuses.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
