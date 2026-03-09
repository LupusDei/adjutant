# QA Review: adj-057 Idle Agent Proposal Generation

**Reviewer**: qa-1
**Date**: 2026-03-09
**Status**: Phase A Complete (Spec Review) | Phase B Pending (Code Review)
**Epic**: adj-057

---

## Phase A: Spec Review Findings

### A1. CRITICAL: Debounce Key Collision Risk

The spec says debounce state is stored via `AdjutantState.setMeta()` with per-agent keys. The existing `self-improver` behavior uses the prefix `self_improver_debounce_` for its meta keys. The spec does NOT specify what prefix the idle-proposal-nudge behavior should use.

**Risk**: If the implementation chooses a key like `idle_nudge_<agentId>`, it is safe. But if it accidentally reuses or overlaps with the self-improver prefix, debounce state will collide.

**Recommendation**: The implementation MUST use a distinct, namespaced prefix like `idle_proposal_nudge_` and this should be documented in the spec as a requirement.

**Severity**: Medium (design gap, not a spec error)

---

### A2. ISSUE: Spec Does Not Define What "Disconnected" Means in Agent Profile Context

FR-007 says: "Behavior MUST NOT schedule checks for disconnected agents." The `AgentProfile` has both `lastStatus` and `disconnectedAt` fields. An agent could have:
- `lastStatus = "idle"` but `disconnectedAt != null` (went idle, then disconnected before event processed)
- `lastStatus = "disconnected"` (explicitly set by agent-lifecycle behavior on `mcp:agent_disconnected`)

**Question**: Which field should the behavior check? The event payload `AgentStatusEvent` has `status: string` which will be `"idle"` when the event fires. But by the time the behavior processes it, the agent may have disconnected.

**The correct approach**: The behavior should check `AgentProfile.disconnectedAt !== null` OR `AgentProfile.lastStatus === "disconnected"` at the time of processing, not just rely on the event payload. The agent-lifecycle behavior sets `lastStatus = "disconnected"` on `mcp:agent_disconnected`, so checking `lastStatus` from the profile is the most reliable indicator.

**Severity**: Medium (ambiguity that could cause wasted scheduleChecks for unreachable agents)

---

### A3. ISSUE: Race Between agent:status_changed and mcp:agent_disconnected

Consider this sequence:
1. Agent reports `status: "idle"` via `set_status` MCP tool
2. `agent:status_changed` fires with `status: "idle"`
3. Agent's SSE connection drops
4. `mcp:agent_disconnected` fires
5. `agent-lifecycle` behavior sets `lastStatus = "disconnected"`, `disconnectedAt = now`

If the idle-proposal-nudge behavior processes step 2 before step 4-5 completes, it will see the agent as connected and idle, and schedule a check. Five minutes later, the coordinator wakes to find a disconnected agent.

**This is acceptable per the spec** (edge case note says "coordinator checks before acting"), but the implementation should still be aware that `scheduleCheck` fires are not cancellable after scheduling -- the coordinator must verify agent connectivity before nudging.

**Severity**: Low (acknowledged edge case, but worth a test to ensure no crash)

---

### A4. ISSUE: The `act()` Signature Provides CommunicationManager

The `AdjutantBehavior.act()` interface requires `(event, state, comm)` as parameters. The new behavior will receive `CommunicationManager` as the third argument whether it wants it or not. The spec says the behavior must NEVER use `comm.messageAgent()`.

**Risk**: Nothing prevents a future developer from using `comm` in this behavior. The spec says "never" but there's no compile-time enforcement.

**Recommendation**: Tests should explicitly verify that `comm.messageAgent` is never called (mock it and assert `toHaveBeenCalledTimes(0)`). The implementation should use `_comm` (underscore prefix) to signal unused parameter.

**Severity**: Low (convention, not a bug -- but tests should enforce it)

---

### A5. DESIGN QUESTION: scheduleCheck Reason String Becomes Part of a Single-Line Prompt

