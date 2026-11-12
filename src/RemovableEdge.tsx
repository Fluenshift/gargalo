import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { useControlScale, useEditor } from './editorContext'

/** The default bezier edge, plus a remove button at its middle while selected. */
export function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  deletable,
  label,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const { editable, remove } = useEditor()
  const scale = useControlScale()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const showRemove = selected && editable && deletable !== false

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        label={label}
        labelX={labelX}
        labelY={showRemove ? labelY + 26 * scale : labelY}
      />
      {showRemove && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="remove-x edge__remove nodrag nopan"
            style={{
              transformOrigin: '0 0',
              transform: `translate(${labelX}px, ${labelY}px) scale(${scale}) translate(-50%, -50%)`,
            }}
            aria-label="Remover ligação"
            title="Remover"
            onClick={(e) => {
              e.stopPropagation()
              remove([], [id])
            }}
          >
            <span aria-hidden>×</span>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
