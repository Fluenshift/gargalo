import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { useControlScale, useEditor } from './editorContext'
import { KindIcon } from './KindIcon'
import { SPECS } from './sim/model'
import type { Kind } from './sim/model'
import type { NodeStats } from './sim/engine'
import { waitLabel } from './sim/metrics'

export type ComponentNode = Node<{ kind: Kind; stats?: NodeStats }, 'component'>

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')

function heat(stats?: NodeStats): 'idle' | 'ok' | 'warm' | 'hot' | 'down' {
  if (!stats) return 'idle'
  if (stats.down) return 'down'
  if (stats.dropRate > 0.001 || stats.utilization > 0.9) return 'hot'
  if (stats.utilization > 0.7) return 'warm'
  return 'ok'
}

export function NodeCard({ id, data, selected, deletable }: NodeProps<ComponentNode>) {
  const { editable, remove } = useEditor()
  const scale = useControlScale()
  const spec = SPECS[data.kind]
  const { stats } = data
  const state = heat(stats)
  const finite = spec.capacity !== Infinity

  return (
    <div className={`node node--${data.kind} heat--${state}${selected ? ' is-selected' : ''}`}>
      {data.kind !== 'client' && <Handle type="target" position={Position.Left} />}
      <div className="node__title">
        <KindIcon kind={data.kind} size={18} />
        {spec.label}
      </div>
      {stats ? (
        <>
          <div className="node__load">
            {state === 'down' ? 'Fora do ar' : `${fmt(stats.load)} req/s`}
          </div>
          {finite && state !== 'down' && (
            <div className="node__bar" aria-hidden>
              <span style={{ width: `${Math.min(100, stats.utilization * 100)}%` }} />
            </div>
          )}
          {stats.backlog !== undefined && state !== 'down' && (
            <div className="node__queue">
              fila {fmt(stats.backlog)}
              {stats.backlog > 0 && ` · ${waitLabel(stats.waitMs ?? 0)}`}
            </div>
          )}
          {stats.lagMs !== undefined && state !== 'down' && (
            <div className="node__queue">
              atraso {waitLabel(stats.lagMs, 'sem primário')}
              {Number.isFinite(stats.lagMs) && ` · ${Math.round((stats.staleRate ?? 0) * 100)}% velhas`}
            </div>
          )}
          {stats.dropRate > 0.001 && state !== 'down' && (
            <div className="node__drop">perdendo {Math.round(stats.dropRate * 100)}%</div>
          )}
        </>
      ) : (
        <div className="node__spec">
          {finite ? `${fmt(spec.capacity)} req/s` : 'origem do tráfego'}
          {spec.cost > 0 && <span>${spec.cost}/mês</span>}
        </div>
      )}
      {spec.maxOut > 0 && <Handle type="source" position={Position.Right} />}
      {selected && editable && deletable && (
        <button
          type="button"
          className="remove-x node__remove nodrag nopan"
          aria-label={`Remover ${spec.label}`}
          title="Remover"
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => {
            e.stopPropagation()
            remove([id])
          }}
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </div>
  )
}
