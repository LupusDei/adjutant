# Design Notes: Agent Personas & Roles

**Author**: designer
**Date**: 2026-03-04
**Epic**: adj-033
**Status**: Design review complete

---

## Executive Summary

The persona system is a high-value feature with a complex editor UI. The core
challenge is making 12 trait sliders + a point budget feel intuitive rather
than overwhelming, while respecting the retro terminal (Pip-Boy) aesthetic.
This document captures UX recommendations across six areas.

---

## 1. Trait Grouping (bead: adj-s0t2)

### Problem

12 flat sliders on one screen is a wall of controls. Users cannot quickly
understand what category each trait belongs to, and the labels overlap
conceptually (architecture_focus vs modular_architecture).

### Recommendation

Group the 12 traits into 4 cognitive categories:

```
ENGINEERING (system-level concerns)
  > SYSTEM DESIGN ........... [||||||||||||........] 12/20
  > MODULARITY .............. [||||||..............] 06/20
  > DEEP TECH ............... [||||||||||..........] 10/20

QUALITY (testing & correctness)
  > CORRECTNESS ............. [||||||||||||||||....] 16/20
  > SCALE TESTING ........... [||||................] 04/20
  > UNIT TESTS .............. [||||||||||||........] 12/20
  > E2E TESTS ............... [||||||||||..........] 10/20

PRODUCT (user-facing concerns)
  > PRODUCT DESIGN .......... [||..................] 02/20
  > UI/UX FOCUS ............. [....................] 00/20
  > BIZ VALUE ............... [||||................] 04/20

CRAFT (process & communication)
  > CODE REVIEW ............. [||||||||||..........] 10/20
  > DOCUMENTATION ........... [||||||..............] 06/20

BUDGET ==================== [||||||||||||||||||||] 092/100 PTS
```

Each category header shows aggregate points spent in that group. Categories
are collapsible (default: expanded). This reduces perceived complexity from
"12 things to configure" to "4 areas to think about."

### Visual hierarchy

- Category headers: uppercase monospace, bright green, with a decorative
  line extending to the right (same pattern as SwarmSection headers)
- Trait labels: dim green, dot-leader to slider, monospace
- Slider values: bright green, right-aligned numeric readout

---

## 2. Trait Label Clarity (bead: adj-b93s)

### Problem

Several labels are ambiguous or use enterprise jargon:
- "Architecture Focus" vs "Modular Architecture" -- too similar
- "QA: Scalability" and "QA: Correctness" -- reads as subcategory, not personality
- "Testing: Acceptance" -- most users do not use this term

### Recommended Label Map

| Trait Key              | Spec Label             | Recommended Display    | Max Chars |
|------------------------|------------------------|------------------------|-----------|
| architecture_focus     | Architecture Focus     | SYSTEM DESIGN          | 13        |
| modular_architecture   | Modular Architecture   | MODULARITY             | 10        |
| technical_depth        | Technical Depth        | DEEP TECH              | 9         |
| qa_correctness         | QA: Correctness        | CORRECTNESS            | 11        |
| qa_scalability         | QA: Scalability        | SCALE TESTING          | 13        |
| testing_unit           | Testing: Unit          | UNIT TESTS             | 10        |
| testing_acceptance     | Testing: Acceptance    | E2E TESTS              | 9         |
| product_design         | Product Design         | PRODUCT DESIGN         | 14        |
| uiux_focus             | UI/UX Focus            | UI/UX FOCUS            | 11        |
| business_objectives    | Business Objectives    | BIZ VALUE              | 9         |
| code_review            | Code Review            | CODE REVIEW            | 11        |
| documentation          | Documentation          | DOCUMENTATION          | 13        |

Labels capped at ~14 characters to avoid wrapping on mobile portrait.

Each trait should have a brief tooltip/hint visible on:
- Web: hover over the label shows a one-line description
- iOS: long-press on the label shows a popover with description

---

## 3. Stepped Slider Design (bead: adj-zkxv)

### Problem

Smooth HTML range inputs and SwiftUI Sliders do not match the retro terminal
aesthetic. They also create precision issues on mobile (trying to hit value 13
on a tiny slider is frustrating).

### Recommendation

Replace smooth sliders with **segmented volume-meter sliders**:

```
SYSTEM DESIGN  [##][##][##][##][##][##][  ][  ][  ][  ]  12/20
               ^-- filled (green glow)  ^-- empty (dark, dim border)
```

