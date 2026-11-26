import { useEffect, useRef } from 'react'
import { COMPANIES, bossBeaten, companyOpen, findStage, levelStatus, stages } from './career'
import type { Passed, Status } from './career'
import { KindIcon } from './KindIcon'
import { LockIcon } from './LockIcon'
import { Stars } from './Stars'
import type { Results } from './score'
import { SPECS } from './sim/model'

const STATUS_TEXT: Record<Status, string> = { done: 'Feita', open: 'Aberta', locked: 'Trancada' }

/** The career page (/carreira): each company a section, each phase a card; the primary action resumes the current phase. */
export function CareerMap({ passed, results, current, onPlay }: { passed: Passed; results: Results; current: string; onPlay: (levelId: string) => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const last = COMPANIES[COMPANIES.length - 1]
  const resume = findStage(current)?.level

  return (
    <main className="page career-page">
      <header className="page__head">
        <div>
          <p className="page__eyebrow">
            Modo carreira · {COMPANIES.length} empresas · {stages().length} fases
          </p>
          <h1 ref={heading} tabIndex={-1}>
            Carreira
          </h1>
          <p className="page__lede">
            Cada empresa é um capítulo. Passe pelas fases, enfrente o chefão e seja promovido para uma empresa maior, com peças novas.
          </p>
        </div>
        {resume && (
          <button type="button" className="btn btn--primary" onClick={() => onPlay(resume.id)}>
            Continuar: {resume.title}
          </button>
        )}
      </header>

      {COMPANIES.map((company, ci) => {
        const open = companyOpen(ci, passed)
        const beaten = bossBeaten(company, passed)
        return (
          <section key={company.id} className={`career-co${open ? '' : ' is-locked'}`} aria-labelledby={`company-${company.id}`} data-company={company.id}>
            <header className="career-co__head">
              <p className="page__eyebrow">Empresa {ci + 1}</p>
              <h2 id={`company-${company.id}`}>{company.name}</h2>
              <span className="career-co__state">{beaten ? 'Promovido' : open ? 'Em andamento' : 'Bloqueada'}</span>
            </header>
            <p className="career-co__budget">{company.budget}</p>

            <ol className="career-co__cards">
              {[...company.levels, company.boss].map((l, i) => {
                const status = levelStatus(l.id, passed)
                const isBoss = l === company.boss
                const isNow = l.id === current
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      className={`phase-card phase-card--${status}${isNow ? ' is-now' : ''}${isBoss ? ' is-boss' : ''}`}
                      disabled={status === 'locked'}
                      aria-current={isNow ? 'step' : undefined}
                      onClick={() => onPlay(l.id)}
                    >
                      <span className="phase-card__tag">
                        {isBoss ? 'Chefão' : `Fase ${i + 1}`} · {isNow ? 'Agora' : STATUS_TEXT[status]}
                        {status === 'locked' && <LockIcon />}
                      </span>
                      <span className="phase-card__title">{l.title}</span>
                      <span className="phase-card__mark">
                        {results[l.id] ? (
                          <>
                            <span className="tick" aria-hidden>
                              ✓
                            </span>
                            <Stars count={results[l.id].stars} />
                          </>
                        ) : status === 'locked' ? (
                          !open ? (
                            'Abre quando você for promovido para esta empresa.'
                          ) : isBoss ? (
                            'Conclua as fases acima para enfrentar o chefão.'
                          ) : (
                            'Conclua a fase anterior.'
                          )
                        ) : (
                          'Jogar →'
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>

            <div className="career-co__pieces">
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
        )
      })}

      <section className="career-co is-locked" aria-labelledby="company-next">
        <header className="career-co__head">
          <p className="page__eyebrow">Empresa {COMPANIES.length + 1}</p>
          <h2 id="company-next">Próxima empresa</h2>
          <span className="career-co__state">
            <LockIcon /> Bloqueada
          </span>
        </header>
        <p className="career-co__budget">
          {bossBeaten(last, passed)
            ? 'Você venceu o chefão. A próxima empresa ainda está sendo desenhada.'
            : `Vença o chefão, ${last.boss.title}, para ser promovido. A próxima empresa ainda está sendo desenhada.`}
        </p>
      </section>
    </main>
  )
}
