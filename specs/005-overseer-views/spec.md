# Feature Specification: Overseer Views & Mayor Chat

**Feature ID**: 005-overseer-views
**Status**: In Progress
**Created**: 2026-01-22

## Overview

Enhance the Gastown-Boy dashboard with overseer-focused filtering for Mail and Beads, plus an SMS-style conversation interface for direct communication with the Mayor.

## Problem Statement

The dashboard currently shows ALL messages and beads across the entire Gas Town, which is overwhelming for the human overseer:
- **Mail tab**: Cluttered with internal polecat messages, witness notifications, and agent-to-agent chatter
- **Beads tab**: Full of internal messaging beads, role beads, and infrastructure work items that aren't relevant to oversight

The overseer needs:
1. A way to filter to only see what matters to them
2. A direct conversation interface with the Mayor that feels like SMS chat

## Goals

1. Add "Overseer View" toggle to Mail that filters to mayor-related messages
2. Add "Overseer View" toggle to Beads that filters to actionable work items
3. Create SMS-style chat interface for Mayor conversations

## User Stories

### US1: Mail Overseer Filter

**As a** human overseer
**I want to** toggle a filter that shows only messages relevant to me
**So that** I can focus on what needs my attention

**Acceptance Criteria:**
- AC1.1: Toggle switch in Mail header labeled "OVERSEER VIEW"
- AC1.2: When enabled, shows only messages where from/to includes "mayor/" or "overseer"
- AC1.3: Hides polecat-to-polecat messages, witness notifications, agent internal chatter
- AC1.4: Filter preference persists in localStorage
- AC1.5: Unread count updates to reflect filtered view

### US2: Beads Overseer Filter

**As a** human overseer
**I want to** toggle a filter that shows only actionable beads
**So that** I'm not overwhelmed by internal system beads

**Acceptance Criteria:**
- AC2.1: Toggle switch in Beads header labeled "OVERSEER VIEW"
- AC2.2: When enabled, hides beads with type: "message", "role", "agent", "convoy"
- AC2.3: Hides beads from internal sources (witness, polecat-internal)
- AC2.4: Shows only: feature, bug, task, epic types that need oversight
- AC2.5: Filter preference persists in localStorage

### US3: Mayor Chat Interface

**As a** human overseer
**I want to** have SMS-style conversations with the Mayor
**So that** I can quickly communicate without formal mail compose

**Acceptance Criteria:**
- AC3.1: New "CHAT" tab in main navigation (or accessible from Mayor mail thread)
- AC3.2: Messages displayed as chat bubbles (my messages right, Mayor left)
- AC3.3: Input field at bottom with send button
- AC3.4: Auto-scrolls to newest message
- AC3.5: Shows message timestamps
- AC3.6: Polls for new messages or uses existing mail polling
- AC3.7: Creates proper mail thread internally for persistence

## Technical Approach

### Mail Filter
- Add `overseerView` boolean state to useMail hook
- Filter messages client-side where `from` or `to` contains "mayor" or "overseer"
- Persist toggle state in localStorage

### Beads Filter
- Add `overseerView` boolean state to BeadsView
- Filter out types: message, role, agent, convoy, infrastructure
- Persist toggle state in localStorage

### Chat Interface
- New `MayorChat.tsx` component
- Reuses existing mail sending via `/api/mail`
- Fetches thread messages for mayor conversation
- Bubble-style CSS (similar to SMS apps)
- Fixed thread ID for mayor conversations

## Out of Scope

- Real-time WebSocket updates (use polling)
- Multiple chat threads (just Mayor for now)
- Message editing or deletion
- Read receipts