Looking at `stimulus-engine.ts` line 454, the `buildSituationPrompt()` function collapses the entire prompt to a single line: `lines.join("\n").replace(/\n+/g, " ").trim()`. The scheduleCheck `reason` string is embedded in this prompt as `In Nm: "reason"`.

**Impact**: If `buildScheduleReason()` produces a multi-line reason string with newlines, they will be collapsed to spaces. This is fine for readability but means the implementation should NOT rely on newlines for structure in the reason string. Alternatively, it could use markdown-style bullets with dashes, which collapse gracefully.

**Severity**: Low (informational -- affects formatting, not correctness)

---

### A6. ISSUE: Debounce Reset Mechanism Is Underspecified

Spec says (Edge Cases section): "Debounce resets after the agent transitions through a non-idle state." But the behavior only triggers on `agent:status_changed`. When the agent goes back to "working", the behavior fires but `shouldAct` would return false (since status != idle).

**Question**: How does the debounce meta key get cleared when the agent transitions to a non-idle state?

**Options**:
1. The behavior listens to ALL `agent:status_changed` events and clears the debounce key when status != idle (requires logic in `act()` for non-idle events too)
2. The debounce key stores a timestamp-based approach (like self-improver) where it expires naturally
3. The debounce key is associated with a specific "idle period" identifier

Option 1 is the cleanest but means the behavior has additional logic for non-idle transitions. The spec does not clarify which approach to use.

**Severity**: High (without debounce reset, an agent that goes idle -> working -> idle will never get a second nudge)

---

### A7. QUESTION: What Happens to the Scheduled Check When Agent Leaves Idle?

The behavior calls `stimulusEngine.scheduleCheck(300000, reason)` and gets back a check ID. The spec says to store this ID for debounce via `setMeta()`.

But `StimulusEngine.cancelCheck(id)` exists. Should the behavior cancel the pending check when the agent transitions away from idle? The spec says the coordinator should check current status before acting, which implies the check is NOT cancelled -- it fires, and the coordinator decides to skip.

**However**: This means unnecessary coordinator wakes. If 10 agents go idle then back to working within 5 minutes, the coordinator gets 10 pointless wakes.

**Trade-off**: The spec's approach (let it fire, coordinator decides) is simpler but noisier. Cancelling would be cleaner but requires the behavior to track check IDs AND handle non-idle transitions.

**Recommendation**: The spec approach is acceptable for now, but the implementation should store the check ID so cancellation can be added later. This is implicitly part of the debounce state (A6).

**Severity**: Medium (efficiency concern, not correctness)

---

### A8. QUESTION: Stimulus Engine 90-Second Cooldown Interaction

The stimulus engine has a 90-second cooldown between wakes. If multiple agents go idle within 90 seconds of each other, only the LAST queued wake fires (see `ensureCooldownTimer` -- it fires `cooldownQueue[length-1]`).

**Impact**: If agent-A goes idle, scheduleCheck fires at T+5min, coordinator wakes. Then agent-B's scheduleCheck fires at T+5min+30s -- but it's within cooldown. Agent-B's wake is queued and fires at T+5min+90s. This is fine.

**But**: If agent-A and agent-B both have scheduleChecks fire within 90s of each other (both went idle at nearly the same time), only agent-B's wake reason reaches the coordinator. Agent-A's context is lost.

**This is a pre-existing limitation of the stimulus engine**, not a bug in this feature. But the spec should acknowledge it.

**Mitigation**: The behavior could combine multiple idle agents into a single scheduleCheck if they go idle within a short window. This is out of scope for adj-057 but worth noting.

**Severity**: Medium (pre-existing limitation, but this feature amplifies it)

---

### A9. EDGE CASE: ProposalStore.getProposals() Error Handling

The spec says `buildScheduleReason()` queries ProposalStore for pending and dismissed proposals. `ProposalStore.getProposals()` runs a SQLite query. If the database is unavailable or the query throws:

