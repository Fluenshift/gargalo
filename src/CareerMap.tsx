import { useEffect, useRef } from 'react'
import { BrandMark } from './BrandMark'
import { COMPANIES, bossBeaten, companyOpen, levelStatus } from './career'
import type { Passed, Status } from './career'
import { KindIcon } from './KindIcon'
import { LockIcon } from './LockIcon'
import { Stars } from './Stars'
import type { Results } from './score'
import { SPECS } from './sim/model'

const STATUS_TEXT: Record<Status, string> = { done: 'Concluída', open: 'Aberta', locked: 'Bloqueada' }

/** Companies drawn as a row of title blocks, joined by the promotion between them. */
export function CareerMap({
  passed,
  results,
  current,
  onPlay,
  onClose,
  onProfile,
}: {
  passed: Passed
  results: Results
  current: string
  onPlay: (levelId: string) => void
  onClose: () => void
  onProfile: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const last = COMPANIES[COMPANIES.length - 1]

  return (
    <div className="career">
      <header className="career__head">
        <p className="career__brand">
          <BrandMark size={28} />
          gargalo
        </p>
        <h1 ref={heading} tabIndex={-1}>
          Mapa da carreira
        </h1>
        <p className="career__lede">
          Cada empresa é um capítulo. Passe pelas fases, enfrente o chefão e seja promovido para uma empresa maior, com
          peças novas.
        </p>
        <div className="career__actions">
          <button type="button" className="ghost" onClick={onProfile}>
            Perfil
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Voltar para a fase
          </button>
        </div>
      </header>

      <ol className="career__track">
        {COMPANIES.map((company, ci) => {
          const open = companyOpen(ci, passed)
          const beaten = bossBeaten(company, passed)
          const stages = [...company.levels, company.boss]
          return (
            <li key={company.id} className={`company${open ? '' : ' is-locked'}`}>
              <section aria-labelledby={`company-${company.id}`}>
                <header className="company__head">
                  <h2 id={`company-${company.id}`}>
                    <span className="company__n">Empresa {ci + 1}</span>
                    <span className="company__name">{company.name}</span>
                  </h2>
                  <span className="company__state">
                    {beaten ? 'Promovido' : open ? 'Em andamento' : 'Bloqueada'}
                  </span>
                </header>
                <p className="company__budget">{company.budget}</p>

                <ol className="company__levels">
                  {stages.map((l, i) => {
                    const status = levelStatus(l.id, passed)
                    const isBoss = l === company.boss
                    const isCurrent = l.id === current
                    return (
                      <li key={l.id} className={isBoss ? 'is-boss' : undefined}>
                        <button
                          type="button"
                          className={`step step--${status}${isCurrent ? ' is-current' : ''}`}
                          disabled={status === 'locked'}
                          aria-current={isCurrent ? 'step' : undefined}
                          onClick={() => onPlay(l.id)}
                        >
                          <span className="step__n">{i + 1}</span>
                          <span className="step__title">
                            {l.title}
                            {isBoss && <span className="levels__boss">Chefão</span>}
                          </span>
                          <span className="step__status">
                            {status === 'done' && <span className="tick" aria-hidden>✓</span>}
                            {results[l.id] && <Stars count={results[l.id].stars} />}
                            {status === 'locked' && <LockIcon />}
                            {STATUS_TEXT[status]}
                          </span>
                          {status === 'locked' && (
                            <span className="step__why">
                              {!open
                                ? 'Abre quando você for promovido para esta empresa.'
                                : isBoss
                                  ? 'Conclua as fases acima para enfrentar o chefão.'
                                  : 'Conclua a fase anterior.'}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ol>

                <div className="company__pieces">
                  <h3>Peças liberadas</h3>
                  <ul>
                    {company.unlocks.map((kind) => (
                      <li key={kind}>
                        <KindIcon kind={kind} size={18} />
                        {SPECS[kind].label}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </li>
          )
        })}

        <li className="company is-future">
          <section aria-labelledby="company-next">
            <header className="company__head">
              <h2 id="company-next">
                <span className="company__n">Empresa {COMPANIES.length + 1}</span>
                <span className="company__name">Próxima empresa</span>
              </h2>
              <span className="company__state">
                <LockIcon /> Bloqueada
              </span>
            </header>
            <p className="company__budget">
              {bossBeaten(last, passed)
                ? `Você venceu o chefão. A próxima empresa ainda está sendo desenhada.`
                : `Vença o chefão, ${last.boss.title}, para ser promovido. A próxima empresa ainda está sendo desenhada.`}
            </p>
          </section>
        </li>
      </ol>
    </div>
  )
}
