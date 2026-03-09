# Agent Card Cost & Context Display

**Feature**: 037-agent-card-cost-context
**Priority**: P1
**Created**: 2026-03-09

## Overview

Display session cost and context window utilization on agent cards across all platforms (web frontend and iOS app). This data already exists in the backend CostTracker service but is not surfaced on agent cards.

## User Stories

### US1: See agent cost and context at a glance (P1)

**As a** user monitoring my agent fleet,
**I want to** see each agent's session cost and context window usage on their card,
**So that** I can identify expensive agents and those running low on context.

**Acceptance Criteria:**
- Agent cards show session cost (e.g., "$1.23") in top-right area
- Agent cards show context window usage as a percentage bar or label
- Both web (SwarmAgentCard) and iOS (AgentRowView) display this data
- Data updates in near-real-time as agents work (polling/event-driven)
- Zero cost / no data gracefully shows nothing or "—"

## Requirements

### Functional

- FR-001: Add `cost` and `contextPercent` fields to CrewMember type (all platforms)
- FR-002: Backend agents-service enriches CrewMember with cost data from CostTracker
- FR-003: Compute context window % from total tokens used vs model context limit (200k default)
- FR-004: Frontend SwarmAgentCard displays cost + context in top-right
- FR-005: iOS AgentRowView displays cost + context in top-right
- FR-006: iOS CrewMember Swift model adds cost/context fields

### Non-Functional

- NFR-001: No additional API calls — cost data enriched in existing GET /api/agents response
- NFR-002: Graceful degradation when no cost data exists for a session
- NFR-003: Context % is an estimate based on cumulative tokens, not exact (acceptable for MVP)

## Technical Notes

- CostTracker (`backend/src/services/cost-tracker.ts`) already tracks per-session cost and tokens
- `getSessionCost(sessionId)` returns `CostEntry` with cost and token breakdown
- Context window estimation: `(input + output + cacheRead) / 200000 * 100`
  - 200k is the default context limit for Claude Opus/Sonnet models
  - Cache reads count toward context since they occupy context space
- agents-service.ts builds CrewMember objects — add cost enrichment step there
