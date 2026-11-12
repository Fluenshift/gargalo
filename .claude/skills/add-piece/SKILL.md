---
name: add-piece
description: Add a new piece kind to gargalo (queue, replica, rate limiter, gateway…) or change how an existing piece behaves in the simulation.
---

# Add a piece

A piece is complete when the player can place it, the simulation gives it its own behaviour, and the inspector teaches what it trades. Work through every step; each ends on its check.

1. **Spec.** Add the kind to `Kind` and `SPECS` in `src/sim/model.ts`. Price capacity, latency and cost against the existing specs so the tradeoff is real (a piece that is better and cheaper teaches nothing). Check: the numbers make the piece the right answer in some situation and the wrong one in another.
2. **Wiring.** Set its `targets` and `maxOut`, and add the new kind to the `targets` of every piece allowed to send to it. Check: `canConnect` accepts the intended edges and rejects the rest (cover both in a test).
3. **Behaviour.** Express it through the spec: `serves` (where request classes end), `route` (which targets get each class), `step` (state carried between seconds, like a backlog). When the engine lacks a capability, add a generic `Spec` field the engine reads for every piece. Check: `src/sim/engine.ts` still has no branch on a specific kind.
4. **Its own numbers.** If the piece has a metric the player must see (backlog size, stale reads…), add it to `NodeStats`, show it on `src/NodeCard.tsx` during a run and in `src/NodeRunStats.tsx`. Check: the number is visible on the card and in the inspector after a run.
5. **Icon.** Add a line symbol to `PATHS` in `src/KindIcon.tsx`, drawn in the same 24×24, stroke-1.5 language. Check: readable at 18px next to the others.
6. **Placeable.** Add it to the parts list (`PALETTE` in `src/App.tsx`, or wherever the parts list and unlock rules live now). Check: it appears in the list and can be dropped on the canvas.
7. **Concept.** Add its `CONCEPTS` entry in `src/concepts.ts` (what it is, when to use, gains, costs, common mistakes, using the spec's real numbers) and glossary entries for any new term. Check: `src/concepts.test.ts` passes.
8. **Tests.** In `src/sim/engine.test.ts`, small architectures that show the behaviour and its tradeoff (the case it saves and the case where it fails or costs). Check: every existing level keeps its reference-passes / naive-fails outcome.

Finish with the CLAUDE.md gate and the `verify-ui` skill on a design that uses the piece.
