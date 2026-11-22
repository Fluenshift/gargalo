// The guided course a project follows in its Etapa panel.

import { cursoBanco } from './cursoBanco'
import { cursoBusca } from './cursoBusca'
import { cursoPedidos } from './cursoPedidos'
import { revisaoCourse } from './revisao'
import type { ProjectCourse } from './stage'

/** The courses a project can follow; add a new one here. */
export const COURSES: ProjectCourse[] = [cursoPedidos, cursoBanco, cursoBusca, revisaoCourse]

/** Projects saved before there was a choice have no course: they follow the orders API. */
export const courseOf = (id: string | undefined) => COURSES.find((c) => c.id === id) ?? cursoPedidos
