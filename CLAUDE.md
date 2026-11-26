# gargalo

A browser game for learning backend and system design. In the career, the player wires pieces (CDN, load balancer, servers, cache, database…) on a canvas and a simulation scores the architecture on availability, p99 latency and monthly cost. In the Oficina, the player writes a real API in TypeScript (Hono or plain fetch) against Postgres (PGlite), in the browser. Read `PRODUCT.md` before any product or copy decision: it says who the player is (a backend beginner) and what the game promises. Approved feature specs live in `docs/specs/`.

## Done means green

A change is done when `pnpm run lint && pnpm run test:coverage && pnpm run build` passes (the Quality Gate in `.github/workflows/quality-gate.yml`, coverage ≥ 80% on `src/**/*.ts`) and, for anything visible, the `verify-ui` skill has been run. Formatting belongs to oxfmt (`.oxfmtrc.json`): run `pnpm fmt` before committing, since `pnpm run lint` fails on any unformatted file.

## Simulation

- The engine (`src/sim/engine.ts`) stays generic: everything specific to a piece (capacity, what it serves, routing, state carried between seconds) lives in that piece's `Spec` in `src/sim/model.ts`. To add a piece, use the `add-piece` skill.
- Every level has a reference design that must pass and a naive one that must fail, in `src/sim/engine.test.ts`. Any change to engine numbers or piece specs keeps those outcomes; to add or retune a level, use the `add-level` skill.
- Runs are deterministic for a seed; tests rely on it.

## Oficina

- Every course stage (`src/oficina/projeto/`) has a reference solution for each framework the course offers, which passes its tests with the full checklist, and naive code that fails, in the course's test file. Every step check passes on the reference, and file checks fail on the code the player starts from. Any change to a course, a check or the project runtime keeps those outcomes.
- The Oficina teaches through its docs: a step links each new term to its entry in `src/oficina/projeto/docs.ts`, and the entry links to the official page (`url`), except for the course's own helpers.

## Product voice

- UI copy is Brazilian Portuguese, sentence case, plain verbs. Code, identifiers and comments are English, except code the player sees (Oficina starters, reference solutions, doc examples), which is Portuguese, names and comments alike.
- The look is a transit map on cool paper (graphite at night): serif headings at weight 400, mono for everything else, 1px hairlines, pill controls, no shadows; line icons in `src/KindIcon.tsx` (24×24, stroke 1.5). Each colour has one meaning: cobalt is the single primary action, each company has a line colour (`data-company`), green/amber/red are load state, and code is syntax-coloured in the Oficina. Read `DESIGN.md` before any visual change; tokens live on `:root` in `src/App.css`.
- The game teaches: a new mechanic arrives with its concept and tradeoffs in `src/concepts.ts`, and what the player learns should change something in the simulation.

## Dependencies

- No new dependency without the owner's approval in the conversation or issue. Prefer what the platform, the standard library or an installed package already does.
- Before proposing a package, confirm it is real and healthy on the npm registry (`pnpm view <name> time.created repository.url maintainers`, weekly downloads on npmjs.com): exact name, an existing source repository, real maintainers and history. AI-suggested names can be hallucinated and squatted with malware (slopsquatting); never install a name you have not checked.
- Install with `pnpm add <name>@<exact version>` so the lockfile records it, and say in the PR why the package is needed. The supply-chain settings in `pnpm-workspace.yaml` (minimum release age, trust policy) apply to every install; loosen them only with the owner's approval.
- Actions are dependencies too. Workflows reference them by version tag, and `.github/workflows/actions.lock` pins each one to a commit. After changing a `uses:` line, run `gh actions-lock` (the `github/gh-actions-lock` extension) and commit the lockfile; the Actions lockfile check fails while it's stale.

## Git

- Before you create a branch, commit or open a PR, read `docs/CONTRIBUTING.md`: branch names, commit messages, the PR, cleanup after merge, and what each push triggers in CI and Vercel. Where a generic commit or PR skill says otherwise, that file wins.
- PRs carry no "Generated with Claude Code" footer.
- Parallel agents work in separate worktrees under `../gargalo-wt/<name>` (each runs its own `pnpm install`, hard-linked from the shared store), each on its own dev-server port.

## Dev servers

- Memory is tight: run one dev server per agent and stop it as soon as the check is done. Port 5173 is the human's own server; leave it alone.
- Stopping a background shell can leave the `node`/vite process alive and holding its port. Kill it by port when done:
  - Linux and macOS: `kill $(lsof -ti tcp:<port> -sTCP:LISTEN)`
  - Windows (PowerShell): `Get-NetTCPConnection -State Listen -LocalPort <port> | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
