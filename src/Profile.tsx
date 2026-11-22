import { useEffect, useRef } from 'react'
import { COMPANIES, bossBeaten, stages } from './career'
import type { Passed } from './career'
import { dailyXp, streak } from './daily'
import type { DailyRecord } from './daily'
import { ACHIEVEMENTS, OFICINA_PREFIX, RANKS, achievements, oficinaXp, rankFor, totalXp } from './score'
import type { Results } from './score'

const xp = (n: number) => `${n.toLocaleString('pt-BR')} XP`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The profile page (/perfil): rank and XP, then career, Oficina and daily challenge, then achievements. */
export function Profile({ passed, results, daily, today }: { passed: Passed; results: Results; daily: DailyRecord; today: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const total = totalXp(results) + dailyXp(daily, today)
  const days = Object.values(daily).filter((stars) => stars > 0).length
  const run = streak(daily, today)
  const rank = rankFor(total)
  const earned = new Set(achievements(results))
  const oficina = Object.entries(results).filter(([id]) => id.startsWith(OFICINA_PREFIX))
  const oficinaStars = oficina.reduce((sum, [, r]) => sum + r.stars, 0)
  const all = stages()
  const done = all.filter((s) => results[s.level.id])
  const careerStars = done.reduce((sum, s) => sum + results[s.level.id].stars, 0)
  const bosses = COMPANIES.filter((c) => bossBeaten(c, passed)).length
  const from = RANKS.find((r) => r.title === rank.title)!.xp
  const share = rank.next ? (total - from) / (total - from + rank.next.missing) : 1

  return (
    <main className="page profile-page">
      <section className="profile-page__rank" aria-labelledby="profile-title">
        <p className="page__eyebrow">Perfil · patente</p>
        <h1 id="profile-title" ref={heading} tabIndex={-1}>
          {rank.title}
        </h1>
        <div className="profile-page__xp">
          <span>{xp(total)}</span>
          <div className="profile__bar" role="progressbar" aria-label="Progresso para o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <span className="profile-page__soft">{rank.next ? `Faltam ${xp(rank.next.missing)} para ${rank.next.title}.` : 'Você chegou ao nível mais alto.'}</span>
        </div>
      </section>

      <div className="profile-page__blocks">
        <section className="profile-page__block">
          <h2>Carreira</h2>
          <p className="profile-page__big">
            {done.length} / {all.length}
          </p>
          <p className="profile-page__soft">
            fases · {plural(careerStars, 'estrela', 'estrelas')} · {plural(bosses, 'chefão', 'chefões')}
          </p>
        </section>
        <section className="profile-page__block">
          <h2>Oficina</h2>
          <p className="profile-page__big">{oficina.length}</p>
          <p className="profile-page__soft">
            {oficina.length === 1 ? 'exercício' : 'exercícios'} · {plural(oficinaStars, 'estrela', 'estrelas')} · {xp(oficinaXp(results))}
          </p>
        </section>
        <section className="profile-page__block">
          <h2>Desafio do dia</h2>
          <p className="profile-page__big">{plural(run, 'dia', 'dias')}</p>
          <p className="profile-page__soft">de sequência · {plural(days, 'jogado', 'jogados')}</p>
        </section>
      </div>

      <section className="profile-page__achievements" aria-labelledby="profile-achievements">
        <h2 id="profile-achievements">
          Conquistas <span className="profile-page__soft">{earned.size} de {ACHIEVEMENTS.length}</span>
        </h2>
        <ul className="profile__list">
          {ACHIEVEMENTS.map((a) => (
            <li key={a.id} className={earned.has(a.id) ? 'is-earned' : 'is-locked'}>
              <span className="profile__mark" aria-hidden>
                {earned.has(a.id) ? '✓' : '○'}
              </span>
              <span>
                <strong>{a.title}</strong>
                <span className="profile__desc">{a.description}</span>
                <span className="profile__state">{earned.has(a.id) ? 'Conquistada' : 'Bloqueada'}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
