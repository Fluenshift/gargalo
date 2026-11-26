import { useState } from 'react'
import { FAILABLE, MAX_ROWS } from './freeMode'
import { parseNumber } from './numbers'
import type { FreeFailure, Spike, Traffic } from './freeMode'
import { SPECS } from './sim/model'
import type { UserClass } from './sim/model'

const CLASSES: [UserClass, string][] = [
  ['static', 'Estáticos'],
  ['read', 'Leituras'],
  ['write', 'Escritas'],
]

/** A number the player types: while it has focus it shows exactly what was typed, and only numbers go up. */
function NumField({
  label,
  value,
  onChange,
  suffix,
  scale = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  suffix?: string
  scale?: number
}) {
  const shown = String(Math.round(value * scale * 10_000) / 10_000)
  const [text, setText] = useState<string | null>(null)
  return (
    <label className="traffic__field">
      <span>{label}</span>
      <span className="traffic__input">
        <input
          type="text"
          inputMode="decimal"
          value={text ?? shown}
          aria-label={label}
          onFocus={() => setText(shown)}
          onBlur={() => setText(null)}
          onChange={(e) => {
            setText(e.target.value)
            const n = parseNumber(e.target.value)
            if (Number.isFinite(n)) onChange(n / scale)
          }}
        />
        {suffix && <span className="traffic__suffix">{suffix}</span>}
      </span>
    </label>
  )
}

/** The system's traffic: rate, mix, hot key, and a list of spikes and failures on the timeline. */
export function TrafficEditor({ traffic, errors, onChange }: { traffic: Traffic; errors: string[]; onChange: (t: Traffic) => void }) {
  const set = (patch: Partial<Traffic>) => onChange({ ...traffic, ...patch })
  const setSpike = (i: number, patch: Partial<Spike>) => set({ spikes: traffic.spikes.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const setFailure = (i: number, patch: Partial<FreeFailure>) => set({ failures: traffic.failures.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const sum = CLASSES.reduce((total, [c]) => total + traffic.mix[c], 0)

  return (
    <section className="traffic" aria-labelledby="traffic-title">
      <h2 id="traffic-title">Tráfego</h2>
      <div className="traffic__row">
        <NumField label="Requisições por segundo" value={traffic.rps} onChange={(rps) => set({ rps })} suffix="req/s" />
        <NumField label="Duração" value={traffic.durationS} onChange={(durationS) => set({ durationS })} suffix="s" />
      </div>

      <fieldset className="traffic__mix">
        <legend>Mistura</legend>
        {CLASSES.map(([c, name]) => (
          <div key={c} className="traffic__slider">
            <label htmlFor={`mix-${c}`}>{name}</label>
            <input
              id={`mix-${c}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.min(100, Math.max(0, Math.round(traffic.mix[c] * 100)))}
              onChange={(e) => set({ mix: { ...traffic.mix, [c]: Number(e.target.value) / 100 } })}
            />
            <span className="traffic__pct">{Math.round(traffic.mix[c] * 1000) / 10}%</span>
          </div>
        ))}
        <p className={`traffic__sum${Math.abs(sum - 1) > 0.001 ? ' is-bad' : ''}`}>Soma: {Math.round(sum * 1000) / 10}%</p>
      </fieldset>

      <NumField label="Chave quente (leituras e escritas no mesmo dado)" value={traffic.hotKey} onChange={(hotKey) => set({ hotKey })} suffix="%" scale={100} />

      <div className="traffic__group">
        <h3>Picos</h3>
        {traffic.spikes.length === 0 && <p className="hint">Sem picos: o tráfego fica no mesmo ritmo.</p>}
        {traffic.spikes.map((s, i) => (
          <div key={i} className="traffic__line">
            <NumField label={`Pico ${i + 1}, início`} value={s.from} onChange={(from) => setSpike(i, { from })} suffix="s" />
            <NumField label={`Pico ${i + 1}, fim`} value={s.to} onChange={(to) => setSpike(i, { to })} suffix="s" />
            <NumField label={`Pico ${i + 1}, req/s`} value={s.rps} onChange={(rps) => setSpike(i, { rps })} />
            <button
              type="button"
              className="traffic__remove"
              aria-label={`Remover pico ${i + 1}`}
              onClick={() => set({ spikes: traffic.spikes.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="levels__map"
          disabled={traffic.spikes.length >= MAX_ROWS}
          onClick={() =>
            set({
              spikes: [
                ...traffic.spikes,
                { from: Math.min(20, Math.max(0, traffic.durationS - 10)), to: Math.min(40, traffic.durationS), rps: Math.round(traffic.rps * 3) },
              ],
            })
          }
        >
          Adicionar pico
        </button>
      </div>

      <div className="traffic__group">
        <h3>Falhas</h3>
        {traffic.failures.length === 0 && <p className="hint">Sem falhas: nenhuma peça cai.</p>}
        {traffic.failures.map((f, i) => (
          <div key={i} className="traffic__line">
            <label className="traffic__field">
              <span>{`Falha ${i + 1}, peça`}</span>
              <select aria-label={`Falha ${i + 1}, peça`} value={f.kind} onChange={(e) => setFailure(i, { kind: e.target.value as FreeFailure['kind'] })}>
                {FAILABLE.map((k) => (
                  <option key={k} value={k}>
                    {SPECS[k].label}
                  </option>
                ))}
              </select>
            </label>
            <NumField label={`Falha ${i + 1}, número da peça`} value={f.index + 1} onChange={(n) => setFailure(i, { index: n - 1 })} />
            <NumField label={`Falha ${i + 1}, início`} value={f.from} onChange={(from) => setFailure(i, { from })} suffix="s" />
            <NumField label={`Falha ${i + 1}, fim`} value={f.to} onChange={(to) => setFailure(i, { to })} suffix="s" />
            <button
              type="button"
              className="traffic__remove"
              aria-label={`Remover falha ${i + 1}`}
              onClick={() => set({ failures: traffic.failures.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="levels__map"
          disabled={traffic.failures.length >= MAX_ROWS}
          onClick={() =>
            set({
              failures: [
                ...traffic.failures,
                { kind: 'server', index: 0, from: Math.min(20, Math.max(0, traffic.durationS - 10)), to: Math.min(40, traffic.durationS) },
              ],
            })
          }
        >
          Adicionar falha
        </button>
      </div>

      {/* Always on the page, so screen readers hear each problem as it appears. */}
      <ul className="traffic__errors" aria-live="polite">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </section>
  )
}
