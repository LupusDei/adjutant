# Persona Agent Files - Beads

**Feature**: 036-persona-agent-files
**Generated**: 2026-03-09
**Source**: specs/036-persona-agent-files/tasks.md

## Root Epic

- **ID**: adj-oo3o
- **Title**: Persona agent files: --agent flag replaces paste-buffer injection
- **Type**: epic
- **Priority**: 1

## Tasks

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create writeAgentFile utility + tests | backend/src/services/agent-file-writer.ts | adj-bue4 |
| T002 | Update spawn routes to use --agent flag | backend/src/routes/agents.ts, sessions.ts | adj-n22v |
| T003 | Update spawn-persona integration tests | backend/tests/unit/spawn-persona-integration.test.ts | adj-necz |
| T004 | QA: edge case testing + bug discovery | all affected files | adj-sgr6 |
