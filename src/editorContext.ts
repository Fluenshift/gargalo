import { createContext, useContext } from 'react'
import { useViewportStore } from '@xyflow/react'

/** What custom nodes and edges need from the board to offer removal. */
export interface Editor {
  editable: boolean
  remove: (nodeIds: string[], edgeIds?: string[]) => void
}

export const EditorContext = createContext<Editor>({ editable: false, remove: () => {} })

export const useEditor = () => useContext(EditorContext)

/**
 * How much to scale on-canvas controls so they keep their screen size when the
 * view is zoomed out (a phone fits the whole design at ~30%). Never shrinks them.
 */
export const useControlScale = () => useViewportStore((s) => Math.max(1, 1 / s.transform[2]))
