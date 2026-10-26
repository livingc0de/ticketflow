---
name: i18n
summary: No hardcoded user-facing text; every locale ships in the same PR; plurals go through the i18n library and dates and numbers through `Intl`.
question: Is user-facing text localized?
detect: An i18n library (i18next, react-i18next, next-intl, vue-i18n, @lingui/*, @formatjs/*) or translation files (locales/, dictionaries/, messages/*.json, *.po). Recommend yes on either.
---

# Practice: i18n

Every string a user can read goes through the i18n layer, in every supported locale, in the same change that adds it.

## What enabling it adds

- Skill `i18n` (`.ticketflow/practices/i18n/SKILL.md`): where strings live, how to add one, what the validator misses.
- One AGENTS line and one PR checklist line.
- CI hint: put a locale-parity validator in the verify command (every key in every locale, matching placeholders, no empty values).

## Extend it

Record your layout in `.ticketflow/custom/i18n.md`: the locale list, the namespaces, the file locations, the validator command, the copy voice (tone, banned characters or phrases), and the steps for emails or stored copy. It adds to and overrides the skill.

## Origin

Distilled from two production monorepos.
