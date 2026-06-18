# Plan: Per-Project Proposal Style Guide + Baseline (adj-201)

## Architecture Decisions

- **Data model**: extend the existing `projects` table (no new table) — mirrors `vision_context`
  / `auto_develop_*`. Add nullable `brand_color_primary` and `brand_color_secondary` TEXT columns
  via migration `036-project-style-guide.sql`. `projectId` (UUID) is the canonical key.
- **Service**: add `getProjectStyleGuide(projectId)` and `setProjectStyleGuide(projectId, {primary, secondary|null})`
  to `projects-service.ts`, following the `setVisionContext` pattern. Hex validation lives in the service
  (single source of truth); routes/MCP/UI reuse it. Extend `Project` + `ProjectRow` + `rowToProject`.
- **REST**: dedicated `GET /api/projects/:id/style-guide` and `PUT /api/projects/:id/style-guide`
  in `routes/projects.ts` (thin handlers → service). Chosen over overloading `PATCH /:id` for a clear,
  self-describing contract the web + iOS clients share.
- **MCP**: new read-only tool (`get_project_style`) in `mcp-tools/proposals.ts`, resolving project
  context via the adj-146 `resolveToolProjectContext` pattern; returns the guide or `null`.
  Authoring contract: update `create_proposal` / `revise_proposal` descriptions + the shared
  authoring-guidance constant (the verbatim block already surfaced in those schemas).
- **Composition baseline** (independent of the guide): `composeProposalDocument` flips its wrapper to a
  **dark-default** document aesthetic with a `prefers-color-scheme: light` variant and a small inline
  (no-JS-dependency-where-possible) ☀/☾ toggle. Must stay **self-contained / CSP-safe** (adj-200): all
  CSS inline, no external fonts/resources. AA contrast, semantic landmarks, visible focus.
- **Enforcement = authoring-only**: no server token injection. A QA **drift-lint** utility statically
  inspects a composed doc for accent-color presence + dark-mode support + a11y basics.
- **Web**: `api.ts` client methods + `useProjectStyleGuide` hook + a `StyleGuideEditor` component placed
  on the project detail surface (reachable via the `useProjectOverview` consumer — engineer locates the
  exact view). Use the `frontend-design` skill for the editor styling.
- **iOS**: extend `Project.swift` model + AdjutantKit API client; add a Style Guide section with color
  pickers to `SwarmProjectDetailView.swift`. SPM auto-discovers files — do NOT edit `.pbxproj`.

## Risks

- **Existing proposals authored for light**: flipping the wrapper to dark-default may visually clash with
  already-published light-themed proposals (e.g. the clone-isolation page). Acceptable: the `prefers-color-scheme`
  light variant + toggle mitigate; new proposals follow the new contract. Note in the guideline doc.
- **Authoring-only drift**: a sloppy agent can ignore the guide. Mitigated by the drift-lint (US5) + explicit
  tool-description contract, not by server enforcement (per locked decision).
- **CSP / self-contained regression**: the dark/toggle baseline must not introduce external resources or
  violate the adj-200 sanitizer/CSP fixpoint. The adj-200 mXSS + self-contained suites must stay green.

## Phases (= sub-epic numbers)

- **Phase 1 — Foundational (adj-201.1)**: migration + service + REST routes. Blocks Phases 2, 3, 5.
- **Phase 2 — US1 Web editor (adj-201.2)**: api client + hook + StyleGuideEditor. Depends on Phase 1.
- **Phase 3 — US2 MCP + authoring contract (adj-201.3)**: get_project_style + tool-description updates. Depends on Phase 1.
- **Phase 4 — US3 Composition baseline (adj-201.4)**: dark/accessible/friendly wrapper. Independent (root-only dep) — can start immediately.
- **Phase 5 — US4 iOS editor (adj-201.5)**: model/API + SwarmProjectDetailView UI. Depends on Phase 1.
- **Phase 6 — US5 QA drift-lint + docs (adj-201.6)**: drift-lint + guideline doc + rule/CLAUDE updates. Depends on Phases 3 + 4.

## Parallel Opportunities

- Phase 4 (composition baseline) runs in parallel with everything from the start.
- After Phase 1 merges: Phases 2 (web), 3 (MCP), 5 (iOS) run in parallel (different surfaces/files).
- Phase 6 starts once Phases 3 + 4 land.

## Bead Map

- `adj-201` — Root: Per-project proposal style guide + dark/accessible/friendly baseline
  - `adj-201.1` — Foundational: backend data model + REST routes
    - `adj-201.1.1` — Migration 036 (brand_color columns) `[setup]`
    - `adj-201.1.2` — Style-guide service get/set + Project mapping (TDD)
    - `adj-201.1.3` — REST GET/PUT /:id/style-guide (TDD)
  - `adj-201.2` — US1: Web brand-color editor _(after .1)_
    - `adj-201.2.1` — api client + useProjectStyleGuide hook (TDD)
    - `adj-201.2.2` — StyleGuideEditor component (TDD)
  - `adj-201.3` — US2: MCP get_project_style + authoring contract _(after .1.2)_
    - `adj-201.3.1` — get_project_style MCP tool (TDD)
    - `adj-201.3.2` — create/revise_proposal description updates `[docs]`
  - `adj-201.4` — US3: Composition baseline dark/accessible/friendly _(independent)_
    - `adj-201.4.1` — composeProposalDocument baseline (TDD)
  - `adj-201.5` — US4: iOS brand-color editor _(after .1)_
    - `adj-201.5.1` — iOS Project model + AdjutantKit API (TDD)
    - `adj-201.5.2` — iOS SwarmProjectDetailView editor (TDD)
  - `adj-201.6` — US5: QA drift-lint + docs _(after .3.1 + .4.1)_
    - `adj-201.6.1` — proposal-style-lint drift-lint (TDD)
    - `adj-201.6.2` — Authoring guideline doc + rule/CLAUDE/CHANGELOG `[docs]`

**Entry points (`bd ready`)**: `adj-201.1.1` (migration) and `adj-201.4.1` (composition baseline) —
the two unblocked starts. After Phase 1 merges, Phases 2/3/5 parallelize across web/MCP/iOS.
