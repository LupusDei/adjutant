# Agent Card Cost & Context Display — Tasks

**Feature**: 037-agent-card-cost-context
**Root Epic**: adj-063

## Phase 1: Backend — Type + Enrichment

- [ ] T001 [US1] Add cost and contextPercent fields to CrewMember type in backend/src/types/index.ts
- [ ] T002 [US1] Enrich CrewMember with cost data in backend/src/services/agents-service.ts using getSessionCost()
- [ ] T003 [US1] Add context % estimation helper (total tokens / 200k model limit)
- [ ] T004 [US1] Tests for cost enrichment in agents-service

## Phase 2: Frontend — SwarmAgentCard

- [ ] T005 [US1] Add cost + contextPercent fields to frontend CrewMember type in frontend/src/types/index.ts
- [ ] T006 [US1] Display cost + context bar in SwarmAgentCard top-right in frontend/src/components/crew/SwarmAgentCard.tsx

## Phase 3: iOS — AgentRowView

- [ ] T007 [US1] Add cost + contextPercent fields to iOS CrewMember model in ios/AdjutantKit/Sources/AdjutantKit/Models/Agent.swift
- [ ] T008 [US1] Display cost + context in AgentRowView top-right in ios/Adjutant/Features/Agents/AgentRowView.swift

## Phase 4: QA

- [ ] T009 [US1] QA: edge cases — no cost data, zero tokens, overflow, offline agents
