import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { useControlScale, useEditor } from './editorContext'

/**
 * The × in the middle of a selected link, with the label moved under it. Only this follows the
 * zoom, so zooming re-renders the selected link and not every one.
 */
function SelectedEdge({ id, path, labelX, labelY, label, style, markerEnd, interactionWidth }: { id: string; path: string; labelX: number; labelY: number } & Pick<EdgeProps, 'label' | 'style' | 'markerEnd' | 'interactionWidth'>) {
  const { remove } = useEditor()
  const scale = useControlScale()
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} label={label} labelX={labelX} labelY={labelY + 26 * scale} />
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
    </>
  )
}

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
  const { editable } = useEditor()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  if (selected && editable && deletable !== false)
    return <SelectedEdge id={id} path={path} labelX={labelX} labelY={labelY} label={label} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} label={label} labelX={labelX} labelY={labelY} />
}
