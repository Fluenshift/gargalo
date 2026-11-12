---
name: add-level
description: Add a gargalo level or boss, or retune an existing level's traffic, failures or goals.
---

# Add a level

A level teaches one concept: the design a player builds before knowing it fails, and the design that applies it passes.

1. **Lesson.** Name the single concept the level teaches and the piece or idea that solves it. Check: you can state the naive design and the reference design in one line each.
2. **Level data.** Define the `Level` (from `src/sim/model.ts`): duration, request mix, traffic phases, failures, goals. Put it in the level data module (`src/levels.ts`, or the company it belongs to once the career mode exists). Check: types compile.
3. **Reference and naive designs.** Add both to the `levels` cases in `src/sim/engine.test.ts`: reference must pass, naive must fail. Check: both assertions present.
4. **Tune across seeds.** The game seeds each run from the clock while tests use seed 1, so an outcome that holds only for seed 1 is luck. Run both designs for seeds 1 to 20 (a temporary loop in the test, removed afterwards) and adjust goals or traffic until the reference passes every seed with some margin and the naive fails every seed. Check: 20 of 20 each way.
5. **Briefing.** Write the briefing in the product voice: the situation and the numbers the player needs (traffic, a piece's capacity), never the answer. Check: a player could reach the reference design from the briefing plus the inspector.
6. **Concept link.** If the level introduces a piece or term the player has not met, make sure `src/concepts.ts` explains it.

Finish with the CLAUDE.md gate and the `verify-ui` skill, playing the level with both designs.
