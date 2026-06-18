# Tasks: Per-Project Proposal Style Guide + Baseline (adj-201)

Format: `- [ ] T### [P] [US#] description in path`. `[P]` = parallelizable (different files, no dep).
Every non-exempt task is TDD-shaped (RED → GREEN), written on one line so the audit script
(`scripts/audit-tasks-md.ts`, which checks per-line) sees the test-first + GREEN phrasing.
Exemptions tagged `[setup]` / `[docs]` / `[scaffold]`.

## Phase 1 — Foundational (adj-201.1) — backend data model + routes

- [ ] T001 [setup] [US1] Create migration `backend/src/services/migrations/036-project-style-guide.sql` adding nullable `brand_color_primary TEXT` and `brand_color_secondary TEXT` columns to `projects`.
- [ ] T002 [US1] Add `getProjectStyleGuide` + `setProjectStyleGuide` (hex validation, clear-when-primary-null, NOT_FOUND) plus `Project`/`ProjectRow`/`rowToProject` mapping in `backend/src/services/projects-service.ts` — write failing tests first in `backend/tests/unit/projects-service.test.ts` (confirm RED), then implement until GREEN.
- [ ] T003 [US1] Add REST routes `GET /:id/style-guide` + `PUT /:id/style-guide` in `backend/src/routes/projects.ts` (thin handlers → service) — write failing tests first in `backend/tests/integration/projects-style-guide.test.ts` covering GET set+unset, PUT success, invalid-hex 400, unknown-id 404 (confirm RED), then implement until GREEN.

## Phase 2 — US1 Web editor (adj-201.2) — depends on Phase 1

- [ ] T004 [P] [US1] Add `getProjectStyleGuide`/`updateProjectStyleGuide` to `frontend/src/services/api.ts` + a `useProjectStyleGuide` hook in `frontend/src/hooks/` — write failing tests first in `frontend/tests/unit/useProjectStyleGuide.test.ts` covering initial/loaded/save/error (confirm RED), then implement until GREEN.
- [ ] T005 [US1] Build a `StyleGuideEditor` component (primary + optional secondary color inputs, hex validation, save, dirty/disabled states) on the project detail surface using the `frontend-design` skill — write failing tests first in `frontend/tests/unit/style-guide-editor.test.tsx` (confirm RED), then implement until GREEN.

## Phase 3 — US2 MCP tool + authoring contract (adj-201.3) — depends on Phase 1

- [ ] T006 [P] [US2] Add a `get_project_style` MCP tool in `backend/src/services/mcp-tools/proposals.ts` (resolve via adj-146 `resolveToolProjectContext`; return guide or `null`) — write failing tests first in `backend/tests/unit/mcp-proposals-style.test.ts` covering set→guide, unset→null, bad-project→validation error (confirm RED), then implement until GREEN.
- [ ] T007 [docs] [US2] Update `create_proposal` / `revise_proposal` tool descriptions + the shared authoring-guidance constant in `backend/src/services/mcp-tools/proposals.ts` to instruct: call `get_project_style`, honor the brand color, follow the dark/accessible/friendly authoring contract.

## Phase 4 — US3 Composition baseline (adj-201.4) — independent (root-only)

- [ ] T008 [P] [US3] Make `composeProposalDocument` in `backend/src/services/proposal-html.ts` default to a dark, accessible, friendly aesthetic with a `prefers-color-scheme: light` variant + manual ☀/☾ toggle, staying self-contained/CSP-safe — extend failing tests first in `backend/tests/unit/proposal-html.test.ts` (dark default, light variant, toggle, no external refs, lang+semantic landmarks; confirm RED), then implement until GREEN and re-run the adj-200 sanitizer/self-contained suites.

## Phase 5 — US4 iOS editor (adj-201.5) — depends on Phase 1

- [ ] T009 [P] [US4] Extend `ios/AdjutantKit/Sources/AdjutantKit/Models/Project.swift` + AdjutantKit API client with style-guide fields + get/update calls — write failing tests first in the AdjutantKit test target covering decode guide, encode update, nil/unset (confirm RED), then implement until GREEN.
- [ ] T010 [US4] Add a Style Guide section (primary + optional secondary color pickers, hex validation, save) to `ios/Adjutant/Features/Projects/SwarmProjectDetailView.swift` + its view model (SPM auto-discovers — do NOT edit `.pbxproj`) — write failing view-model tests first (confirm RED), then implement until GREEN.

## Phase 6 — US5 QA drift-lint + docs (adj-201.6) — depends on Phases 3 + 4

- [ ] T011 [P] [US5] Build a proposal-page drift-lint in `backend/src/services/proposal-style-lint.ts` (input: composed HTML + optional expected brand color; output: findings for accent-color presence, dark-mode support, a11y basics) — write failing tests first in `backend/tests/unit/proposal-style-lint.test.ts` covering missing-accent flag, no-dark-mode flag, compliant-doc pass, no-expected-color skip (confirm RED), then implement until GREEN.
- [ ] T012 [docs] [US5] Write `docs/proposal-page-authoring.md` (dark/accessible/friendly + honor brand color contract); update `.claude/rules/04-architecture.md` (Proposal Sharing section), `CLAUDE.md`, and `CHANGELOG.md` to reference the style guide + baseline.
