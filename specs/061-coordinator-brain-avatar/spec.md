# Feature 061 — Coordinator-as-Brain Avatar (Front 3: the Embodied Coordinator)

Epic: **adj-202.7** (child of adj-202 "The Bridge"). Status: experimental, toggle-gated.

## Problem

Today the Bridge avatar and the Adjutant coordinator are two different minds wearing one name.
The avatar's conversational brain is Runway's **GWM-1** model (guided by our persona + tools); the
coordinator is a separate Claude agent. They can know different things and answer differently, so
they never feel like one entity. The only design that makes them *literally* one being is to make
**our own coordinator the brain that drives the avatar** — "audio in → our agent → avatar video
out" (Runway's LiveKit-Agents mode, where Runway is a pure renderer).

The Commander's concern is **latency**, and the directive is to build this as an **optional switch**
that can be measured, reverted, or escalated to a "totally separate the two" mode if it fails.

## Vision

One mind. You speak; the coordinator itself hears, reasons (with its live memory + fleet tools),
and answers in a consistent voice + face. Toggle it on to experiment; toggle it off to fall back to
today's Bridge instantly; flip to "separate" to divorce them entirely. Every turn's latency is
measured, so the go/no-go is decided from data, not vibes.

## Users & Roles

- **Commander (the General)** — talks to the Bridge; flips the brain toggle; judges the latency.
- **Adjutant coordinator** — its memory/tools/persona become the avatar's brain in `coordinator` mode.

## User Stories

### US1 (P0) — Latency spike / go-no-go  *(GATES the whole epic)*
As the Commander, before we invest, I want a minimal end-to-end pipeline (mic → STT → local LLM →
TTS → Runway render) running on the real hardware with **measured per-turn latency**, so we decide
go/no-go from real numbers.
**Acceptance:** a throwaway harness completes ≥5 spoken turns through Runway agent-mode; logs
end-of-speech→first-audio and →first-avatar-frame per turn; a findings doc records P50/P90 latency
(tool-free) vs today's ~1.75s baseline and a clear go/no-go.

### US2 (P0) — The brain toggle (additive, revertible)
As the Commander, I want a `bridgeBrain` setting — **`runway`** (today, untouched) vs
**`coordinator`** (Front 3) — so I can switch minds without disturbing the working Bridge.
**Acceptance:** `runway` is the default and byte-for-byte the current behavior; `coordinator`
routes a session through the new pipeline; switching requires no redeploy; the current Runway path
is never modified, only branched around.

### US3 (P0) — Coordinator brain = local fast model + shared memory/tools
As the Commander, I want the avatar's responder to be a **fast LOCAL model** that shares the
coordinator's memory, the Bridge's existing tools, and its persona — so it IS the coordinator
functionally, and the cloud-LLM network hop (the dominant latency term) is gone.
**Acceptance:** in `coordinator` mode the LLM is a local OpenAI-compatible endpoint; it can call the
existing bridge read/command tools and query_memories/store_memory; its persona is the coordinator's;
tool-free first-token is measured; heavy turns speak a filler while tools run.

### US4 (P1) — Streaming voice I/O
As the Commander, I want streaming STT in and streaming TTS out so turns start fast and can be
interrupted.
**Acceptance:** STT emits interim + final transcripts with endpointing; TTS streams first audio
<300ms; barge-in (I start talking) cancels the current TTS + LLM turn.

### US5 (P1) — Measured, always
As the Commander, I want every turn's latency (end-of-speech, STT-final, LLM-TTFT, TTS-TTFB,
first-avatar-frame, total) captured so I can compare modes on my device.
**Acceptance:** per-turn metrics are logged (and optionally surfaced) for both modes; a compare view
or log summary shows P50/P90 per stage.

### US6 (P1) — iOS + web toggle
As the Commander, I want the brain switch in Settings on web and iOS.
**Acceptance:** a labeled toggle persists the choice; changing it takes effect on the next session;
copy explains the trade-off (custom voice vs one-mind + vision).

### US7 (P2) — Fallback: "totally separate the two"
As the Commander, if the experiment fails, I want a **`separate`** mode where the Bridge is a
distinct entity (its own identity, NOT merged into the coordinator chat).
**Acceptance:** `separate` mode uses a distinct sender identity + its own conversation; nothing lands
in the user↔adjutant-coordinator DM; one flag flip from either other mode.

### US8 (P3, optional) — Vision (screen/camera)
As the Commander, since we own the pipeline, I want the brain to optionally SEE my shared
screen/camera (which today's custom-voice character blocks).
**Acceptance:** when vision is enabled, sampled frames are fed to a multimodal model and the avatar
can answer questions about what's on screen; gated + off by default (cost/latency).

## Functional Requirements

- **FR1** `runway` mode is the default and is never altered by this epic (pure fallback).
- **FR2** `coordinator` mode: Runway session created in **agent mode** (character voice bypassed);
  a LiveKit voice agent joins the session and runs STT→LLM→TTS; TTS audio streams to Runway.
- **FR3** The `coordinator` LLM reuses the EXISTING bridge tool surface (bridge-tool-bridge + the
  command/memory tools) and persona (Rules 4 + 9 — no second control plane / no new tools).
- **FR4** Local model: an OpenAI-compatible local endpoint (e.g. Ollama/MLX) with tool-calling.
- **FR5** Filler speech covers tool-call latency; barge-in cancels in-flight turns.
- **FR6** Per-turn latency metrics captured for both modes.
- **FR7** `coordinator` transcripts persist into the coordinator DM as **adjutant-coordinator** (the
  identity unification already shipped); `separate` mode persists to a distinct Bridge identity/DM.
- **FR8** All new code is additive + toggle-gated; the Runway secret + local model never reach the browser.

## Non-Functional / Success Criteria

- **Latency target (tool-free voice-to-voice):** ≤ ~2.5s P50, competitive with today's ~1.75s. Spike
  decides if achievable on the hardware.
- **Tool-turn UX:** perceived wait covered by filler within ~600ms of end-of-speech.
- **Reversibility:** flipping to `runway` fully restores today's behavior with zero residual effect.
- **No regression:** the existing Bridge (runway mode), transcript persistence, and all bridge tests
  stay green.

## Non-Goals (this epic)

- Replacing `runway` mode as the default (it stays default until the experiment proves out).
- Perfect voice match to the custom "Sexy humorous Adjutant" voice (TTS approximation only).
- Full multimodal vision beyond the optional US8 spike.
- Rewriting the coordinator agent itself — we share its memory/tools/persona, not its process.

## Key Decisions (resolved in plan.md)

- LiveKit agent runtime: **agents-js (Node)** to stay in-stack vs a Python agent worker.
- Local model + serving (Ollama vs MLX vs LM Studio) + which model (tool-calling + speed).
- STT + TTS providers (cloud low-latency vs local for cost/privacy).
- Agent process model (per-session worker vs long-running).
