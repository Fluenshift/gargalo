/** One line of a goals sheet (`.sheet`): the goal, what it requires, what was measured, with a mark when it was judged. */
export function GoalRow({ name, required, value, ok }: { name: string; required?: string; value?: string; ok?: boolean }) {
  const state = value === undefined || ok === undefined ? '' : ok ? 'is-ok' : 'is-fail'
  return (
    <tr className={state}>
      <th scope="row">{name}</th>
      {required !== undefined && <td>{required}</td>}
      <td>
        {value ?? '—'}
        {value !== undefined && ok !== undefined && <span className="sheet__mark">{ok ? ' ✓' : ' ✗'}</span>}
      </td>
    </tr>
  )
}