**Web implementation:**
- 20 small rectangular `<div>` elements in a flex row
- Each ~12px wide, ~16px tall, 1px gap
- Filled: background var(--crt-phosphor), box-shadow glow
- Empty: background transparent, border 1px solid var(--crt-phosphor-dim)
- Click on any segment to set value to that position
- Hover: show cursor value in monospace above

**iOS implementation:**
- Custom SwiftUI Shape or HStack of 20 Rectangle elements
- Tap target: minimum 44pt per touchable area (group 2-3 segments)
- UIImpactFeedbackGenerator on each value change (haptic tick)
- DragGesture for slide-to-set

**Value display:**
- Right of slider: "12/20" in monospace, bright green
- When value is 0: "00/20" in dim green

---

## 4. Budget Visualization (beads: adj-xs1k, adj-4jb0)

### Budget Gauge

Replace a standard progress bar with a **segmented power gauge**:

```
BUDGET  [##][##][##][##][##][##][##][##][##][  ]  092/100 PTS
         10  20  30  40  50  60  70  80  90 100
```

- 10 segments, each representing 10 points
- Partially filled segments show proportional fill (e.g., 92 = 9 full + 1 at 20%)
- Colors:
  - 0-79 points: green (var(--crt-phosphor))
  - 80-99 points: amber (var(--pipboy-amber)) with label "NEARING LIMIT"
  - 100 points: bright amber, label "FULLY ALLOCATED"
  - 101+ points: red (var(--pipboy-red)), pulsing, label "OVER BUDGET BY X"

### Soft-Cap Enforcement

Do NOT hard-stop sliders at budget limit. Instead:

1. Sliders always move freely (0-20 range each)
2. The budget gauge provides visual feedback as points accumulate
3. At 80+: amber warning zone
4. At 100: fully allocated, still saveable
5. At 101+: red error state, save button disabled
6. Error state shows: "REDUCE 5 POINTS TO SAVE" (dynamic count)

This gives users agency and feedback instead of invisible walls.

### Gauge placement

- **Web**: Sticky at the top of the editor form (persists while scrolling sliders)
- **iOS**: Fixed in the navigation bar area or pinned to top of scroll view

---

## 5. Spawnable Roster Design (bead: adj-bpxp)

### Visual Hierarchy on Agents Page

The Agents page now shows three types of entries:

```
[Page header: AGENTS]
[Workload summary: 5 ACTIVE | 2 IDLE | 0 BLOCKED | 3 OFFLINE]

[Section: PERSONA ROSTER] -------- [+ BUILD PERSONA]
  +-----------------------------------+  +-----------------------------------+
  | ◇ SENTINEL              [DEPLOY] |  | ◇ ARCHITECT             [DEPLOY] |
  | QA-focused agent                  |  | System design specialist          |
  |  ◆    Trait radar:                |  |  ◆    Trait radar:                |
  | ◆ ◆   (4-point diamond)          |  | ◆ ◆   (4-point diamond)          |
  |  ◆                               |  |  ◆                               |
  +-----------------------------------+  +-----------------------------------+

[Section: WORKING (3)] --------
  [SwarmAgentCard: zeratul - WORKING]
  [SwarmAgentCard: artanis - WORKING]
  [SwarmAgentCard: tassadar - WORKING]

[Section: IDLE (2)] --------
  [SwarmAgentCard: fenix - IDLE]
  [SwarmAgentCard: vorazun - IDLE]

[Section: > OFFLINE (3)] --------  [collapsed]

[Section: > CALLSIGN ROSTER (12/16 enabled)] --------  [collapsed]
```

### Standby Persona Card

Distinguishing features vs running agent cards:
- **Dashed border** (1px dashed var(--crt-phosphor-dim)) vs solid border on running agents
- **Diamond/open icon** ( ) prefix instead of status dot
- **No status label** (no WORKING/IDLE)
- **DEPLOY button** instead of task info
- **Trait radar mini-chart**: 4-point diamond showing category strengths

```
+-----------------------------------------------+
|  ◇ SENTINEL                         [DEPLOY]  |
|  QA specialist with deep testing focus         |
|                                                |
|        ENG                                     |
|         /\                                     |
|   PRD--/  \--QUA                               |
|         \/                                     |
|        CRF                                     |
+-----------------------------------------------+
```

The 4 axes of the radar chart:
- ENG (Engineering): max of architecture_focus, modular_architecture, technical_depth
- QUA (Quality): max of qa_scalability, qa_correctness, testing_unit, testing_acceptance
- PRD (Product): max of product_design, uiux_focus, business_objectives
- CRF (Craft): max of code_review, documentation

