---
name: i18n
description: Use when adding or changing any user-facing text (screens, components, API errors, emails, notifications, PDFs, stored copy), adding a namespace or locale, or fixing a locale validation failure.
---

# i18n and copy

Read `.ticketflow/custom/i18n.md` first if it exists; it adds to and overrides this file. It names the locales, the files, the validator and the copy voice of this repo.

## Rules

- No hardcoded user-facing text anywhere: UI, API errors, emails, notifications, PDFs, stored copy. No locale branches in code (`if (locale === 'xx')`).
- Every locale is updated in the same PR, with matching placeholders. Never leave placeholders, empty values or copies of the source language.
- Plurals go through the i18n library's plural forms, never string concatenation. Dates and numbers go through `Intl` with the active locale, never hand-formatted.
- API errors carry a code and a message key (or already localized text), never a diagnostic or a provider message.
- Shared components take already-translated props; they do not embed literals.
- Adding a locale needs data only: no new code path.
- Do not hardcode the product name; take it from one brand module or setting.

## Add or change a string

1. Pick the namespace (reuse one before adding another); add the key in every locale, nested by screen or feature.
2. Interpolate with the library's placeholder syntax; placeholders must match across locales.
3. Use the lookup call in the component. For an API error, add the message key to the errors namespace in every locale.
4. Run the locale validator from the verify command.

## What validators miss

Unused keys, and literals outside the paths a lint rule covers. Grep the diff for quoted words and JSX text, in every package, not only the app.

## Check the layout

Open the longest locale at mobile width (390px): translations can run about 30% longer than English. Look for overflow and truncation (see the live-verify practice when enabled).

## Stack notes

- Next.js: dictionaries per locale or next-intl; server components load the dictionary on the server.
- Expo and React Native: i18next with namespaces, lazily loaded for the non-default locales.
- Server code: lookup maps keyed by message key and locale; email templates have their own catalog per locale.
- Content stored in the database: a translation table per entity, resolved in order: requested locale, fallback locale, source.

## Done when

- [ ] Every locale file is updated and the validator passes.
- [ ] No literals in the diff; the longest locale was checked at mobile width.
