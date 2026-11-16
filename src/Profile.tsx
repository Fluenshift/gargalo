import { useEffect, useRef } from 'react'
import { ACHIEVEMENTS, RANKS, achievements, rankFor, totalXp } from './score'
import type { Results } from './score'

const xp = (n: number) => `${n.toLocaleString('pt-BR')} XP`

/** Modal with the player's rank, XP and achievements. The native dialog traps focus, closes on Escape and returns focus to the opener. */
export function Profile({ results, onClose }: { results: Results; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const total = totalXp(results)
  const rank = rankFor(total)
  const earned = new Set(achievements(results))
  const from = RANKS.find((r) => r.title === rank.title)!.xp
  const share = rank.next ? (total - from) / (total - from + rank.next.missing) : 1

  return (
    <dialog ref={ref} className="profile" aria-labelledby="profile-title" onClose={onClose} onKeyDown={(e) => e.key === 'Escape' && ref.current?.close()} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <header className="profile__head">
        <h2 id="profile-title">Perfil</h2>
        <button type="button" className="ghost" onClick={() => ref.current?.close()}>
          Fechar
        </button>
      </header>
      <p className="profile__rank">{rank.title}</p>
      <p className="profile__xp">{xp(total)}</p>
      <div className="profile__bar" role="progressbar" aria-label="Progresso para o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <p className="profile__next">{rank.next ? `Faltam ${xp(rank.next.missing)} para ${rank.next.title}.` : 'Você chegou ao nível mais alto.'}</p>

      <h3>
        Conquistas ({earned.size}/{ACHIEVEMENTS.length})
      </h3>
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
    </dialog>
  )
}
