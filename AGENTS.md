## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using a root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Product UI references

Before implementing or changing user-facing UI, use the matching product design and prototype as the visual and interaction reference:

- Mini-program product design: [`product-ui/miniprogram/prod.md`](product-ui/miniprogram/prod.md)
- Management-system product design: [`product-ui/management-system/prod.md`](product-ui/management-system/prod.md)
- Runnable management prototype: [`product-ui/management-system/design-prototype/`](product-ui/management-system/design-prototype/)
- Selected management visual source: [`product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png`](product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png)
- Latest management design QA: [`product-ui/management-system/design-prototype/design-qa.md`](product-ui/management-system/design-prototype/design-qa.md)

Treat the product design files as the functional UI contract and the selected visual source plus runnable prototype as the visual interaction reference. 
