import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Projetos } from './Projetos'
import { TopBar } from './TopBar'
import { PROJETOS_PATH, oficinaPlace } from './route'

/** The place the URL names; old exercise links (`/oficina`, `/oficina/<id>`) are replaced by the projects list. */
function here() {
  if (location.pathname !== PROJETOS_PATH && !location.pathname.startsWith(`${PROJETOS_PATH}/`)) history.replaceState(null, '', PROJETOS_PATH)
  return oficinaPlace(location.pathname)
}

/** The Oficina: the projects (`/oficina/projetos`). */
export default function Oficina() {
  const heading = useRef<HTMLHeadingElement>(null)
  const [place, setPlace] = useState(here)
  useEffect(() => heading.current?.focus(), [])
  useEffect(() => {
    const onPop = () => setPlace(here())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <>
      <TopBar screen="oficina" />
      <div className="career free oficina">
        {/* An open project needs the whole height for the editor and the step beside it: the title stays for screen readers. */}
        <header className={place.project ? 'sr-only' : 'career__head'}>
          <h1 ref={heading} tabIndex={-1}>
            Oficina
          </h1>
          <p className="career__lede">
            Construa uma API do zero, em Hono ou fetch puro: vários arquivos, migrações SQL e um banco Postgres que fica salvo no navegador.
          </p>
        </header>

        <Projetos open={place.project} />
      </div>
    </>
  )
}
