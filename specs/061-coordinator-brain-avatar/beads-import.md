# Beads Import — 061 Coordinator-as-Brain Avatar

Root epic: **adj-202.7** (child of adj-202 "The Bridge").

| Bead | Type | Pri | Title | Phase | Depends on |
|---|---|---|---|---|---|
| adj-202.7.1 | epic | P0 | Phase 0 latency spike / go-no-go | 0 | — (GATES all) |
| adj-202.7.2 | epic | P0 | bridgeBrain toggle + session mode plumbing | 1 | 202.7.1 |
| adj-202.7.3 | epic | P0 | Local-model coordinator brain (tools+memory+persona) | 2 | 202.7.1, 202.7.2 |
| adj-202.7.4 | epic | P1 | Streaming STT + TTS pipeline | 3 | 202.7.3 |
| adj-202.7.5 | epic | P1 | Per-turn latency instrumentation + A/B | 4 | 202.7.2 |
| adj-202.7.6 | epic | P1 | iOS + web brain toggle UI | 5 | 202.7.2 |
| adj-202.7.7 | epic | P2 | Fallback modes (runway default + separate) | 6 | 202.7.2 |
| adj-202.7.8 | epic | P3 | Vision spike (optional) | 7 | 202.7.3 |

Task-level beads (adj-202.7.N.M) are created per phase during implementation from tasks.md.

**Critical gate:** 202.7.1 (spike) must land a GO in findings.md before 202.7.2+ start.
