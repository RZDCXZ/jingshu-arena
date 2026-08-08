## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using a root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Product UI references

Before implementing or changing user-facing UI, choose the matching surface and read its functional contract, runnable prototype guidance, selected visual source, coverage, and latest QA.

#### Mini-program

- Product design contract: [`product-ui/miniprogram/prod.md`](product-ui/miniprogram/prod.md)
- Runnable prototype and scoped agent guidance: [`product-ui/miniprogram/design-prototype/`](product-ui/miniprogram/design-prototype/)
- Selected visual source: [`product-ui/miniprogram/design-prototype/design/reference/selected-reservation-first-home.png`](product-ui/miniprogram/design-prototype/design/reference/selected-reservation-first-home.png)
- Coverage: [`product-ui/miniprogram/design-prototype/design-coverage.md`](product-ui/miniprogram/design-prototype/design-coverage.md)
- Latest design QA: [`product-ui/miniprogram/design-prototype/design-qa.md`](product-ui/miniprogram/design-prototype/design-qa.md)

#### Management system

- Product design contract: [`product-ui/management-system/prod.md`](product-ui/management-system/prod.md)
- Runnable prototype and scoped agent guidance: [`product-ui/management-system/design-prototype/`](product-ui/management-system/design-prototype/)
- Selected visual source: [`product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png`](product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png)
- Coverage: [`product-ui/management-system/design-prototype/design-coverage.md`](product-ui/management-system/design-prototype/design-coverage.md)
- Latest design QA: [`product-ui/management-system/design-prototype/design-qa.md`](product-ui/management-system/design-prototype/design-qa.md)

Treat each product design file as the functional UI contract. Treat its selected visual source and runnable prototype as the visual and interaction reference. A UI change is complete only when the matching prototype remains runnable and its coverage or QA record is updated when the contract, visual state, or tested interaction changes.
