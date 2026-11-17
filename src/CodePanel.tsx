import { useEffect, useId, useRef } from 'react'
import { SPECS } from './sim/model'
import type { CodeChallenge, Link } from './sim/model'

const linkNames = (links: Link[]) =>
  links.flatMap((l) => l.to.map((t) => `${SPECS[l.from].label} → ${SPECS[t].label}`)).join(', ')

/**
 * The code of one endpoint, read-only, and the fixes to choose from. The panel
 * says whether a pick works only after the player makes it, and the pick can change.
 */
export function CodePanel({
  challenge,
  route,
  picked,
  editable,
  onPick,
  onClose,
}: {
  challenge: CodeChallenge
  route: string
  /** Id of the option picked for this challenge, if any. */
  picked: string | undefined
  /** False while a run is playing: the code stays still. */
  editable: boolean
  onPick: (optionId: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const option = challenge.options.find((o) => o.id === picked)

  useEffect(() => titleRef.current?.focus(), [challenge.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="inspector code-panel" aria-labelledby={titleId}>
      <header className="code-panel__head">
        <div>
          <p className="code-panel__route">{route}</p>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {challenge.title}
          </h2>
        </div>
        <button type="button" className="inspector__close" onClick={onClose} aria-label="Fechar código" title="Fechar (Esc)">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </header>

      <section>
        <h3>Código atual</h3>
        <pre className="code" tabIndex={0} aria-label="Código do endpoint, somente leitura">
          {challenge.code}
        </pre>
        {challenge.locks && !option?.fixes && <p className="code-panel__lock">Bloqueado: {linkNames(challenge.locks.links)}</p>}
      </section>

      <fieldset className="fixes" disabled={!editable}>
        <legend>Como corrigir?</legend>
        {challenge.options.map((o) => (
          <label key={o.id} className={`fix${o.id === picked ? ' is-picked' : ''}`}>
            <input type="radio" name={`fix-${challenge.id}`} value={o.id} checked={o.id === picked} onChange={() => onPick(o.id)} />
            <span className="fix__body">
              <span className="fix__label">{o.label}</span>
              <pre className="code code--option">{o.code}</pre>
              <span className="fix__opens">{o.allows ? `Libera: ${linkNames(o.allows)}` : challenge.locks ? 'Não libera nenhuma ligação' : null}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="code-panel__verdict" role="status" aria-live="polite">
        {option && (
          <>
            <h3>{option.fixes ? 'Resolve ✓' : 'Não resolve ✗'}</h3>
            <p>{option.explanation}</p>
            <p className="code-panel__hint">Rode a simulação para ver o efeito no desenho.</p>
          </>
        )}
      </div>
    </aside>
  )
}
