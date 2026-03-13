# Tasks: Glossy Glass Theme

**Input**: Design documents from `/specs/043-glossy-glass-theme/`
**Epic**: `adj-091`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-091.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2)

## Phase 1: Frontend Glass Theme

**Purpose**: Add Glossy Glass theme to the web frontend
**Goal**: Full glassmorphism theme with frosted panels, light scheme, sans-serif fonts

- [ ] T001 [US1] Add `[data-theme='glass']` CSS variable block with full theme variable set (phosphor colors mapped to glass palette, backgrounds, fonts, text transforms, panel styles) in `frontend/src/components/shared/CRTScreen.css`
- [ ] T002 [US1] Add glass theme config object to THEMES array (id: 'glass', label, description, colors, crtEffects: false) in `frontend/src/App.tsx`
- [ ] T003 [P] [US1] Add glass theme option to theme selector with preview colors in `frontend/src/components/settings/SettingsView.tsx`
- [ ] T004 [US1] Add glassmorphism utility styles — backdrop-filter blur, translucent panel backgrounds, subtle borders, glass-specific shadows, light-mode body background in `frontend/src/styles/main.css` and `frontend/src/components/shared/CRTScreen.css`

**Checkpoint**: Frontend glass theme fully functional

---

## Phase 2: iOS Glass Theme

**Purpose**: Add Glossy Glass theme to the iOS app
**Goal**: Native Apple glass look using SwiftUI Materials and blur

- [ ] T005 [P] [US2] Add `.glass` case to ColorTheme enum with full property set — primary (#007AFF), bright, dim, background set (light grays), crtEffectsEnabled=false, fontDesign=.default, preferredColorScheme=.light, text colors, accent in `ios/Adjutant/Sources/UI/Theme/CRTTheme.swift`
- [ ] T006 [US2] Add GlassPanel SwiftUI view modifier using `.ultraThinMaterial` / `.regularMaterial` backgrounds, conditional on glass theme in `ios/Adjutant/Theme/CRTEffects.swift`
- [ ] T007 [US2] Ensure ThemeManager handles `.glass` persistence and theme cycling (nextTheme/previousTheme) in `ios/Adjutant/Theme/ThemeManager.swift`

---

## Dependencies

- Phase 1 and Phase 2 are fully independent — can run in parallel
- Within Phase 1: T001 (CSS vars) → T002 (config) → T003 (settings) → T004 (effects)
- Within Phase 2: T005 (colors) → T006 (effects) → T007 (manager)
- T003 can run in parallel with T002 since they touch different files

## Parallel Opportunities

- Phase 1 (Frontend) and Phase 2 (iOS) can run simultaneously — different codebases
- T002 and T003 within Phase 1 can run in parallel
- T005 (iOS colors) can start immediately, parallel with all of Phase 1
