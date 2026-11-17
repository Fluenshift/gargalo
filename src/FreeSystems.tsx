import { ThemeToggle } from './ThemeToggle'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from './BrandMark'
import { TEMPLATES, exportFileName, exportSystem } from './freeMode'
import type { FreeSystem } from './freeMode'

const rpsText = (s: FreeSystem) => `${s.traffic.rps.toLocaleString('pt-BR')} req/s · ${s.traffic.durationS}s`

/** Hands the text to the browser as a file to save. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FreeSystems({
  systems,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onImport,
  onClose,
}: {
  systems: FreeSystem[]
  onOpen: (id: string) => void
  /** A blank system, or one from a template. */
  onCreate: (templateId?: string) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  /** Adds the file's system; returns why not when the file is refused. */
  onImport: (text: string) => string | null
  onClose: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const commitRename = () => {
    if (renaming && renaming.text.trim()) onRename(renaming.id, renaming.text)
    setRenaming(null)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const error = onImport(await file.text())
      setMessage(error ? { tone: 'error', text: error } : { tone: 'ok', text: `Sistema importado de ${file.name}.` })
    } catch {
      setMessage({ tone: 'error', text: 'Não foi possível ler o arquivo.' })
    }
    // The same file can be picked again.
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="career free">
      <header className="career__head">
        <p className="career__brand">
          <BrandMark size={28} />
          gargalo
        </p>
        <h1 ref={heading} tabIndex={-1}>
          Modo livre
        </h1>
        <p className="career__lede">
          Monte o sistema que quiser, defina o tráfego e rode a simulação. Sem metas: o selo mostra só o que foi medido. Cada sistema fica
          salvo aqui neste navegador.
        </p>
        <div className="career__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onCreate()}>
            Novo sistema em branco
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
            Importar JSON
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Arquivo do sistema" onChange={(e) => importFile(e.target.files?.[0])} />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Voltar para a fase
          </button>
        </div>
        <ThemeToggle />
      </header>

      <p className={`free__message${message ? ` is-${message.tone}` : ''}`} role="status" aria-live="polite">
        {message?.text}
      </p>

      <section className="free__section" aria-labelledby="free-mine">
        <h2 id="free-mine">Meus sistemas</h2>
        {systems.length === 0 ? (
          <p className="hint">Nenhum sistema ainda. Comece por um ponto de partida abaixo ou por um desenho em branco.</p>
        ) : (
          <ul className="free__list">
            {systems.map((s) => (
              <li key={s.id} className="free__card">
                {renaming?.id === s.id ? (
                  <form
                    className="free__rename"
                    onSubmit={(e) => {
                      e.preventDefault()
                      commitRename()
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Novo nome do sistema"
                      value={renaming.text}
                      maxLength={60}
                      onChange={(e) => setRenaming({ id: s.id, text: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    />
                    <button type="submit" className="levels__map" disabled={!renaming.text.trim()}>
                      Salvar nome
                    </button>
                    <button type="button" className="levels__map" onClick={() => setRenaming(null)}>
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <h3>{s.name}</h3>
                )}
                <p className="free__meta">{rpsText(s)}</p>
                {s.question && <p className="hint">{s.question}</p>}
                {confirming === s.id ? (
                  <div className="free__confirm" role="alert">
                    <p>Apagar “{s.name}”? Não dá para desfazer.</p>
                    <button
                      type="button"
                      className="levels__map"
                      onClick={() => {
                        setConfirming(null)
                        onDelete(s.id)
                      }}
                    >
                      Sim, apagar
                    </button>
                    <button type="button" className="levels__map" autoFocus onClick={() => setConfirming(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="free__actions">
                    <button type="button" className="btn btn--ghost" onClick={() => onOpen(s.id)}>
                      Abrir
                    </button>
                    <button type="button" className="levels__map" onClick={() => setRenaming({ id: s.id, text: s.name })}>
                      Renomear
                    </button>
                    <button type="button" className="levels__map" onClick={() => onDuplicate(s.id)}>
                      Duplicar
                    </button>
                    <button
                      type="button"
                      className="levels__map"
                      onClick={() => {
                        download(exportFileName(s), exportSystem(s))
                        setMessage({ tone: 'ok', text: `Arquivo ${exportFileName(s)} gerado.` })
                      }}
                    >
                      Exportar
                    </button>
                    <button type="button" className="levels__map" onClick={() => setConfirming(s.id)}>
                      Apagar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="free__section" aria-labelledby="free-templates">
        <h2 id="free-templates">Pontos de partida</h2>
        <ul className="free__list">
          {TEMPLATES.map((t) => (
            <li key={t.id} className="free__card">
              <h3>{t.name}</h3>
              <p className="free__meta">{rpsText({ traffic: t.traffic } as FreeSystem)}</p>
              <p>{t.about}</p>
              <p className="hint">{t.question}</p>
              <div className="free__actions">
                <button type="button" className="btn btn--ghost" onClick={() => onCreate(t.id)}>
                  Criar a partir deste
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
