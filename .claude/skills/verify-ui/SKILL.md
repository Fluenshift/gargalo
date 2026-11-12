---
name: verify-ui
description: Check a visible gargalo change in a real browser before calling it done (layout, interaction, mobile width).
---

# Verify the UI

Done when every screen the change touches has been looked at in a screenshot at 1440, 1280 and 390 px wide, and the dev server you started no longer holds its port.

1. **Server.** Pick a free port from 5190–5199 (5173 is the owner's server). Start `npx vite --port <port> --strictPort` in the background from the checkout or worktree you changed.
2. **Set up state fast.** Designs are saved per level in `localStorage` under `gargalo:design:<levelId>` as `{ nodes, edges }` (React Flow format, node `data: { kind }`). Write one with the browser's script tool and reload instead of building it by clicking. Progress lives under other `gargalo:` keys.
3. **Drive the change.** Use the browser tools (Playwright MCP or Chrome DevTools MCP; when agents run in parallel, each takes a different one). Exercise the feature the way a player would: click, drag, keyboard, run a simulation, scrub with "Rever o segundo".
4. **Look.** Screenshot at 1440, 1280 and 390 px and read every screenshot. At each width: no horizontal scroll, the canvas keeps a usable height, nothing overlaps, text fits. Check: you can say what each screenshot shows.
5. **Clean up.** Delete the screenshots and logs you created (Playwright MCP may only save under its session's working directory, so they land outside this repo). Kill the server by port as in CLAUDE.md and close the browser. Check: the port is free.
