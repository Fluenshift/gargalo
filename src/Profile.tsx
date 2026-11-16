import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { ACHIEVEMENTS, RANKS, achievements, rankFor, totalXp } from './score'
import type { Results } from './score'

const xp = (n: number) => `${n.toLocaleString('pt-BR')} XP`

/** Modal with the player's rank, XP and achievements, on Astryx Dialog (focus trap, Escape and focus return come from the library). */
export function Profile({ results, onClose }: { results: Results; onClose: () => void }) {
  const total = totalXp(results)
  const rank = rankFor(total)
  const earned = new Set(achievements(results))
  const from = RANKS.find((r) => r.title === rank.title)!.xp
  const share = rank.next ? (total - from) / (total - from + rank.next.missing) : 1

  return (
    <Dialog isOpen purpose="info" width={480} onOpenChange={(open) => !open && onClose()}>
      <DialogHeader title="Perfil" onOpenChange={(open) => !open && onClose()} />
      <p className="profile__rank">{rank.title}</p>
      <p className="profile__xp">{xp(total)}</p>
      <ProgressBar label="Progresso para o próximo nível" isLabelHidden value={Math.round(share * 100)} max={100} />
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
    </Dialog>
  )
}
