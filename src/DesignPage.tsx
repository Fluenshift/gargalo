import { useEffect, useRef, useState } from 'react'
import './App.css'
import { KindIcon } from './KindIcon'
import { Sparkline } from './Sparkline'
import { TopBar } from './TopBar'

/**
 * Internal reference at /design (or ?design): every token and component, side by
 * side in the light putty sheet and the dark black room. Not linked from the game.
 */

const COLORS: { name: string; use: string }[] = [
  { name: '--paper', use: 'fundo de tudo' },
  { name: '--sunk', use: 'hover, linha pressionada' },
  { name: '--wash', use: 'briefing sem empresa' },
  { name: '--ink', use: 'texto, superfície invertida' },
  { name: '--ink-soft', use: 'texto secundário' },
  { name: '--line', use: 'bordas de 1px' },
  { name: '--grid', use: 'pontos do canvas' },
  { name: '--accent', use: 'a ação primária (cobalto)' },
  { name: '--accent-hover', use: 'hover da ação primária' },
  { name: '--on-accent', use: 'texto na ação primária' },
  { name: '--on-ink', use: 'texto na superfície invertida' },
  { name: '--on-ink-soft', use: 'secundário na invertida' },
  { name: '--ok', use: 'tinta: ok' },
  { name: '--ok-wash', use: 'peça ok' },
  { name: '--warm', use: 'tinta: perto do limite' },
  { name: '--warm-wash', use: 'peça perto do limite' },
  { name: '--hot', use: 'tinta: sobrecarga' },
  { name: '--hot-wash', use: 'peça sobrecarregada' },
  { name: '--company-startup', use: 'linha: Startup' },
  { name: '--company-ecommerce', use: 'linha: E-commerce' },
  { name: '--company-fintech', use: 'linha: Fintech' },
  { name: '--company-streaming', use: 'linha: Streaming' },
  { name: '--code-keyword', use: 'código: palavra-chave' },
  { name: '--code-string', use: 'código: texto' },
  { name: '--code-number', use: 'código: número' },
  { name: '--code-type', use: 'código: tipo' },
  { name: '--code-function', use: 'código: função' },
]

const TEXT = ['--text-label', '--text-xs', '--text-sm', '--text-base', '--text-glyph', '--text-glyph-lg']
const TITLES = ['--title-xs', '--title-sm', '--title-meter-compact', '--title-md', '--title-lg', '--title-xl', '--title-2xl', '--title-4xl']
const SPACES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56].map((n) => `--space-${n}`)
const RADII = ['--radius-pill', '--radius-card', '--radius-piece', '--radius-field', '--radius-field-sm', '--radius-round']
const LAYERS = ['--z-under', '--z-float', '--z-toast', '--z-menu', '--z-sheet']

/** Reads each token's value as resolved inside the given element (so per theme). */
function useTokens(names: string[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const read = () => {
      if (!ref.current) return
      const style = getComputedStyle(ref.current)
      setValues(Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()])))
    }
    read()
    // The page theme can change under a sheet that follows it.
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', read)
    return () => {
      observer.disconnect()
      query.removeEventListener('change', read)
    }
  }, [names])
  return [ref, values] as const
}

const ALL = [...COLORS.map((c) => c.name), ...TEXT, ...TITLES, ...SPACES, ...RADII, ...LAYERS]

