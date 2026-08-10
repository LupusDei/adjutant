# Beads Import: Adjutant Artifacts (065)

**Root epic:** `adj-j7az6`

## Hierarchy

| Bead ID | Type | Title | T-IDs | Depends on |
|---|---|---|---|---|
| `adj-j7az6` | epic | Adjutant Artifacts (root) | — | — |
| `adj-j7az6.1` | epic | Phase 1: Backend artifact engine | — | — |
| `adj-j7az6.1.1` | task | Migration 039-artifacts.sql | T101 | — |
| `adj-j7az6.1.2` | task | artifact-store.ts | T102a/b | .1.1 |
| `adj-j7az6.1.3` | task | artifact-html.ts (composeArtifactDocument) | T103a/b | .1.1 |
| `adj-j7az6.1.4` | task | routes/artifacts.ts (REST + download) | T104a/b | .1.2, .1.3 |
| `adj-j7az6.1.5` | task | routes/public-artifacts.ts (/a/:token + download) | T105a/b | .1.2, .1.3 |
| `adj-j7az6.2` | epic | Phase 2: Agent authoring via MCP | — | .1 |
| `adj-j7az6.2.1` | task | mcp-tools/artifacts.ts | T201a/b | (.1) |
| `adj-j7az6.3` | epic | Phase 3: Web Artifacts page | — | .1 |
| `adj-j7az6.3.1` | task | api.ts artifacts client + buildPublicArtifactUrl | T301a/b | (.1) |
| `adj-j7az6.3.2` | task | ArtifactsView + ArtifactCard + ARTIFACTS tab | T302a/b | .3.1 |
| `adj-j7az6.3.3` | task | ArtifactViewer + Download button | T303a/b | .3.1 |
| `adj-j7az6.3.4` | task | CreateArtifactForm (paste/upload) | T304a/b | .3.1 |
| `adj-j7az6.4` | epic | Phase 4: iOS Artifacts in Settings | — | .1 |
| `adj-j7az6.4.1` | task | Artifact model + APIClient+Artifacts | T401a/b | (.1) |
| `adj-j7az6.4.2` | task | ArtifactsViewModel | T402a/b | .4.1 |
| `adj-j7az6.4.3` | task | ArtifactsView in Settings + WKWebView viewer | T403 | .4.2 |
| `adj-j7az6.4.4` | task | Download/Save to Files + share sheet | T404 | .4.1 |
| `adj-j7az6.5` | epic | Phase 5: Security & polish | — | .1 |
| `adj-j7az6.5.1` | task | XSS/mXSS regression suite on /a/:token | T501a/b | .1.5 |
| `adj-j7az6.5.2` | task | docs/artifact-authoring.md | T502 | (.1) |
| `adj-j7az6.5.3` | task | Polish: slug + empty/error states + a11y | T503 | (.3, .4) |

Parenthetical deps are the implicit phase-gate (via the sub-epic's dep on `.1`); explicit
task→task deps are listed where they exist. Parent-child is expressed by dotted ID.

## Ready-now entry points (after this lands)

- `adj-j7az6.1.1` (migration) → unblocks `.1.2` and `.1.3` (parallel) → `.1.4` ∥ `.1.5`.
- Once `adj-j7az6.1` merges: `.2`, `.3.1`, `.4.1` become the three parallel-track entry points.
