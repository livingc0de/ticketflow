---
name: runtime-settings
summary: Configurable values live in a settings store read at runtime, with safe defaults; secrets never do.
question: Use a runtime settings table?
detect: A settings table in SQL or ORM schema files, or a settings loader module. Recommend yes on either, otherwise no.
---

# Practice: runtime-settings

Operational values (thresholds, limits, flags, provider order, URLs, retention periods) are data an operator can change without a deploy, not constants in code.

## What enabling it adds

- Skill `runtime-settings` (`.ticketflow/practices/runtime-settings/SKILL.md`): when to add a setting, how to read it, the add and remove steps.
- One AGENTS line and one PR checklist line.
- CI hint: add a drift test that fails when the seed, the schema and the readers disagree (a key without a reader, a reader without a key). Put it in your verify command.

## Extend it

Describe your store in `.ticketflow/custom/runtime-settings.md`: the table shape, where the seed lives, how the schema validates it, how a shared environment is updated, which subset reaches clients. It adds to and overrides the skill.

## Origin

Distilled from two production monorepos.
