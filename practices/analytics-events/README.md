---
name: analytics-events
summary: Declare an event in a catalog before emitting it, track only with consent, keep personal data out of properties, relay server-side where it makes sense.
question: Does this repo emit product analytics?
detect: posthog-*, @segment/*, mixpanel* or @amplitude/* as a dependency. Recommend yes on any of them.
---

# Practice: analytics-events

Rules for repos that emit product analytics. No skill: the rules are short.

## What enabling it adds

One AGENTS line (`.ticketflow/practices/analytics-events/README.md` is its source) and one PR checklist line.

## Rules

- **Catalog first.** An event exists only once it is declared in one catalog (name, property keys and types, documented). Feature code never invents a name; an undeclared event fails typecheck or is dropped.
- **Consent before tracking.** No event is sent without the user's consent. There is no consent-free class; nothing the product needs may depend on an event.
- **No personal data in properties.** No emails, names or free text; use ids. Identity is set by the sender, not passed in properties.
- **Server-side relay where it makes sense.** Clients send to your own endpoint, which checks the name and an allowlist of property keys, then forwards. Server code emits through one shared instance.
- **Never business logic.** Money, progress and permissions come from stored rows, not events (events are consent-gated and forgeable).
- **Fire and forget.** An emit never throws into or blocks a request.
- **Removing an event** deletes its docs, catalog entry and every emit in one PR.

## Extend it

Describe your catalog, consent source and sink in `.ticketflow/custom/analytics-events.md`.

## Origin

Distilled from two production monorepos.
