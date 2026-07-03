# Tasks — 061 Coordinator-as-Brain Avatar (adj-202.7)

TDD-shaped per `.claude/rules/03-testing.md`. Spike/setup/docs tasks are tagged exempt.

## Phase 0 — Latency spike / go-no-go (adj-202.7.1) — GATES ALL

- [ ] T001 [scaffold] Provision a local OpenAI-compatible LLM (Ollama or MLX) + pull a
      tool-calling model (e.g. Qwen2.5-Instruct / Llama 3.x); confirm `localhost` chat + tool-call.
- [ ] T002 [setup] Add `@livekit/agents` (agents-js) to backend deps; confirm it loads with the
      existing `@livekit/rtc-node`.
- [ ] T003 [US1] Build a THROWAWAY harness (`backend/scratch/front3-spike/`) that opens a Runway
      AGENT-MODE session, joins the room, and runs mic→STT→local-LLM→TTS→published-audio for ≥5
      canned turns. Throwaway — no tests required.
- [ ] T004 [US1] Instrument the harness to log per-turn: end-of-speech, STT-final, LLM-TTFT,
      TTS-TTFB, first-avatar-frame, total. Run on the Mac; capture P50/P90 (tool-free + one
      tool turn).
- [ ] T005 [docs] Write `specs/061-.../findings.md`: measured latency vs the ~1.75s baseline, local
      vs cloud LLM delta, provider notes, and a clear GO / NO-GO. THIS GATES 7.2+.

## Phase 1 — Toggle + session mode plumbing (adj-202.7.2)

- [ ] T010a [US2] Write failing tests for `bridge-brain-mode.ts` in
      `backend/tests/unit/bridge-brain-mode.test.ts` — resolves `runway` (default) | `coordinator`
      | `separate` from setting/env; invalid → `runway`. Confirm RED.
- [ ] T010b [US2] Implement `backend/src/services/bridge-brain-mode.ts` until GREEN.
- [ ] T011a [US2] Write failing tests for the session-branch in `backend/tests/unit/avatar-routes.test.ts`
      — `runway` calls the existing broker path; `coordinator`/`separate` route to the new pipeline
      entrypoint (mocked). Confirm RED.
- [ ] T011b [US2] Implement the mode branch in `routes/avatar.ts` + `routes/bridge.ts` (additive;
      the runway path unchanged) until GREEN.

## Phase 2 — Local-model coordinator brain (adj-202.7.3)

- [ ] T020a [US3] Write failing tests for `local-llm.ts` in `backend/tests/unit/bridge-local-llm.test.ts`
      — given a transcript + the bridge tool schema, it calls the local endpoint, executes a
      returned tool via the EXISTING bridge tool bridge, and streams a reply; mock the HTTP endpoint
      + the tool bridge. Confirm RED.
- [ ] T020b [US3] Implement `backend/src/services/bridge-voice-agent/local-llm.ts` (OpenAI-compatible
      client + bridge-tool/function-calling adapter + memory recall/record + persona) until GREEN.
- [ ] T021a [US3] Write failing tests for filler-during-tools + barge-in in
      `backend/tests/unit/bridge-voice-pipeline.test.ts` — a tool-calling turn emits a filler
      utterance before the tool result; a barge-in event cancels the in-flight turn. Confirm RED.
- [ ] T021b [US3] Implement `bridge-voice-agent/pipeline.ts` turn orchestration until GREEN.

## Phase 3 — Streaming STT + TTS (adj-202.7.4)

- [ ] T030a [US4] Write failing tests for `stt.ts` adapter in `backend/tests/unit/bridge-stt.test.ts`
      — emits interim + final + endpoint events from a mocked stream. Confirm RED.
- [ ] T030b [US4] Implement `bridge-voice-agent/stt.ts` until GREEN.
- [ ] T031a [US4] Write failing tests for `tts.ts` adapter in `backend/tests/unit/bridge-tts.test.ts`
      — streams audio chunks; cancel() stops mid-stream (barge-in). Confirm RED.
- [ ] T031b [US4] Implement `bridge-voice-agent/tts.ts` + publish the track to Runway until GREEN.

## Phase 4 — Latency instrumentation + A/B (adj-202.7.5)

- [ ] T040a [US5] Write failing tests for `metrics.ts` in `backend/tests/unit/bridge-voice-metrics.test.ts`
      — records per-turn stage timings + computes P50/P90 over a turn set. Confirm RED.
- [ ] T040b [US5] Implement `bridge-voice-agent/metrics.ts` + log a per-turn summary until GREEN.
- [ ] T041 [US5] Emit metrics for BOTH modes (runway turn-around too, best-effort) — write test
      first for the emitter wiring (confirm RED), then implement until GREEN.

## Phase 5 — iOS + web toggle UI (adj-202.7.6)

- [ ] T050a [US6] Write failing tests for the web Settings brain toggle in
      `frontend/tests/unit/settings-bridge-brain.test.tsx` — renders 3 modes, persists via the API,
      shows the trade-off copy. Confirm RED.
- [ ] T050b [US6] Implement the web toggle until GREEN.
- [ ] T051a [US6] Write failing tests for the iOS `SettingsViewModel` brain setting (persist +
      default runway). Confirm RED.
- [ ] T051b [US6] Implement the iOS Settings toggle + copy until GREEN. Bump build/version.

## Phase 6 — Fallback modes (adj-202.7.7)

- [ ] T060a [US7] Write failing tests for `separate` mode persistence in
      `backend/tests/unit/bridge-transcript-persister.test.ts` — a distinct bridge identity + its OWN
      conversation; nothing lands in the user↔adjutant-coordinator DM. Confirm RED.
- [ ] T060b [US7] Implement `separate` mode wiring (distinct coordinatorId + conversation) until GREEN.
- [ ] T061 [docs] Document the three modes + how to flip + how to fully revert in
      `docs/bridge-brain-modes.md`.

## Phase 7 — Vision spike (adj-202.7.8, optional)

- [ ] T070 [US8] Spike: sample screen/camera frames from the room → feed to a multimodal model on a
      "what do you see" turn; measure added latency; findings note. Gate off by default.

## Audit

Run `npx --prefix backend tsx ../scripts/audit-tasks-md.ts` before considering this file done.
