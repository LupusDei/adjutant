# Glossy Glass Theme - Beads

**Feature**: 043-glossy-glass-theme
**Generated**: 2026-03-13
**Source**: specs/043-glossy-glass-theme/tasks.md

## Root Epic

- **ID**: adj-091
- **Title**: Glossy Glass Theme
- **Type**: epic
- **Priority**: 2
- **Description**: Add a 5th "Glossy Glass" theme to both web frontend and iOS app — Apple-inspired glassmorphism with frosted translucent panels, light color scheme, sans-serif fonts, no CRT effects.

## Epics

### Phase 1 — Frontend: Glass Theme
- **ID**: adj-091.1
- **Type**: epic
- **Priority**: 2
- **Tasks**: 4

### Phase 2 — iOS: Glass Theme
- **ID**: adj-091.2
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

## Tasks

### Phase 1 — Frontend: Glass Theme

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Glass CSS variables | frontend/src/components/shared/CRTScreen.css | adj-091.1.1 |
| T002 | Glass theme config in App.tsx | frontend/src/App.tsx | adj-091.1.2 |
| T003 | Glass theme in Settings UI | frontend/src/components/settings/SettingsView.tsx | adj-091.1.3 |
| T004 | Glassmorphism effects CSS | frontend/src/styles/main.css, CRTScreen.css | adj-091.1.4 |

### Phase 2 — iOS: Glass Theme

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | ColorTheme .glass case | ios/Adjutant/Sources/UI/Theme/CRTTheme.swift | adj-091.2.1 |
| T006 | GlassPanel SwiftUI modifier | ios/Adjutant/Theme/CRTEffects.swift | adj-091.2.2 |
| T007 | ThemeManager glass registration | ios/Adjutant/Theme/ThemeManager.swift | adj-091.2.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Frontend Glass Theme | 4 | 2 | adj-091.1 |
| 2: iOS Glass Theme | 3 | 2 | adj-091.2 |
| **Total** | **7** | | |

## Dependency Graph

Phase 1: Frontend (adj-091.1)    Phase 2: iOS (adj-091.2)    [parallel]

## Improvements

Improvements (Level 4: adj-091.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