- Does the behavior catch the error and schedule without proposal context?
- Does it skip the scheduleCheck entirely?
- Does it propagate the error up?

The spec does not address error handling in `buildScheduleReason()`. The existing `self-improver` behavior has no try/catch either -- errors propagate to the behavior registry dispatcher.

**Recommendation**: The implementation should wrap ProposalStore calls in try/catch and degrade gracefully (schedule the check with a note that proposal context was unavailable, rather than failing silently).

**Severity**: Medium (robustness gap)

---

### A10. EDGE CASE: Adjutant Coordinator Agent as "Idle" Agent

What if the Adjutant coordinator agent itself reports idle status? Should the behavior schedule a check to wake itself to tell itself to make proposals?

The spec does not exclude any specific agent IDs. The behavior should probably skip the "adjutant" agent (or whatever the coordinator's agent ID is) to avoid circular self-nudging.

**Recommendation**: Add a guard that skips the coordinator's own agent ID, or document that the coordinator never reports "idle" status via MCP.

**Severity**: Low (unlikely but worth a defensive check)

---

### A11. SPEC COMPLETENESS: No "Accepted" Proposals in Context

The spec says the reason string includes "pending" and "dismissed" proposal summaries. But `ProposalStatus` has four values: `pending`, `accepted`, `dismissed`, `completed`.

Should "accepted" proposals be included in the context? An accepted proposal that hasn't been completed yet is still active work. The coordinator might want to know about it when deciding what to nudge the idle agent toward.

**Recommendation**: Include accepted proposals in the context (they represent in-flight work the idle agent could help with).

**Severity**: Low (enrichment opportunity, not a correctness issue)

---

## Summary of Findings

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A1 | Medium | Design Gap | Debounce key prefix must be namespaced to avoid collision with self-improver |
| A2 | Medium | Ambiguity | "Disconnected" check should use profile.lastStatus, not just event payload |
| A3 | Low | Race Condition | Idle event may fire before disconnect -- coordinator must verify connectivity |
| A4 | Low | Convention | Tests must assert comm.messageAgent is never called |
| A5 | Low | Informational | Reason string collapses to single line -- format accordingly |
| A6 | High | Underspecified | Debounce reset mechanism for non-idle transitions is unclear |
| A7 | Medium | Design | Pending checks are not cancelled when agent leaves idle -- noisy but acceptable |
| A8 | Medium | Pre-existing | Stimulus engine cooldown can drop context for near-simultaneous idle agents |
| A9 | Medium | Robustness | No error handling spec for ProposalStore query failures |
| A10 | Low | Edge Case | Coordinator agent itself could be detected as idle (circular nudge) |
| A11 | Low | Enrichment | Accepted proposals not included in context -- missed opportunity |

**Blocking issues**: A6 (High) -- debounce reset must be clarified before implementation is correct.

---

## Phase B: Code Review

**Status**: Waiting for engineer-1 to push branch `fix/adj-057.1-idle-proposal-nudge`

Will update this section when the branch is available.

### Code Review Checklist (Pending)

- [ ] `createIdleProposalNudge` matches spec
- [ ] ONLY calls `stimulusEngine.scheduleCheck()` -- never `comm.messageAgent()`
- [ ] No `schedule` property (no cron)
- [ ] Does NOT import CommunicationManager
- [ ] Debounce uses namespaced meta key (not colliding with self-improver)
- [ ] Debounce resets on non-idle transition
- [ ] `buildScheduleReason()` includes all required context
- [ ] 12-proposal cap uses `>=` not `>`
- [ ] Disconnected agents skipped
- [ ] Tests cover all acceptance scenarios
- [ ] Handles simultaneous idle agents independently
- [ ] scheduleCheck delay is exactly 300000ms
- [ ] `shouldAct` filters for status=idle only
- [ ] Error handling for ProposalStore queries
- [ ] `_comm` parameter naming convention
