---
name: ui-screens
summary: Screens reuse shared components and tokens, handle every state, are accessible, and are proven at desktop and mobile width in both themes.
question: Does this repo have a UI?
detect: UI dependencies (next, react-dom, expo, vue, svelte, @angular/core), a playwright.config.* file, or an e2e/ folder. Recommend yes when the repo has a UI.
---

# Practice: ui-screens

One checklist for every screen, route and shared component.

## What enabling it adds

- Skill `ui-screens` (`.ticketflow/practices/ui-screens/SKILL.md`): design source, reuse, states, tokens, accessibility, tests.
- One AGENTS line and one PR checklist line.
- CI hint: component tests with an accessibility check (a jsdom render plus an axe-style assertion) in the verify command.

## Extend it

Record in `.ticketflow/custom/ui-screens.md` the design source (prototype, mockups, tokens file), the shared component package and its inventory, the layout and breakpoint rules, and the test harness commands. It adds to and overrides the skill. It pairs with the live-verify and i18n practices.

## Origin

Distilled from two production monorepos.
