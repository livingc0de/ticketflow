---
name: live-verify
summary: Prove UI, flow and permission changes in the running app before claiming them: desktop and mobile width, assertions, throwaway data, real roles.
question: Prove UI/flow changes in the running app?
detect: UI dependencies (next, react-dom, expo, vue, svelte, @angular/core), a playwright.config.* file, or an e2e/ folder. Recommend yes on any of them.
---

# Practice: live-verify

Unit tests prove logic; this proves the product. A change a user can see or reach is checked in the running app, on desktop and mobile width, before it is called done.

## What enabling it adds

- Skill `live-verify` (`.ticketflow/practices/live-verify/SKILL.md`): the generic recipe. How to find or start the stack, the accounts and the helpers come from your own `.ticketflow/custom/live-verify.md`.
- One AGENTS line and one PR checklist line.
- `live_verify_skill: "live-verify"` in `.ticketflow/config.json`, which gives the `e2e-verifier` role its stub. A repo that keeps its own live-verification skill leaves this practice off and names that skill in `live_verify_skill`.
- CI hint: none. Live checks need a running stack and run on the developer's machine or a deployed environment.

## Extend it

Write the recipe for your stack in `.ticketflow/custom/live-verify.md`: the start command and URLs, the test accounts, helper scripts, the deployed environment and its quirks. It adds to and overrides the skill. If the file is missing, the skill asks once and offers to write it.

## Origin

Distilled from two production monorepos.
