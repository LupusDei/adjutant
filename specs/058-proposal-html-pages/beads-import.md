# Proposals as Shareable Standalone HTML Pages - Beads

**Feature**: 058-proposal-html-pages
**Generated**: 2026-06-17
**Source**: specs/058-proposal-html-pages/tasks.md

## Root Epic

- **ID**: adj-200
- **Title**: Proposals as Shareable Standalone HTML Pages
- **Type**: epic
- **Priority**: 1
- **Description**: Extend proposals with an optional self-contained HTML body and a
  publish/share mechanism. One backend composition pipeline produces one sanitized,
  self-contained document served two ways: embedded sandboxed viewer (web `iframe srcdoc` /
  iOS `WKWebView.loadHTMLString`) for authed in-app reading, and an unauthenticated
  `GET /p/:token` public route for no-API-key link sharing.

## Epics

### Phase 1 — Setup: backend deps
- **ID**: adj-200.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 1

### Phase 2 — Foundational / Path A: backend core
- **ID**: adj-200.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: adj-200.3, adj-200.4, adj-200.5, adj-200.6
- **Tasks**: 6 (T-pairs counted as one task each where split)

### Phase 3 — US2 / Path B: MCP authoring contract
- **ID**: adj-200.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 4 — US1+US3 / Path C: Web in-frame viewer + sharing
- **ID**: adj-200.4
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 4

### Phase 5 — US4 / Path D: iOS in-app browser + sharing
- **ID**: adj-200.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

### Phase 6 — US5 / Path E: Architecture diagrams (stretch)
- **ID**: adj-200.6
- **Type**: epic
- **Priority**: 3
- **Tasks**: 2

### Phase 7 — Polish: Cross-Cutting
- **ID**: adj-200.7
- **Type**: epic
- **Priority**: 2
- **Depends**: adj-200.3, adj-200.4, adj-200.5
- **Tasks**: 2

## Tasks

### Phase 1 — Setup
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add sanitize-html + markdown-it (+types) | backend/package.json | adj-200.1.1 |

### Phase 2 — Foundational / Path A
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T002 | Migration 035 + extend Proposal types | backend/src/services/migrations/035-proposals-public-html.sql | adj-200.2.1 |
| T003 | proposal-store sharing methods + token gen | backend/src/services/proposal-store.ts | adj-200.2.2 |
| T004 | Sanitizer service (security/XSS suite) | backend/src/services/proposal-sanitize.ts | adj-200.2.3 |
| T005 | Compose/template service (self-contained + md fallback) | backend/src/services/proposal-html.ts | adj-200.2.4 |
| T006 | Public route GET /p/:token + auth bypass + CSP | backend/src/routes/public-proposals.ts | adj-200.2.5 |
| T007 | REST publish/unpublish + extend GET payload | backend/src/routes/proposals.ts | adj-200.2.6 |

### Phase 3 — US2 / Path B: MCP authoring contract
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Extend create_proposal/revise_proposal (html, public) | backend/src/services/mcp-tools/proposals.ts | adj-200.3.1 |
| T009 | publish_proposal / unpublish_proposal MCP tools | backend/src/services/mcp-tools/proposals.ts | adj-200.3.2 |
| T010 | Tool descriptions + agent authoring guidance | backend/src/services/mcp-tools/proposals.ts | adj-200.3.3 |

### Phase 4 — US1+US3 / Path C: Web
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T011 | api.ts publish/unpublish + extend Proposal type | frontend/src/services/api.ts | adj-200.4.1 |
| T012 | Sandboxed iframe viewer component | frontend/src/components/proposals/ProposalPageViewer.tsx | adj-200.4.2 |
| T013 | DetailView: View-as-Page + publish/copy-link/open + badge | frontend/src/components/proposals/ProposalDetailView.tsx | adj-200.4.3 |
| T014 | Full-page standalone route #proposal/:id | frontend/src/App.tsx + ProposalPage.tsx | adj-200.4.4 |

### Phase 5 — US4 / Path D: iOS
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Proposal model fields + APIClient publish/unpublish | ios/AdjutantKit/.../Models/Proposal.swift + APIClient+Proposals.swift | adj-200.5.1 |
| T016 | ProposalWebView (WKWebView) + public-URL builder | ios/Adjutant/Features/Proposals/ProposalWebView.swift | adj-200.5.2 |
| T017 | Read-as-Page button + publish toggle + share sheet + route | ios/Adjutant/Features/Proposals/ProposalDetailView.swift + Coordinator.swift | adj-200.5.3 |

### Phase 6 — US5 / Path E: Diagrams (stretch)
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T018 | Server-side Mermaid→SVG pre-render at compose time | backend/src/services/proposal-html.ts | adj-200.6.1 |
| T019 | Richer template + agent diagram examples | backend/src/services/proposal-html.ts | adj-200.6.2 |

### Phase 7 — Polish
| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T020 | Docs: architecture rule + CLAUDE.md proposal section | .claude/rules/04-architecture.md + CLAUDE.md | adj-200.7.1 |
| T021 | End-to-end verification + CHANGELOG | backend/tests/integration/proposal-share-e2e.test.ts | adj-200.7.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | 1 | 1 | adj-200.1 |
| 2: Foundational / Path A | 6 | 1 | adj-200.2 |
| 3: US2 / Path B (MCP) | 3 | 1 | adj-200.3 |
| 4: US1+US3 / Path C (web, MVP) | 4 | 1 | adj-200.4 |
| 5: US4 / Path D (iOS) | 3 | 2 | adj-200.5 |
| 6: US5 / Path E (diagrams, stretch) | 2 | 3 | adj-200.6 |
| 7: Polish | 2 | 2 | adj-200.7 |
| **Total** | **21** | | |

## Dependency Graph

```
Phase 1: Setup (adj-200.1)
    |
Phase 2: Path A backend core (adj-200.2) --blocks--> Path B, C, D, E
    |
    +----------------+----------------+----------------+----------------+
    |                |                |                |
Phase 3: Path B   Phase 4: Path C  Phase 5: Path D  Phase 6: Path E
 MCP (adj-200.3)  web (adj-200.4)  iOS (adj-200.5)  diagrams (adj-200.6)
    |                |                |
    +-------+--------+----------------+
            |
    Phase 7: Polish (adj-200.7)  [depends B, C, D]
```

## Improvements

Improvements (Level 4: adj-200.N.M.P) are NOT pre-planned. They are created during
implementation when bugs, refactors, or extra tests are discovered (e.g. a sanitizer bypass
found in review → `adj-200.2.3.1` type=bug, wired under adj-200.2.3).
