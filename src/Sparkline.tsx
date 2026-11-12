interface Props {
  values: number[]
  length: number
  /** Goal value drawn as a dashed line. */
  goal?: number
  max: number
  min?: number
  label: string
}

const W = 160
const H = 36

export function Sparkline({ values, length, goal, max, min = 0, label }: Props) {
  const y = (v: number) => H - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * H
  const x = (i: number) => (length <= 1 ? 0 : (i / (length - 1)) * W)
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {goal !== undefined && <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} className="spark__goal" />}
      <polyline points={points} className="spark__line" />
    </svg>
  )
}
