# gargalo

A browser game for learning system design: the player wires pieces (CDN, load balancer, servers, cache, database…) on a canvas and a simulation scores the architecture on availability, p99 latency and monthly cost. Roadmap: issue #25.

## Done means green

A change is done when `npx oxlint --deny-warnings && npm run test:coverage && npm run build` passes (the Quality Gate in `.github/workflows/quality-gate.yml`, coverage ≥ 80% on `src/**/*.ts`) and, for anything visible, the `verify-ui` skill has been run.

## Simulation

- The engine (`src/sim/engine.ts`) stays generic: everything specific to a piece (capacity, what it serves, routing, state carried between seconds) lives in that piece's `Spec` in `src/sim/model.ts`. To add a piece, use the `add-piece` skill.
- Every level has a reference design that must pass and a naive one that must fail, in `src/sim/engine.test.ts`. Any change to engine numbers or piece specs keeps those outcomes; to add or retune a level, use the `add-level` skill.
- Runs are deterministic for a seed; tests rely on it.

## Product voice

- UI copy is Brazilian Portuguese, sentence case, plain verbs. Code, identifiers and comments are English.
- The look is a gallery wall label on warm putty paper (black room at night): serif headings at weight 400, mono for everything else, 1px hairlines, pill controls, no shadows; line icons in `src/KindIcon.tsx` (24×24, stroke 1.5). Colour carries one meaning, load state; the single primary action is a black ink pill, never a hue. Read `DESIGN.md` before any visual change; tokens live on `:root` in `src/App.css`.
- The game teaches: a new mechanic arrives with its concept and tradeoffs in `src/concepts.ts`, and what the player learns should change something in the simulation.

## Git

- One branch and PR per issue; the PR body is Portuguese and ends with `Closes #N`. No "Generated with Claude Code" footer.
- The owner merges PRs. Parallel agents work in separate worktrees under `../gargalo-wt/<name>`, each on its own dev-server port.

## Windows machine gotchas

- Stopping a background shell leaves the `node`/vite process alive and holding its port. Kill it by port when done: `Get-NetTCPConnection -State Listen -LocalPort <port> | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` (PowerShell).
- Memory is tight: run one dev server per agent and stop it as soon as the check is done. Port 5173 is the owner's own server; leave it alone.
