# Feature Specification: Glossy Glass Theme

**Feature Branch**: `043-glossy-glass-theme`
**Created**: 2026-03-13
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Frontend Glass Theme (Priority: P1)

As a user, I want to switch to a "Glossy Glass" theme in the web frontend that transforms the UI into an Apple-inspired translucent glass aesthetic — frosted panels, subtle blur, clean typography, and a light professional appearance.

**Why this priority**: The frontend is the primary interface for most users and the web theme system is mature.

**Independent Test**: Open Settings, select "Glossy Glass" theme. All panels should show translucent glass effect with blur, light background, clean sans-serif fonts, no CRT effects.

**Acceptance Scenarios**:

1. **Given** I'm on the Settings page, **When** I click "Glossy Glass", **Then** the entire UI switches to glass theme with frosted panels and light color scheme
2. **Given** Glass theme is active, **When** I navigate across all tabs (Chat, Beads, Crew, Settings), **Then** every view uses glass styling consistently
3. **Given** Glass theme is active, **When** I reload the page, **Then** the glass theme persists via localStorage

---

### User Story 2 - iOS Glass Theme (Priority: P1)

As an iOS user, I want the same "Glossy Glass" theme available in the iOS app, using native SwiftUI materials and blur effects for an authentic Apple glass look.

**Why this priority**: iOS and web must stay in sync for cross-platform consistency.

**Independent Test**: Open Settings in iOS app, select "Glossy Glass" theme. All views should use SwiftUI `.ultraThinMaterial` / `.regularMaterial` backgrounds, light color scheme, SF Pro font, no CRT effects.

**Acceptance Scenarios**:

1. **Given** I'm in iOS Settings, **When** I select "Glossy Glass", **Then** the app switches to glass theme with native material backgrounds
2. **Given** Glass theme is active on iOS, **When** I navigate the app, **Then** all screens use glass styling (materials, light backgrounds, clean fonts)
3. **Given** Glass theme is active, **When** I restart the app, **Then** glass theme persists via UserDefaults

---

### Edge Cases

- Glass backdrop-filter may have performance implications on low-end devices — ensure blur radius is reasonable
- Light theme must maintain sufficient contrast for accessibility (WCAG AA)
- Glass theme panels need visible borders/shadows to remain distinguishable on light backgrounds

## Requirements

### Functional Requirements

- **FR-001**: System MUST add "glass" as a 5th theme option on both platforms
- **FR-002**: Glass theme MUST disable CRT effects (scanlines, flicker, noise)
- **FR-003**: Glass theme MUST use system sans-serif fonts (Inter/SF Pro)
- **FR-004**: Glass theme MUST use light color scheme
- **FR-005**: Glass theme MUST persist across sessions (localStorage / UserDefaults)
- **FR-006**: Frontend MUST use `backdrop-filter: blur()` for frosted glass panels
- **FR-007**: iOS MUST use native SwiftUI Material for glass effect

## Success Criteria

- **SC-001**: Glass theme selectable and functional on both platforms
- **SC-002**: All existing views render correctly under glass theme
- **SC-003**: Theme persists across page reload / app restart
- **SC-004**: No visual regressions in other 4 themes
- **SC-005**: Build passes (npm run build + npm test)