function Sheet({ theme }: { theme: 'light' | 'dark' }) {
  const [ref, v] = useTokens(ALL)
  const [segment, setSegment] = useState('2')
  const label = theme === 'light' ? 'Claro: papel massa' : 'Escuro: sala preta'
  return (
    <div ref={ref} className="theme-scope ds-sheet" data-theme={theme}>
      <h2 className="ds-sheet__title">{label}</h2>

      <section className="ds-section" aria-label={`Cores, ${label}`}>
        <h3>Cor</h3>
        <ul className="ds-swatches">
          {COLORS.map((c) => (
            <li key={c.name}>
              <span className="ds-swatch" style={{ background: `var(${c.name})` }} />
              <code>{c.name}</code>
              <span className="ds-muted">{v[c.name]}</span>
              <span className="ds-muted">{c.use}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ds-section" aria-label={`Tipografia, ${label}`}>
        <h3>Tipografia</h3>
        <ul className="ds-rows">
          {TITLES.map((t) => (
            <li key={t}>
              <code>
                {t} · {v[t]}
              </code>
              <span className="ds-serif" style={{ fontSize: `var(${t})` }}>
                Gargalo
              </span>
            </li>
          ))}
          {TEXT.map((t) => (
            <li key={t}>
              <code>
                {t} · {v[t]}
              </code>
              <span style={{ fontSize: `var(${t})` }}>Rodar simulação 1.234 req/s</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ds-section" aria-label={`Espaço e forma, ${label}`}>
        <h3>Espaço</h3>
        <ul className="ds-rows">
          {SPACES.map((s) => (
            <li key={s}>
              <code>{s}</code>
              <span className="ds-bar" style={{ width: `var(${s})` }} />
            </li>
          ))}
        </ul>
        <h3>Raio, sombra e camadas</h3>
        <ul className="ds-radii">
          {RADII.map((r) => (
            <li key={r}>
              <span className="ds-radius" style={{ borderRadius: `var(${r})` }} />
              <code>{r}</code>
              <span className="ds-muted">{v[r]}</span>
            </li>
          ))}
        </ul>
        <p className="ds-muted">
          Sombra: <code>--shadow: none</code>. Camadas: {LAYERS.map((z) => `${z} ${v[z]}`).join(' · ')}
        </p>
      </section>

      <section className="ds-section" aria-label={`Componentes, ${label}`}>
        <h3>Botão</h3>
        <div className="ds-row">
          <button type="button" className="btn btn--primary">
            Rodar simulação
          </button>
          <button type="button" className="btn btn--ghost">
            Recomeçar fase
          </button>
          <button type="button" className="btn btn--ghost btn--small">
            Ver código
          </button>
        </div>
        <div className="ds-row">
          <button type="button" className="btn btn--primary" disabled>
            Desabilitado
          </button>
          <button type="button" className="btn btn--ghost" disabled>
            Desabilitado
          </button>
          <button type="button" className="btn btn--primary" disabled aria-busy="true">
            Simulando 12s de 60s
          </button>
        </div>

        <h3>Abas</h3>
        <div className="segmented" role="group" aria-label="Tentativas">
          {['0', '1', '2', '3'].map((n) => (
            <button key={n} type="button" aria-pressed={segment === n} onClick={() => setSegment(n)}>
              {n}
            </button>
          ))}
        </div>

        <h3>Painel e briefing</h3>
        <p className="brief">Briefing da fase: o único cartão elevado da tela, em --company-wash (ou --wash sem empresa).</p>
        <div className="ds-panel">
          <header className="inspector__head">
            <KindIcon kind="cache" size={30} />
            <div>
              <h2>Cache</h2>
              <p className="inspector__spec">5.000 req/s, $40/mês</p>
            </div>
          </header>
          <div className="ledger">
            <div>
              <h3>Ganha</h3>
              <ul>
                <li>Leituras rápidas</li>
              </ul>
            </div>
            <div>
              <h3>Custa</h3>
              <ul>
                <li>Dados velhos</li>
              </ul>
            </div>
          </div>
        </div>

        <h3>Selo (tabela)</h3>
        <table className="sheet ds-static">
          <caption>
            <span className="sheet__n">Folha 1.2</span>
            <span className="sheet__title">Pico de acessos</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Meta</th>
              <th scope="col">Exigido</th>
              <th scope="col">Medido</th>
            </tr>
          </thead>
          <tbody>
            <tr className="is-ok">
              <th scope="row">Disponibilidade</th>
              <td>≥ 99%</td>
              <td>99,6% ✓</td>
            </tr>
            <tr className="is-fail">
              <th scope="row">Latência p99</th>
              <td>≤ 200 ms</td>
              <td>340 ms ✗</td>
            </tr>
          </tbody>
        </table>

        <h3>Medidor</h3>
        <div className="meters">
          <div className="meter">
            <span className="meter__name">Disponibilidade</span>
            <span className="meter__value">99,6%</span>
            <Sparkline label="Exemplo" values={[1, 0.99, 0.97, 0.995, 1, 0.98]} length={8} goal={0.98} min={0.9} max={1} />
          </div>
          <div className="meter is-bad">
            <span className="meter__name">Latência p99</span>
            <span className="meter__value">340 ms</span>
            <span className="meter__sub">p50 80 ms, p95 210 ms</span>
            <Sparkline label="Exemplo ruim" values={[120, 180, 260, 340, 300]} length={8} goal={200} max={400} />
          </div>
        </div>

        <h3>Peças (estado de carga)</h3>
        <div className="ds-row">
          <div className="node node--client">
            <div className="node__title">
              <KindIcon kind="client" size={18} />
              Usuários
            </div>
            <div className="node__spec">origem do tráfego</div>
          </div>
          {(['ok', 'warm', 'hot', 'down'] as const).map((h) => (
            <div key={h} className={`node heat--${h}`}>
              <div className="node__title">
                <KindIcon kind="server" size={18} />
                Servidor
              </div>
              <div className="node__load">{h === 'down' ? 'Fora do ar' : '480 req/s'}</div>
              {h !== 'down' && (
                <div className="node__bar" aria-hidden>
                  <span style={{ width: h === 'ok' ? '40%' : h === 'warm' ? '82%' : '100%' }} />
                </div>
              )}
              {h === 'hot' && <div className="node__drop">perdendo 12%</div>}
            </div>
          ))}
        </div>

        <h3>Toast</h3>
        <div className="ds-row">
          <div className="toast">
            <span>Servidor removido.</span>
            <button type="button">Desfazer</button>
          </div>
          <div className="toast toast--notice">
            <span>Aviso de várias linhas usa raio de peça.</span>
            <button type="button">Ok</button>
          </div>
        </div>

        <h3>Menu</h3>
        <div className="menu ds-static" role="menu" aria-label="Exemplo de menu">
          <button type="button" role="menuitem">
            Ver conceitos
          </button>
          <button type="button" role="menuitem">
            Remover
          </button>
        </div>

        <h3>Modal</h3>
        <div className="profile ds-static" role="group" aria-label="Exemplo de modal">
          <header className="profile__head">
            <h2>Perfil</h2>
            <button type="button" className="btn btn--ghost">
              Fechar
            </button>
          </header>
          <p className="profile__rank">Pleno</p>
          <div className="profile__bar">
            <span style={{ width: '60%' }} />
          </div>
          <p className="profile__next">Faltam 120 XP para Sênior.</p>
        </div>

        <h3>Código e campos</h3>
        <pre className="code">{'for (const order of orders) {\n  await db.items(order.id)\n}'}</pre>
        <div className="traffic ds-fields">
          <label className="traffic__field">
            Nome
            <input type="text" defaultValue="Loja" />
          </label>
        </div>
      </section>
    </div>
  )
}

export default function DesignPage() {
  useEffect(() => {
    document.title = 'gargalo — design system'
  }, [])
  return (
    <>
    <TopBar screen="design" />
    <div className="ds">
      <header className="career__head ds-head">
        <h1>Design system</h1>
        <p className="career__lede">
          Tokens e componentes nos dois temas. A regra de uso de cada um está em DESIGN.md. O seletor de tema na barra muda o jogo inteiro; as
          duas folhas abaixo ficam fixas.
        </p>
      </header>
      <div className="ds-sheets">
        <Sheet theme="light" />
        <Sheet theme="dark" />
      </div>
    </div>
    </>
  )
}