Rendered as:
- **Web**: Inline SVG, green stroke with fill at 0.15 opacity
- **iOS**: SwiftUI Shape (Path)

### Deploy Flow

Tapping DEPLOY should:
1. Open a confirmation sheet (reuse SpawnAgentSheet's project selector pattern)
2. Pre-fill the callsign with the persona name
3. Show "DEPLOYING SENTINEL..." loading state
4. On success, dismiss and the agent appears in the running section

Do NOT instant-spawn on tap -- the user needs to select a project first.

---

## 6. Callsign Toggle Placement (bead: adj-adnk)

### Problem

Callsign toggles need a home that does not clutter the primary Agents view.

### Recommendation

Place in a **collapsible section at the bottom** of the Agents page:

```
> CALLSIGN ROSTER (12/16 ENABLED)
```

When expanded:

```
v CALLSIGN ROSTER (12/16 ENABLED)
  ┌─────────────────────────────────────────────┐
  │ ENABLE ALL   [=================== ON ]      │
  ├─────────────────────────────────────────────┤
  │ ZERATUL  [ON ]  ARTANIS  [ON ]  FENIX  [ON ]│
  │ TASSADAR [ON ]  ALDARIS  [OFF]  VORAZUN[ON ]│
  │ KARAX    [ON ]  ROHANA   [ON ]  SELENDIS[ON]│
  │ RASZAGAL [ON ]  TALANDAR [OFF]  ALARAK [OFF]│
  │ ADUN     [ON ]  NAHAAN   [OFF]  URUN   [ON ]│
  │ MOHANDAR [ON ]                               │
  └─────────────────────────────────────────────┘
```

**Web toggle styling:**
- Custom rectangle toggle: `[===ON ]` / `[ OFF===]`
- ON state: green fill, glow
- OFF state: dim, no glow
- Transition: 200ms ease

**iOS toggle styling:**
- Standard SwiftUI Toggle with `.tint(theme.primary)` for CRT green
- Grid layout: `LazyVGrid(columns: [.adaptive(minimum: 120)])

**Master toggle:**
- Positioned at the top of the expanded section
- Toggling OFF disables all callsigns below (they grey out)
- Toggling ON re-enables the previous individual states (stored locally)

---

## 7. Preset Persona Templates (bead: adj-s3lc)

### Shipped Presets

| Name       | Description                      | Top Traits                                      |
|------------|----------------------------------|-------------------------------------------------|
| ARCHITECT  | System design specialist         | system_design=18, modularity=16, deep_tech=14   |
| SENTINEL   | Quality gatekeeper               | correctness=18, unit_tests=16, e2e_tests=14     |
| DESIGNER   | Product & UX focused             | product_design=18, uiux_focus=16, biz_value=10  |
| WORKHORSE  | Balanced full-stack contributor  | All traits at 8 (96/100)                        |
| SCRIBE     | Documentation & review focused   | documentation=18, code_review=18, biz_value=10  |

### UX Rules

- Presets are **read-only** (cannot edit or delete)
- Show a "DUPLICATE" action (not "EDIT") that creates an editable copy
- Presets appear in a "TEMPLATES" subsection above user-created personas
- Presets use a slightly different visual treatment: dim label "[TEMPLATE]"
  badge on the card to distinguish from user personas
- Presets can be deployed directly (same as user personas)

### Rationale

Presets solve three problems:
1. **Cold start**: New users see examples of well-configured personas
2. **Mental model**: Users understand how point distribution creates specialization
3. **Quick start**: Power users can duplicate and tweak instead of building from scratch

---

## 8. Empty-State Onboarding (bead: adj-3qgk)

When 0 user-created personas exist and no preset duplicates have been made:

```
┌───────────────────────────────────────────────────┐
│                                                   │
│     BUILD YOUR FIRST AGENT PERSONA                │
│                                                   │
│     Define specialized roles with custom           │
│     trait distributions. Budget 100 points         │
│     across 12 skills to create focused agents.    │
│                                                   │
│              [ CREATE PERSONA ]                   │
│                                                   │
│     ─── OR START FROM A TEMPLATE ───              │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │ARCHITECT│  │SENTINEL │  │DESIGNER │          │
│  │  ◆◆◆   │  │  ◆◆◆   │  │  ◆◆◆   │          │
│  │ [DUPE]  │  │ [DUPE]  │  │ [DUPE]  │          │
│  └─────────┘  └─────────┘  └─────────┘          │
│                                                   │
└───────────────────────────────────────────────────┘
```

Follows the existing empty-state pattern from AgentListView (icon + header
+ description + action button).

---

## 9. Editor Layout (bead: adj-rf31)

### Web: Two-Column Editor

```
┌─────────────────────────────────┬──────────────────────────┐
│ PERSONA EDITOR                  │ PROMPT PREVIEW           │
│                                 │                          │
│ NAME: [________________]        │ # Sentinel               │
│ DESC: [________________]        │ You are a QA-focused     │
│                                 │ agent...                 │
│ BUDGET [#][#][#][#][#][#][ ][ ] │                          │
│        072/100 PTS              │ ## Quality Focus         │
│                                 │ You prioritize           │
│ v ENGINEERING                   │ correctness above all... │
│   SYSTEM DESIGN  [###...] 12/20 │                          │
│   MODULARITY     [##....] 06/20 │ ## Testing Discipline    │
│   DEEP TECH      [####..] 10/20 │ Write comprehensive      │
│                                 │ unit tests for every...  │
│ v QUALITY                       │                          │
│   CORRECTNESS    [######] 16/20 │ ## Engineering           │
│   SCALE TESTING  [#.....] 04/20 │ Apply moderate attention │
│   UNIT TESTS     [###...] 12/20 │ to system design...      │
│   E2E TESTS      [####..] 10/20 │                          │
│                                 │                          │
│ > PRODUCT (collapsed)           │                          │
│ > CRAFT (collapsed)             │                          │
│                                 │                          │
│     [ SAVE PERSONA ]            │                          │
└─────────────────────────────────┴──────────────────────────┘
```

- Left panel: 60% width, scrollable form
- Right panel: 40% width, sticky prompt preview
- Budget gauge pinned to top of left panel (sticky)
- Prompt preview updates live as sliders move (debounce 200ms)
- Changed prompt sections flash briefly on update

### iOS: Single-Column with Preview Sheet

- Full-width editor (same layout as left panel above)
- Budget gauge pinned to top of scroll view
- "PREVIEW PROMPT" button at bottom opens a sheet
- Sheet uses terminal styling (monospace, dark bg, green text)
- On iPad landscape: consider NavigationSplitView for side-by-side

---

## 10. Agents Page Section Ordering

Final page layout from top to bottom:

1. **Page header** (AGENTS title + SPAWN button)
2. **Workload summary** (active/idle/blocked/offline counts)
3. **Persona roster** section (standby cards + BUILD PERSONA button)
   - Templates subsection (if presets visible)
   - User personas subsection
4. **Running agents** grouped by status (WORKING > BLOCKED > STUCK > IDLE)
5. **Offline agents** (collapsed by default, existing pattern)
6. **Callsign roster** (collapsed by default)

The persona roster sits above running agents because it represents
*potential* resources the user can deploy -- primary interaction surface.

---

## 11. Theme Compatibility Notes

The current codebase supports multiple themes (pipboy, starcraft, document,
friendly). Design considerations:

- All CRT glow effects (slider segments, budget gauge, radar chart) should
  use `var(--crt-phosphor)` and `var(--crt-phosphor-glow)` CSS variables
  for automatic theme adaptation
- Non-CRT themes (document, friendly) should gracefully degrade:
  - Stepped sliders become standard range inputs with accent color
  - Budget gauge becomes a simple progress bar
  - Radar chart keeps the same shape but uses theme accent color
- Check the `[data-theme='document']` and `[data-theme='friendly']` override
  blocks in globals.css for the existing pattern

---

## Design Beads Summary

| Bead ID    | Title                                              | Wired To       | Priority |
|------------|-----------------------------------------------------|----------------|----------|
| adj-s0t2   | Group 12 traits into 4 cognitive categories         | 033.5, 033.6   | P2       |
| adj-xs1k   | Retro-terminal budget gauge                         | 033.5, 033.6   | P2       |
| adj-s3lc   | Ship 3-5 preset persona templates                   | 033            | P2       |
| adj-bpxp   | Standby roster card with radar mini-chart           | 033.5, 033.6   | P2       |
| adj-4jb0   | Soft-cap budget enforcement with amber warning      | 033.5, 033.6   | P2       |
| adj-adnk   | Callsign toggles as collapsible panel               | 033.5, 033.6   | P2       |
| adj-3qgk   | Empty-state onboarding for zero-persona page        | 033            | P3       |
| adj-b93s   | Rename trait labels for non-technical clarity        | 033            | P3       |
| adj-zkxv   | Retro-styled stepped slider                         | 033.5, 033.6   | P2       |
| adj-rf31   | Editor layout with live prompt preview panel        | 033.5, 033.6   | P2       |
