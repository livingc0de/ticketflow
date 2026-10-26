---
name: ui-screens
description: Use when building or changing a screen, route, navigation, layout or reusable component, including styling, theming, responsive behaviour, empty, loading and error states, accessibility, or matching a design.
---

# UI screens and components

Read `.ticketflow/custom/ui-screens.md` first if it exists; it adds to and overrides this file. It names the design source, the shared component package and the token files of this repo.

## Rules

1. **Start from the design source** if there is one (prototype, mockups, design tokens). Where the design and the code disagree, say which you followed. A screen with no mockup reuses the existing components and style; ask when a material layout decision is open.
2. **Reuse before you build.** Read the shared component list first (shells, primitives, state views, overlays). Need a variant? Extend the shared component. Never fork it per platform or per screen. A one-off that will be reused belongs in the shared package.
3. **Tokens only.** Colours, spacing, radius, type sizes and shadows come from the design tokens. No hex values, raw pixel values or one-off gradients. Existing screens that still use raw values are not a pattern to copy.
4. **Every state:** loading, empty (what would be here, why it is not, the next action), error (a localized message plus retry, never the raw provider error) and offline where relevant.
5. **Responsive and themed:** check desktop and 390px mobile, in every theme. Theme and locale may follow the user's saved preference: test each explicitly.
6. **Accessibility:**
   - interactive things go through the shared button, link or card primitives, which own the focus ring;
   - roles and labels are set and translated;
   - touch targets are at least 44x44;
   - contrast meets WCAG AA;
   - dialogs and overlays trap focus, restore it on close and close on Escape;
   - reduced motion is respected.
7. **Data** comes through the app's API client, never straight from the database or a provider. Cancel or ignore stale requests when a screen unmounts.
8. **Copy** goes through i18n (i18n practice when enabled); never hardcode the product name.

## Tests and proof

- Component tests for the shared package: a fast node suite plus a real render harness with an accessibility assertion.
- Prove the screen live at desktop and mobile width, in each theme, with screenshots in the PR (live-verify practice when enabled). Compare side by side with the design.

## Stack notes

- Next.js: keep data fetching in server components and interactivity in small client components.
- Expo and React Native web: one codebase, a layout hook that switches on a breakpoint, no platform forks of a component.
- Tailwind and Tamagui: tokens are the only source of colour and spacing values.
- jsdom plus an axe-style check catches missing labels and roles, not contrast.

## Done when

- [ ] It matches the design on mobile and desktop and every state is handled.
- [ ] Tokens only, both themes pass AA, keyboard and screen-reader usable.
- [ ] Tests pass and the live screenshots are attached.
