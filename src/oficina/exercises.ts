// The Oficina's exercises, in play order; each lives in its own file under exercises/. New ones are appended to EXERCISES.

import type { Exercise } from './exercise'
import { cadastro } from './exercises/cadastro'
import { ola } from './exercises/ola'

/** An exercise plus what the screen shows around it. */
export interface OficinaExercise extends Exercise {
  /** Company of the career it belongs to; the list groups by it. */
  company: string
  /** Route and what it does, e.g. `GET /ola: primeira resposta`. */
  title: string
  statement: string
  /** Code the editor opens with (and "Voltar ao início" restores). */
  starter: string
  /** Shown with the reference once every test passes. */
  explanation: string
}

export const EXERCISES: OficinaExercise[] = [ola, cadastro]
