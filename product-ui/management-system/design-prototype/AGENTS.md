# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Prototype decisions

- Product design input: [`../prod.md`](../prod.md).
- Selected visual source: [`design/reference/selected-night-operations-console.png`](design/reference/selected-night-operations-console.png).
- Coverage and latest visual QA: [`design-coverage.md`](design-coverage.md) and [`design-qa.md`](design-qa.md).
- The user selected the second generated visual direction: a dark, high-contrast “night operations console” with charcoal/navy surfaces, restrained cyan information accents, lime primary actions, compact outlined icons, continuous queue surfaces, and a right-side context inspector.
- The default 1440 × 1024 screen must faithfully recreate the selected staff workbench reference while the broader prototype extends the same visual language across staff, store manager, headquarters, and shared sandbox flows.
- This prototype is the management-side deliverable. The customer mini-program and H5 are represented only where cross-role context is needed; they are not a separate UI build here.
