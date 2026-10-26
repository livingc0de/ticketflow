---
name: live-verify
description: Use when a UI, navigation or user-flow change, an endpoint's real behaviour or a permission or database effect must be proven in the running app before it is called done, or when a deployed environment needs a smoke check.
---

# Live verification

Read `.ticketflow/custom/live-verify.md` first; it adds to and overrides this file. It holds the recipe for this repo: how to find or start the stack, the URLs, the accounts, the helpers and the deployed environment. If it does not exist, ask the user once for those facts and offer to write them to that file.

Unit tests prove logic; this proves the product.

## Procedure

1. **Stack.** Check whether it is already running and reuse it. Never start a second stack on the same ports and never restart someone else's server. Start it in the background only when it is down, and wait until its URLs answer. Read the server output for errors.
2. **Data.** Use throwaway users for anything destructive or preference-changing. Prefix the titles of content you create with `[TEST #N]` (the ticket number) so it can be found and removed. Never reset or seed a shared database without the owner's explicit OK.
3. **Viewports.** Desktop 1440x900 and mobile 390x844 with touch. Add the other theme when colours change and another locale when copy changes. Theme and locale may follow a saved user preference that overrides the browser setting: set the preference on a throwaway user.
4. **Assert, do not only screenshot.** Per flow and viewport: log in as the right role, do the steps, check visible text and role, the URL, a stored row or the API response. Take screenshots at the key states and open every one: look for overflow, truncation, raw translation keys, unreadable contrast, and on mobile the bottom navigation and touch targets.
5. **Record errors.** Collect failed requests (status 400 and up) and console errors per run. Split them into new and pre-existing.
6. **Backend effect.** Check the stored result of a state change. For a permission change, prove the forbidden path fails as the real role; a working happy path is not enough.
7. **Clean up** the users and rows you created.

## Deployed environment

- After a deploy, wait until traffic no longer reaches the old version (about a minute, or the platform's own signal) before testing.
- Never type real credentials, cards or payment data into a browser, not even test cards. Create that state through the API, with a server-side session for a test user.
- Smoke after the last merge of a batch, once the build or deploy result is green.

## Not runnable

A check that cannot run (missing key, no provider, no deploy, no device) is never skipped silently. Follow "Deferred checks" in `.ticketflow/skills/implement-ticket/post-merge.md`.

## Stack notes

- Playwright: run it from a scratch folder outside the repo, with a pinned version, never as a repo dependency.
- Deployed environments: a browser agent, logging in yourself with test accounts.
- Expo web: serve the web build and test at the same viewports.
- Supabase: service-role clients only in scratch scripts, to read ground truth or build throwaway users.

## Done when

- [ ] A table lists every flow by viewport (and theme or locale) with pass or fail and a one-line reason.
- [ ] Screenshot paths are attached to the PR; failed requests and console errors are listed, marked new or pre-existing.
- [ ] Bugs found outside the scope are fixed when small and related, or ticketed.
