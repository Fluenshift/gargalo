import { useEffect, useId, useState } from 'react'
import { GLOSSARY } from './concepts'
import type { GlossaryEntry } from './concepts'
import { MAX_RETRIES, PROTOCOLS, SPECS, protocolRefusal } from './sim/model'
import type { ArchEdge, Kind, Protocol } from './sim/model'

/** How a link calls its target: what the player can set on a selected connection. */
export type LinkPolicy = Pick<ArchEdge, 'retries' | 'backoff' | 'breaker' | 'idempotent' | 'protocol'>

const PROTOCOL_IDS = Object.keys(PROTOCOLS) as Protocol[]
const PROTOCOL_ENTRIES = Object.fromEntries(PROTOCOL_IDS.map((p) => [p, GLOSSARY.find((e) => e.id === p)!])) as Record<Protocol, GlossaryEntry>

const RETRY_CHOICES = Array.from({ length: MAX_RETRIES + 1 }, (_, i) => i)

/** Settings of one selected link, docked where the concepts panel goes. */
export function LinkPanel({
  from,
  to,
  fromKind,
  toKind,
  policy,
  state,
  editable,
  onChange,
  onClose,
}: {
  /** Names of the pieces at each end. */
  from: string
  to: string
  /** Kinds of the pieces at each end: they decide which protocols the link can speak. */
  fromKind: Kind
  toKind: Kind
  policy: LinkPolicy
  /** The breaker at the second on screen, if a run is showing. */
  state?: 'closed' | 'open' | 'half-open'
  editable: boolean
  onChange: (policy: LinkPolicy) => void
  onClose: () => void
}) {
  const titleId = useId()
  const retries = policy.retries ?? 0
  const defId = `${titleId}-def`
  const protocol = policy.protocol ?? 'rest'
  const [term, setTerm] = useState<GlossaryEntry | null>(null)
  // A definition belongs to the link it was opened on.
  const linkKey = `${fromKind}->${toKind}`
  const [termLink, setTermLink] = useState(linkKey)
  if (termLink !== linkKey) {
    setTermLink(linkKey)
    setTerm(null)
  }
  const refusals = PROTOCOL_IDS.flatMap((p) => {
    const why = protocolRefusal(fromKind, toKind, p)
    return why ? [{ p, why }] : []
  })
  const setProtocol = (p: Protocol) => {
    const { protocol: _old, ...rest } = policy
    onChange(p === 'rest' ? rest : { ...rest, protocol: p })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (term) setTerm(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [term, onClose])

  return (
    <aside className="inspector link-panel" aria-labelledby={titleId}>
      <header className="inspector__head">
        <svg className="kind-icon" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <circle cx="5" cy="12" r="2.5" />
          <circle cx="19" cy="12" r="2.5" />
          <path d="M7.5 12h9" />
        </svg>
        <div>
          <h2 id={titleId}>Ligação</h2>
          <p className="inspector__spec">
            {from} para {to}
          </p>
        </div>
        <button type="button" className="inspector__close" onClick={onClose} aria-label="Fechar painel" title="Fechar (Esc)">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </header>

      {SPECS[toKind].api && (
        <section>
          <h3 id={`${titleId}-protocol`}>Protocolo</h3>
          <p>{PROTOCOLS[protocol].description}</p>
          <div className="segmented" role="group" aria-labelledby={`${titleId}-protocol`}>
            {PROTOCOL_IDS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={protocol === p}
                disabled={!editable || protocolRefusal(fromKind, toKind, p) !== null}
                onClick={() => setProtocol(p)}
              >
                {PROTOCOLS[p].label}
              </button>
            ))}
          </div>
          {refusals.map(({ p, why }) => (
            <p key={p} className="link-panel__why">
              {why}
            </p>
          ))}
          <p className="link-panel__learn">
            Entenda:{' '}
            {PROTOCOL_IDS.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className={`term${term?.id === p ? ' is-open' : ''}`}
                  aria-expanded={term?.id === p}
                  aria-controls={defId}
                  onClick={() => setTerm((t) => (t?.id === p ? null : PROTOCOL_ENTRIES[p]))}
                >
                  {PROTOCOLS[p].label}
                </button>
              </span>
            ))}
          </p>
        </section>
      )}

      <section>
        <h3 id={`${titleId}-retries`}>Tentativas extras</h3>
        <p>Quando uma chamada falha, tenta de novo. Ajuda em falhas passageiras; num destino sobrecarregado, multiplica a carga dele.</p>
        <div className="segmented" role="group" aria-labelledby={`${titleId}-retries`}>
          {RETRY_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={retries === n}
              disabled={!editable}
              onClick={() => onChange({ ...policy, retries: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <label className="toggle">
        <input
          type="checkbox"
          checked={policy.backoff ?? false}
          disabled={!editable || retries === 0}
          onChange={(e) => onChange({ ...policy, backoff: e.target.checked })}
        />
        <span>
          <strong>Backoff com jitter</strong>
          Cada nova tentativa espera mais, com um sorteio, em vez de todas chegarem no mesmo segundo.
        </span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={policy.breaker ?? false}
          disabled={!editable}
          onChange={(e) => onChange({ ...policy, breaker: e.target.checked })}
        />
        <span>
          <strong>Circuit breaker</strong>
          Se mais da metade das chamadas falha, para de chamar por 5 s e falha na hora. Depois deixa passar 10% para testar.
        </span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={policy.idempotent ?? false}
          disabled={!editable}
          onChange={(e) => onChange({ ...policy, idempotent: e.target.checked })}
        />
        <span>
          <strong>Chave de idempotência</strong>
          Cada chamada leva um código. Se a resposta se perde e a tentativa se repete, o destino reconhece o código e não executa de novo: sem ela, uma escrita pode sair duas vezes.
        </span>
      </label>

      {state && state !== 'closed' && (
        <p className="link-panel__state" role="status">
          {state === 'open'
            ? 'Neste segundo o breaker está aberto: as chamadas falham na hora e o destino se recupera.'
            : 'Neste segundo o breaker está meio aberto: só 10% das chamadas passam, para testar o destino.'}
        </p>
      )}

      <div id={defId} className="definition" role="region" aria-live="polite" aria-label="Definição">
        {term && (
          <>
            <p>
              <dfn>{term.term}</dfn> {term.definition}
            </p>
            <button type="button" className="definition__close" onClick={() => setTerm(null)} aria-label="Fechar definição">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
