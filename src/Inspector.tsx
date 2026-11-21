import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { escapeFor } from './keys'
import { CONCEPTS, splitTerms } from './concepts'
import type { GlossaryEntry } from './concepts'
import { KindIcon } from './KindIcon'
import { REGIONS, SPECS, endpointsOf } from './sim/model'
import type { Balance, Kind, Level, Region } from './sim/model'

const fmt = (n: number) => n.toLocaleString('pt-BR')

const BALANCES: { id: Balance; label: string; hint: string }[] = [
  { id: 'round-robin', label: 'Round robin', hint: 'Um de cada vez, na ordem: todos recebem a mesma parte.' },
  { id: 'least-conn', label: 'Menos conexões', hint: 'Cada servidor recebe na medida do que aguenta.' },
  { id: 'hash', label: 'Hash consistente', hint: 'A mesma chave vai sempre ao mesmo servidor; se um cai, só as chaves dele mudam.' },
]

/**
 * What a piece is, when to use it and what it trades. `children` render at the
 * end, under "Nesta simulação", for per-piece run metrics.
 */
export function Inspector({
  kind,
  level,
  onClose,
  focusOnOpen = false,
  escapeCloses = true,
  children,
  region,
  fixes,
  onOpenCode,
  balance,
  capacity,
  code,
  links,
}: {
  kind: Kind
  /** The level on screen: a server lists its routes. */
  level?: Level
  onClose: () => void
  /** Move focus to the panel when it opens or changes piece (opened from the parts list). */
  focusOnOpen?: boolean
  /** False while something above the panel (a menu) owns Escape. */
  escapeCloses?: boolean
  children?: ReactNode
  /** Picks made for the level's code challenges (challenge id to option id). */
  fixes?: Record<string, string>
  /** Opens the code of a challenge; absent where the level has none. */
  onOpenCode?: (challengeId: string) => void
  /** How this balancer divides: chosen when the code allows it, `forced` (read-only) when the code decides. */
  balance?: { value: Balance; forced: boolean; editable: boolean; onChange: (b: Balance) => void }
  /** What this very piece handles, when the level makes it differ from its kind. */
  capacity?: number
  /** The code this server runs, written from its links. */
  code?: string
  /** Regions to choose from for the selected piece; absent on single-region levels and for global pieces. */
  region?: { value: Region; choices: Region[]; editable: boolean; onChange: (r: Region) => void }
  /** Pieces the selected one can link to: the way to draw a link without dragging (keyboard, screen readers). */
  links?: { targets: { id: string; label: string }[]; editable: boolean; onLink: (targetId: string) => void }
}) {
  const spec = SPECS[kind]
  const concept = CONCEPTS[kind]
  const titleId = useId()
  const defId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const [term, setTerm] = useState<GlossaryEntry | null>(null)
  const [linkTo, setLinkTo] = useState('')
  // The pick stays while it can still be linked; otherwise the first piece that can.
  const chosen = links?.targets.some((t) => t.id === linkTo) ? linkTo : (links?.targets[0]?.id ?? '')
  const [termKind, setTermKind] = useState(kind)
  // A definition belongs to the piece it was opened on.
  if (termKind !== kind) {
    setTermKind(kind)
    setTerm(null)
  }

  useEffect(() => {
    if (focusOnOpen) titleRef.current?.focus()
  }, [kind, focusOnOpen])

  useEffect(() => {
    if (!escapeCloses) return
    const onKey = (e: KeyboardEvent) => {
      if (!escapeFor(e, rootRef.current)) return
      e.preventDefault()
      if (term) setTerm(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escapeCloses, term, onClose])

  // Each glossary term is linked once per panel, in reading order.
  const seen = new Set<string>()
  const rich = (text: string) =>
    splitTerms(text, seen).map((s, i) =>
      typeof s === 'string' ? (
        s
      ) : (
        <button
          key={i}
          type="button"
          className={`term${term?.id === s.entry.id ? ' is-open' : ''}`}
          aria-expanded={term?.id === s.entry.id}
          aria-controls={defId}
          onClick={() => setTerm((t) => (t?.id === s.entry.id ? null : s.entry))}
        >
          {s.text}
        </button>
      ),
    )

  const finite = spec.capacity !== Infinity
  const shownCapacity = capacity ?? spec.capacity

  return (
    <aside ref={rootRef} className="inspector" aria-labelledby={titleId}>
      <header className="inspector__head">
        <KindIcon kind={kind} size={30} />
        <div>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {spec.label}
          </h2>
          <p className="inspector__spec">
            {!finite
              ? 'Origem do tráfego'
              : spec.external
                ? `${fmt(shownCapacity)} req/s, ${spec.baseLatencyMs} ms, de outra empresa`
                : `${fmt(shownCapacity)} req/s, ${spec.baseLatencyMs} ms, $${spec.cost}/mês${shownCapacity !== spec.capacity ? ' · máquina antiga' : ''}`}
          </p>
        </div>
        <button type="button" className="inspector__close" onClick={onClose} aria-label="Fechar painel" title="Fechar (Esc)">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </header>

      {region && (
        <section>
          <h3 id={`${titleId}-region`}>Região</h3>
          <div className="segmented" role="group" aria-labelledby={`${titleId}-region`}>
            {region.choices.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={region.value === r}
                disabled={!region.editable}
                onClick={() => region.onChange(r)}
              >
                {REGIONS[r]}
              </button>
            ))}
          </div>
        </section>
      )}

      {balance && (
        <section>
          <h3 id={`${titleId}-balance`}>Como divide</h3>
          {balance.forced ? (
            <p className="inspector__note">
              Dividido pelo código: o velho recebe metade. Para escolher o algoritmo, troque a correção no código.
            </p>
          ) : (
            <>
              <div className="segmented segmented--wrap" role="group" aria-labelledby={`${titleId}-balance`}>
                {BALANCES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={balance.value === b.id}
                    disabled={!balance.editable}
                    onClick={() => balance.onChange(b.id)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <p className="inspector__note">{BALANCES.find((b) => b.id === balance.value)?.hint}</p>
            </>
          )}
        </section>
      )}

      {links && (
        <section>
          <h3 id={`${titleId}-links`}>Ligar a</h3>
          {links.targets.length > 0 ? (
            <form
              className="link-to"
              onSubmit={(e) => {
                e.preventDefault()
                if (chosen) links.onLink(chosen)
              }}
            >
              <select aria-labelledby={`${titleId}-links`} value={chosen} disabled={!links.editable} onChange={(e) => setLinkTo(e.target.value)}>
                {links.targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn--ghost btn--small" disabled={!links.editable}>
                Ligar
              </button>
            </form>
          ) : (
            <p className="inspector__note">Nenhuma peça do desenho aceita uma ligação desta agora.</p>
          )}
        </section>
      )}

      {kind === 'server' && level && (
        <section>
          <h3 id={`${titleId}-routes`}>Endpoints</h3>
          <table className="routes" aria-labelledby={`${titleId}-routes`}>
            <thead>
              <tr>
                <th scope="col">Tráfego</th>
                <th scope="col">CPU</th>
                <th scope="col">Consultas</th>
                <th scope="col">Resposta</th>
              </tr>
            </thead>
            {endpointsOf(level).map((e) => {
              const challenge = onOpenCode ? level.code?.find((c) => c.class === e.class) : undefined
              const fixed = challenge?.options.find((o) => o.id === fixes?.[challenge.id])?.fixes === true
              return (
              <tbody key={e.class}>
                <tr>
                  <th scope="rowgroup" colSpan={4} className="routes__route">
                    {e.route}
                  </th>
                </tr>
                <tr>
                  <td>{Math.round(e.share * 1000) / 10}%</td>
                  <td>{e.cpuMs} ms</td>
                  <td>{e.queries}</td>
                  <td>{e.responseKb} kB</td>
                </tr>
                {challenge && (
                  <tr>
                    <td colSpan={4} className="routes__code">
                      <span className="routes__flag">{fixed ? 'código corrigido' : 'código com problema'}</span>
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => onOpenCode?.(challenge.id)}>
                        Ver código
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
              )
            })}
          </table>
        </section>
      )}

      {code && (
        <section>
          <h3>Código deste servidor</h3>
          <pre className="code code--wrap" tabIndex={0} aria-label="Código do servidor, escrito a partir das ligações, somente leitura">
            {code}
          </pre>
          <p className="inspector__note">Muda quando você liga, tira ou ajusta uma ligação deste servidor.</p>
        </section>
      )}

      <section>
        <h3>O que é</h3>
        <p>{rich(concept.whatIs)}</p>
      </section>

      <section>
        <h3>Quando usar</h3>
        <p>{rich(concept.whenToUse)}</p>
      </section>

      <section className="ledger" aria-label="Tradeoffs">
        <div>
          <h3>Ganha</h3>
          <ul>
            {concept.gains.map((t) => (
              <li key={t}>{rich(t)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Paga</h3>
          <ul>
            {concept.costs.map((t) => (
              <li key={t}>{rich(t)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h3>Erros comuns</h3>
        <ul className="mistakes">
          {concept.mistakes.map((t) => (
            <li key={t}>{rich(t)}</li>
          ))}
        </ul>
      </section>

      {children && (
        <section className="inspector__run">
          <h3>Nesta simulação</h3>
          {children}
        </section>
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
