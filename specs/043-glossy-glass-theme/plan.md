# Implementation Plan: Glossy Glass Theme

**Branch**: `043-glossy-glass-theme` | **Date**: 2026-03-13
**Epic**: `adj-091` | **Priority**: P2

## Summary

Add a 5th "Glossy Glass" theme to both the web frontend and iOS app, inspired by Apple's glassmorphism design language. The theme system is mature with 4 existing themes — this extends the pattern with glass-specific CSS variables (frontend) and SwiftUI Materials (iOS). No CRT effects. Light color scheme. Frosted translucent panels with blur.

## Bead Map

- `adj-091` - Root: Glossy Glass Theme
  - `adj-091.1` - Frontend: Glass Theme
    - `adj-091.1.1` - CSS variables for glass theme
    - `adj-091.1.2` - Theme config + settings UI
    - `adj-091.1.3` - Glassmorphism effects CSS
  - `adj-091.2` - iOS: Glass Theme
    - `adj-091.2.1` - ColorTheme .glass case + colors
    - `adj-091.2.2` - Glass effects (SwiftUI Materials)
    - `adj-091.2.3` - ThemeManager registration

## Technical Context

**Stack**: TypeScript, React, Tailwind CSS (frontend); Swift, SwiftUI (iOS)
**Storage**: localStorage (frontend), UserDefaults (iOS)
**Testing**: Vitest (frontend)
**Constraints**: backdrop-filter performance on low-end devices; WCAG AA contrast

## Architecture Decision

Extend existing theme pattern rather than building new infrastructure. Each platform has a well-defined theme extension point:
- Frontend: Add `[data-theme='glass']` CSS selector + theme config object
- iOS: Add `.glass` case to `ColorTheme` enum

No new files needed — all changes go into existing theme files.

## Design Tokens — Glass Theme

### Color Palette
- **Background screen**: `#F2F2F7` (iOS system gray 6)
- **Background panel**: `rgba(255, 255, 255, 0.72)` (translucent white)
- **Background elevated**: `rgba(255, 255, 255, 0.85)` (more opaque white)
- **Primary text**: `#1C1C1E` (near black)
- **Secondary text**: `#636366` (system gray)
- **Accent**: `#007AFF` (iOS system blue)
- **Accent dim**: `#5856D6` (system indigo for secondary)
- **Border**: `rgba(0, 0, 0, 0.08)` (subtle separator)
- **Border highlight**: `rgba(255, 255, 255, 0.5)` (inner light edge)

### Glass Effects
- **Backdrop blur**: `blur(20px)` (frosted glass)
- **Panel shadow**: `0 2px 16px rgba(0, 0, 0, 0.08)` (subtle depth)
- **Border radius**: `16px` (rounded corners, Apple-style)

### Typography
- **Font**: Inter, -apple-system, SF Pro, system-ui (sans-serif)
- **Text transform**: none (sentence case, not uppercase)

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/shared/CRTScreen.css` | Add `[data-theme='glass']` CSS variables |
| `frontend/src/App.tsx` | Add glass theme config to THEMES array |
| `frontend/src/components/settings/SettingsView.tsx` | Add glass theme option to selector |
| `frontend/src/styles/main.css` | Add glass-specific utility classes if needed |
| `ios/Adjutant/Sources/UI/Theme/CRTTheme.swift` | Add `.glass` case to ColorTheme enum |
| `ios/Adjutant/Theme/ThemeManager.swift` | Register glass in theme cycling |
| `ios/Adjutant/Theme/CRTEffects.swift` | Add GlassPanel view modifier |

## Phase 1: Frontend Glass Theme (US1)

Add all frontend theme support:
1. CSS variables in CRTScreen.css — full variable set for glass
2. Theme config in App.tsx — add to THEMES array
3. Settings UI — glass appears in theme selector
4. Glassmorphism CSS — backdrop-filter, translucent panels, glass-specific styles

## Phase 2: iOS Glass Theme (US2)

Add all iOS theme support:
1. ColorTheme `.glass` case — colors, fonts, backgrounds, crtEffectsEnabled=false
2. SwiftUI glass effects — Material backgrounds, blur modifiers
3. ThemeManager — ensure glass persists and cycles correctly

## Parallel Execution

- Phase 1 (Frontend) and Phase 2 (iOS) are fully independent — can run in parallel
- Within each phase, tasks are sequential (CSS vars → config → effects)

## Verification Steps

- [ ] Select Glass theme in web Settings — all panels show frosted glass
- [ ] Navigate all web tabs — consistent glass styling
- [ ] Reload page — glass theme persists
- [ ] Select Glass theme in iOS Settings — native material backgrounds
- [ ] Navigate all iOS screens — consistent glass styling
- [ ] Restart iOS app — glass theme persists
- [ ] Switch between all 5 themes — no visual regressions
- [ ] `npm run build` passes
- [ ] `npm test` passes
