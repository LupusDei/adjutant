# Plan — 061 Coordinator-as-Brain Avatar (adj-202.7)

## Architecture

### Two modes, one switch

```
bridgeBrain = "runway"      (DEFAULT, today — untouched)
  Commander mic → Runway GWM-1 (STT+LLM+TTS+render, custom voice) → avatar
  [the current bridge-rpc-handler + BridgeSessionBroker path, unchanged]

bridgeBrain = "coordinator" (Front 3 — new, additive)
  Commander mic ─┐
                 ▼
        LiveKit Voice Agent (our server-side participant)
          1. STT (streaming)        — Commander speech → text (interim+final, endpointing)
          2. LLM (LOCAL fast model) — OUR coordinator brain: shares memory + bridge tools + persona
          3. TTS (streaming)        — reply text → audio
                 ▼
        audio track → Runway (AGENT MODE) → lip-syncs avatar (video out only)

bridgeBrain = "separate"    (fallback if the experiment fails — US7)
  same as runway OR coordinator, but a DISTINCT identity + conversation; NOT merged into the
  coordinator DM. The Bridge becomes its own being.
```

Runway agent mode makes Runway a **pure renderer**: the character's own voice/personality are
bypassed; our TTS drives what the avatar says (confirmed in Runway's LiveKit docs).

### Why local model (Commander's lever)

The dominant latency term in the cascade is the LLM time-to-first-token. A cloud LLM adds a network
round-trip on every turn. A **local** OpenAI-compatible model (Ollama/MLX on the Mac) removes that
hop entirely → lower + more predictable TTFT, zero per-token cost, and privacy. Trade-off: local
model quality/tool-calling vs a frontier cloud model — mitigated by choosing a strong small model
(good tool-calling, e.g. Qwen2.5 / Llama 3.x class) and keeping the coordinator's memory/tools as
its grounding.

### The brain shares the coordinator's mind (Rules 4 + 9)

The `coordinator` LLM does NOT get a new tool/control plane. It is handed:
- **Tools:** the EXISTING `bridge-tool-bridge` read tools + the command/memory tools (send_message,
  nudge_agent, query_memories, store_memory, …) — exposed to the LLM as function-calling tools.
- **Memory:** the same adjutant MemoryStore (recall on turn start; record as it learns).
- **Persona:** `composeBridgePersonality` (+ memory seed / operating lessons already built).
So it is the coordinator functionally; we only swapped the *inference engine* (GWM-1 → local model)
and wrapped it in STT/TTS.

### Latency budget (coordinator mode, tool-free turn)

| Stage | Est. | Notes |
|---|---|---|
| End-of-turn detect (VAD/endpointing) | 300–500ms | tunable; the felt "gap" |
| STT final | 100–200ms | overlaps speech; streaming |
| LLM TTFT (**local**) | 150–500ms | hardware-dependent; no network hop |
| TTS TTFB | 50–200ms | Cartesia <50ms; local Piper/Kokoro higher |
| Runway render first frame | 200–500ms | streamed, pipelined with TTS |
| **Total (stop→avatar speaks)** | **~1.0–2.0s** | vs today's ~1.75s all-in-one |

**Tool turns** add the tool round-trip *sequentially before the reply* (+1–3s). Mitigation: emit a
**filler utterance** ("Checking the fleet now, Commander…") within ~500ms while the tool runs; our
bridge tools themselves are ~25ms, so the cost is the extra LLM decide→call→continue round-trip.
**Barge-in** cancels the current LLM+TTS turn when the Commander starts speaking.

## Runtime & Components

- **Agent runtime:** `@livekit/agents` (agents-js, Node) to stay in our TypeScript stack. We already
  have `@livekit/rtc-node`. (Decision to confirm in the spike; Python worker is the alternative.)
- **Agent process:** a per-session voice-agent (spawned when a `coordinator` session starts,
  torn down on end) OR a long-running worker that dispatches into rooms. Spike picks one.
- **STT:** streaming provider — cloud (Deepgram) for the spike; local (faster-whisper) as a cost
  option later.
- **LLM:** local OpenAI-compatible endpoint. **Provision task** (Ollama/MLX + model pull) since
  neither is installed today.
- **TTS:** streaming — Cartesia Sonic (ultra-low TTFB) for the spike; local (Piper/Kokoro) as a cost
  option.
- **Runway:** `realtimeSessions.create` in agent mode + the LiveKit room; our TTS track published so
  Runway lip-syncs.

## File / Module Map (additive — new files, minimal edits to existing)

- `backend/src/services/bridge-brain-mode.ts` — the `bridgeBrain` resolver (env/setting → mode).
- `backend/src/services/bridge-voice-agent/` — the coordinator-brain pipeline:
  - `pipeline.ts` — orchestrates STT→LLM→TTS + barge-in + filler.
  - `local-llm.ts` — OpenAI-compatible local client + the bridge tool/function-calling adapter.
  - `stt.ts`, `tts.ts` — provider adapters (streaming).
  - `runway-agent-session.ts` — create Runway agent-mode session + publish the TTS track.
  - `metrics.ts` — per-turn latency capture.
- `backend/src/routes/avatar.ts` / `bridge.ts` — branch on mode (small edits): `runway` → existing
  path; `coordinator`/`separate` → new pipeline. Existing runway path code is untouched.
- `backend/src/services/bridge-transcript-persister.ts` — reuse; `separate` mode passes a distinct
  coordinatorId + conversation.
- Frontend `Settings` + iOS `SettingsView` — the toggle (persist `bridgeBrain`).
- `specs/061-.../contracts/` — the mode contract + metrics shape.

## Phases (sub-epics of adj-202.7)

- **adj-202.7.1 — Phase 0 SPIKE (P0, GATES ALL):** minimal mic→STT→local-LLM→TTS→Runway loop;
  measure latency on the Mac; findings doc + go/no-go. Throwaway code allowed.
- **adj-202.7.2 — Toggle + mode plumbing (P0):** `bridgeBrain` setting, mode resolver, session
  branch; `runway` default unchanged.
- **adj-202.7.3 — Local model brain (P0):** provision local model; `local-llm.ts` with the bridge
  tools + memory + persona as its function-calling brain; filler-during-tools; barge-in.
- **adj-202.7.4 — Streaming STT + TTS (P1):** provider adapters, endpointing, streaming out.
- **adj-202.7.5 — Latency instrumentation + A/B (P1):** per-turn metrics for both modes + summary.
- **adj-202.7.6 — iOS + web toggle UI (P1):** Settings switch + copy.
- **adj-202.7.7 — Fallback modes (P2):** `runway` default + `separate` (distinct identity/DM).
- **adj-202.7.8 — Vision spike (P3, optional):** sample screen/camera frames → multimodal → answer.

## Sequencing

7.1 (spike) FIRST and it gates everything — do not build 7.2+ until the spike says the latency is
acceptable. Then 7.2 (toggle) + 7.3 (brain) are the core; 7.4/7.5 harden; 7.6 exposes it; 7.7 is the
safety valve; 7.8 optional.

## Risks

- **Latency > bar** → the spike catches it early; fallback to `runway`/`separate`.
- **Local model tool-calling weak** → pick a model with strong function-calling; or allow a cloud
  LLM option behind the same toggle for quality turns.
- **New process/infra** (agent worker, local model server) → supervision + lifecycle (ties to
  adj-yi6do supervision).
- **Voice identity loss** (custom voice) → accepted trade-off; pick the closest TTS voice.

## Bead Map

- adj-202.7 — Coordinator-as-Brain Avatar (epic)
  - adj-202.7.1 — Phase 0 latency spike / go-no-go
  - adj-202.7.2 — bridgeBrain toggle + session mode plumbing
  - adj-202.7.3 — Local-model coordinator brain (tools + memory + persona)
  - adj-202.7.4 — Streaming STT + TTS pipeline
  - adj-202.7.5 — Per-turn latency instrumentation + A/B
  - adj-202.7.6 — iOS + web brain toggle UI
  - adj-202.7.7 — Fallback modes (runway default + separate)
  - adj-202.7.8 — Vision spike (optional)
