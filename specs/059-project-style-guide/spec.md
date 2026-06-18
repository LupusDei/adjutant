# Spec: Per-Project Proposal Style Guide + Dark/Accessible/Friendly Proposal-Page Baseline

**Feature**: 059-project-style-guide
**Root epic**: adj-201
**Status**: Planned
**Builds on**: adj-200 / specs/058-proposal-html-pages (proposal HTML sharing)

## Summary

Let a user define a per-project **style guide** (v1 = accent/brand color: a required primary
and an optional secondary) on the Adjutant **project page** (web React + iOS SwiftUI). When an
agent authors a proposal for that project, it **fetches the guide** (via a new MCP tool) and
authors the proposal HTML page to **match the brand color**.

Separately — and independent of any project guide — every proposal page gets a baked-in
**dark-by-default, accessible (WCAG AA), and friendly** baseline.

## Locked Decisions (do not re-litigate)

1. **v1 control = accent/brand color only**: `brandColorPrimary` (required when a guide is set)
   + `brandColorSecondary` (optional). Both validated as hex (`#RGB` / `#RRGGBB`). No fonts,
   personality, or logo this round.
2. **Color mode = Light + Dark, DARK default**: published pages respect `prefers-color-scheme`,
   default to dark, and expose a manual ☀/☾ toggle. Accessible: AA contrast, semantic HTML,
   visible focus. Friendly tone.
3. **Enforcement = AUTHORING-ONLY**: the server does **not** inject project tokens into the page.
   Agents read the guide via MCP and author to match. The dark/accessible/friendly baseline +
   "honor the project brand color" rule live in the **agent authoring contract** (MCP tool
   descriptions + a short guideline doc). A lightweight **QA drift-lint** checks a composed page
   for accent-color presence, dark-mode support, and a11y basics — catching drift without
   server enforcement.

## User Stories

### US1 — Set a project's brand color on the web (Priority: P1) — MVP

As the General, I open a project's page in the Adjutant web dashboard and set a primary brand
color (and optionally a secondary), then save. Re-opening shows the saved values.

**Acceptance criteria**
- A "Style Guide" section on the project detail surface shows primary + optional secondary color inputs.
- Saving persists via `PUT /api/projects/:id/style-guide`; reloading reflects the saved values.
- Invalid hex is rejected with a clear inline error; clearing primary clears the whole guide.
- Empty/unset guide is a valid state (no guide).

### US2 — Agent reads the guide and authors to match (Priority: P1) — MVP

As an authoring agent, before composing a proposal I call an MCP tool to read the project's
style guide and incorporate the brand color into the proposal HTML.

**Acceptance criteria**
- New MCP tool returns `{ brandColorPrimary, brandColorSecondary } | null` for a project (resolved
  by projectId; honors the adj-146 cross-project context pattern).
- `create_proposal` / `revise_proposal` tool descriptions instruct the agent to fetch the guide,
  honor the brand color, and follow the dark/accessible/friendly authoring contract.
- Tool returns `null` (not an error) when no guide is set.

### US3 — Proposal pages are dark, accessible, friendly by default (Priority: P1) — MVP

As any reader of a published proposal page, the page renders dark-by-default, respects my OS
color-scheme preference, lets me toggle, and meets accessibility basics.

**Acceptance criteria**
- `composeProposalDocument` wrapper defaults to a dark document aesthetic with a
  `prefers-color-scheme: light` variant and a manual toggle (no external resources; CSP-safe;
  self-contained — preserves adj-200 contract).
- Wrapper chrome meets WCAG AA contrast, uses semantic landmarks, and shows visible focus.
- Existing self-contained / sanitization guarantees from adj-200 remain intact.

### US4 — Set a project's brand color on iOS (Priority: P2)

As the General on the iOS app, I open a project's detail view and set/edit the brand color(s),
and they persist through the same API.

**Acceptance criteria**
- `SwarmProjectDetailView` gains a Style Guide section with color pickers + save.
- Persists via the same `PUT /api/projects/:id/style-guide`; reflects saved values on reload.
- Hex validation parity with web.

### US5 — QA drift-lint + authoring guideline doc (Priority: P2)

As QA, I can lint a composed/published proposal page to confirm it honors the project accent
color, supports dark mode, and passes a11y basics; and there's a written authoring contract.

**Acceptance criteria**
- A drift-lint utility takes a composed HTML doc + optional expected brand color and reports:
  accent-color presence, dark-mode support (prefers-color-scheme / toggle), a11y basics
  (lang attr, semantic structure, no contrast red-flags it can statically detect).
- A short authoring guideline doc exists; `.claude/rules/04-architecture.md` (Proposal Sharing)
  and `CLAUDE.md` reference the style-guide + baseline.

## Out of Scope (v1)

- Font / typography controls, personality/tone text, logo/wordmark, corner/density controls.
- Server-side enforcement/injection of project tokens (explicitly authoring-only).
- Retroactive restyling of already-published proposals.
- Per-proposal color overrides separate from the project guide.

## Success Criteria

- A user sets a brand color on web (and iOS), an agent reads it via MCP, and a newly authored
  proposal page visibly uses that color and renders dark/accessible/friendly.
- All layers tested per constitution; `verify-before-push.sh` green; adj-200 security suite stays green.
