# Beads Import: Permanent fix for recurring bd/dolt outages

**Root epic**: `adj-182` (type=epic, priority=1)
Prefix `adj`. Sub-epic number = phase number. Task = `adj-182.<phase>.<n>`.

## Hierarchy

```
adj-182  Permanent fix for recurring bd/dolt outages (epic, P1)
  adj-182.1  Phase 1 — Stop the bleeding (epic, P1)
    adj-182.1.1  Dolt port registry + allocator (task)
    adj-182.1.2  Pin writer: metadata.json + dolt/config.yaml + env (task)
    adj-182.1.3  Supervisor generator: launchd plist + systemd unit (task)
    adj-182.1.4  installSupervisor() orchestration + script entrypoint (task)
    adj-182.1.5  bd-doctor.sh: kickstart restart + rogue-dolt kill (task)
    adj-182.1.6  doltLiveCutover() orchestration (task)
    adj-182.1.7  Cutover runbook + adjutant acceptance validation (task, docs)
  adj-182.2  Phase 2 — Adjutant integration (epic, P1)
    adj-182.2.1  checkDolt() health group in adjutant doctor (task)
    adj-182.2.2  adjutant doctor --fix dolt repair path (task)
    adj-182.2.3  adjutant init installs supervisor + pins port (task)
    adj-182.2.4  Reconnecting backend bd-client (re-read endpoint, backoff) (task)
    adj-182.2.5  ensureDoltSupervisor() + health/self-heal loop (task)
    adj-182.2.6  Enable Dolt auto-commit on supervised server (task)
  adj-182.3  Phase 3 — Worktree + multi-project sweep + bd upgrade (epic, P2)
    adj-182.3.1  provision-worktree.sh: export pinned port, no stray dolt dir (task)
    adj-182.3.2  fleet-install-dolt.sh: sweep registry hasBeads projects (task)
    adj-182.3.3  bd 0.60.0 → 1.0.4 fleet upgrade + verify (task, docs)
  adj-182.4  Phase 4 — Remote / shared tier (epic, P3, optional)
    adj-182.4.1  Shared-SQL opt-in via registry flag (task)
    adj-182.4.2  Linux systemd --user unit + doctor degradation (task)
    adj-182.4.3  Unix-domain-socket evaluation spike (task, docs)
```

## T-ID → Bead ID map

| T-ID(s) | Bead ID | Title | Type | Pri |
|---|---|---|---|---|
| T001a/b | adj-182.1.1 | Dolt port registry + allocator | task | 1 |
| T002a/b | adj-182.1.2 | Pin writer (metadata/config/env) | task | 1 |
| T003a/b | adj-182.1.3 | Supervisor generator (plist/unit) | task | 1 |
| T004a/b/c | adj-182.1.4 | installSupervisor() + entrypoint | task | 1 |
| T005a/b | adj-182.1.5 | bd-doctor kickstart + rogue-kill | task | 1 |
| T006a/b | adj-182.1.6 | doltLiveCutover() orchestration | task | 1 |
| T007 | adj-182.1.7 | Cutover runbook + acceptance | task | 1 |
| T008a/b | adj-182.2.1 | checkDolt() health group | task | 1 |
| T009a/b | adj-182.2.2 | doctor --fix dolt repair | task | 1 |
| T010a/b | adj-182.2.3 | adjutant init installs supervisor | task | 1 |
| T011a/b | adj-182.2.4 | Reconnecting bd-client | task | 1 |
| T012a/b | adj-182.2.5 | ensureDoltSupervisor() + health loop | task | 1 |
| T013a/b | adj-182.2.6 | Dolt auto-commit enabled | task | 1 |
| T014a/b | adj-182.3.1 | provision-worktree pinned port | task | 2 |
| T015a/b | adj-182.3.2 | fleet-install-dolt sweep | task | 2 |
| T016 | adj-182.3.3 | bd upgrade 1.0.4 + verify | task | 2 |
| T017a/b | adj-182.4.1 | Shared-SQL opt-in | task | 3 |
| T018a/b | adj-182.4.2 | systemd unit + degradation | task | 3 |
| T019 | adj-182.4.3 | unix-socket spike | task | 3 |

## Dependency wiring

Parent→child (root depends on sub-epics; sub-epics depend on tasks):
```
adj-182 → adj-182.1, adj-182.2, adj-182.3, adj-182.4
adj-182.1 → .1.1 .1.2 .1.3 .1.4 .1.5 .1.6 .1.7
adj-182.2 → .2.1 .2.2 .2.3 .2.4 .2.5 .2.6
adj-182.3 → .3.1 .3.2 .3.3
adj-182.4 → .4.1 .4.2 .4.3
```
Phase ordering (sub-epic blocks):
```
adj-182.2 depends on adj-182.1
adj-182.3 depends on adj-182.2
adj-182.4 depends on adj-182.3
```
Intra-phase task ordering:
```
adj-182.1.2 ← adj-182.1.1
adj-182.1.4 ← adj-182.1.2, adj-182.1.3
adj-182.1.6 ← adj-182.1.4, adj-182.1.5
adj-182.1.7 ← adj-182.1.6
adj-182.2.2 ← adj-182.2.1
adj-182.2.5 ← adj-182.2.4
adj-182.3.1 ← adj-182.1.1
adj-182.3.2 ← adj-182.1.4
```
Parallelizable (no intra-phase dep): .1.1, .1.3, .1.5 · .2.1, .2.4, .2.6 · .4.x
