---
name: domain-guides
summary: Product rules live in short path-scoped guides under docs/agents/, read before touching matching files and updated in the same PR.
question: Split domain rules into path-scoped guides?
detect: An existing docs/agents/ or .claude/rules/ folder, or an AGENTS.md longer than 200 lines. Recommend yes on any of them.
---

# Practice: domain-guides

A long AGENTS.md hides the rule that matters. Domain guides keep rules next to the area they govern and load only when relevant.

## What enabling it adds

- No skill. The guides are product content, so they live in your repo at a fixed path, `docs/agents/<name>.md`, and never in ticketflow.
- For Claude (`claude` in `agents`): a generated rule file `.claude/rules/<name>.md` per guide, with the guide's frontmatter and body inlined, so Claude loads it for matching paths.
- For Codex and other agents: one AGENTS line telling them to read each guide whose `paths` match the file at hand.
- One PR checklist line.

## Guide format

```markdown
---
paths:
  - "src/billing/**"
  - "docs/billing.md"
---
# Billing

Invariants first, then the how-to.
```

- Frontmatter is a `paths:` list of globs, nothing else; it is required.
- File name: lowercase letters, digits and dashes.
- Size: about 100 lines. Split a guide that grows past it.
- Order: invariants (what must always hold, who pays whom, what may never be done), then flows, then where the code lives.
- A change in the area updates its guide in the same PR. A repo may keep its own guide table outside the managed AGENTS block.

## Extend it

List the guides and their owners in `.ticketflow/custom/domain-guides.md`. It adds to and overrides this file.

## Origin

Distilled from two production monorepos.
