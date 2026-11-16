import type { Node, NodeProps } from '@xyflow/react'
import { REGIONS } from './sim/model'
import type { Region } from './sim/model'

export type RegionAreaNode = Node<{ region: Region; down: boolean }, 'region'>

/** The outline of one region on the canvas, drawn behind the pieces that run in it. */
export function RegionArea({ data }: NodeProps<RegionAreaNode>) {
  return (
    <div className={`region-area${data.down ? ' is-down' : ''}`}>
      <span className="region-area__label">
        {REGIONS[data.region]}
        {data.down && ' · fora do ar'}
      </span>
    </div>
  )
}
