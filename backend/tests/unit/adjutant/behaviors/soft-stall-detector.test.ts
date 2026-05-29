import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSoftStallDetector,
  STALL_IDLE_THRESHOLD_MS,
  MAX_AUTO_RECOVERIES,
  type StallSession,
  type SoftStallDeps,
} from "../../../../src/services/adjutant/behaviors/soft-stall-detector.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";

const NOW = 1_800_000_000_000; // fixed clock
const STALE = new Date(NOW - STALL_IDLE_THRESHOLD_MS - 60_000); // well past threshold
const FRESH = new Date(NOW - 1_000); // just active

function makeState() {
  const meta = new Map<string, string>();
  const decisions: { action: string; target?: string }[] = [];
  const state = {
    getMeta: (k: string) => meta.get(k) ?? null,
    setMeta: (k: string, v: string) => void meta.set(k, v),
    logDecision: vi.fn((e: { action: string; target?: string }) => decisions.push(e)),
  } as unknown as AdjutantState;
  return { state, meta, decisions };
}

function makeComm() {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(async () => {}),
    escalate: vi.fn(async () => {}),
    messageAgent: vi.fn(async () => {}),
  } as unknown as CommunicationManager;
}

const EVENT = { name: "tick" } as unknown as BehaviorEvent;

function session(over: Partial<StallSession> = {}): StallSession {
  return {
    id: over.id ?? "s1",
    name: over.name ?? "raynor",
    status: over.status ?? "working",
    tmuxPane: over.tmuxPane ?? "adj-swarm-raynor:1.1",
    lastActivity: over.lastActivity ?? STALE,
  };
}

function deps(sessions: StallSession[], over: Partial<SoftStallDeps> = {}): SoftStallDeps {
  return {
    listSessions: () => sessions,
    capturePane: over.capturePane ?? vi.fn(async () => "STATIC"),
    sendEnter: over.sendEnter ?? vi.fn(async () => {}),
    now: () => NOW,
    sampleGapMs: 0,
    ...over,
  };
}

describe("soft-stall-detector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-sends Enter for a working agent that is stale with a static pane (soft-stall recovery)", async () => {
    const sendEnter = vi.fn(async () => {});
    const d = deps([session()], { sendEnter, capturePane: vi.fn(async () => "STATIC") });
    const { state, meta, decisions } = makeState();

    const behavior = createSoftStallDetector(d);
    await behavior.act(EVENT, state, makeComm());

    expect(sendEnter).toHaveBeenCalledTimes(1);
    expect(sendEnter).toHaveBeenCalledWith("adj-swarm-raynor:1.1");
    expect(meta.get("soft_stall_recovery_s1")).toBe("1");
    expect(decisions[0]?.action).toBe("auto_recover_soft_stall");
  });

  it("does NOT touch an agent whose pane is actively changing (genuinely working)", async () => {
    let n = 0;
    const sendEnter = vi.fn(async () => {});
    const d = deps([session()], {
      sendEnter,
      capturePane: vi.fn(async () => `WORKING ${n++}`), // changes every sample
    });
    const { state } = makeState();

    await createSoftStallDetector(d).act(EVENT, state, makeComm());

    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("does NOT touch a working agent that was recently active (idle under threshold)", async () => {
    const sendEnter = vi.fn(async () => {});
    const capturePane = vi.fn(async () => "STATIC");
    const d = deps([session({ lastActivity: FRESH })], { sendEnter, capturePane });
    const { state } = makeState();

    await createSoftStallDetector(d).act(EVENT, state, makeComm());

    expect(sendEnter).not.toHaveBeenCalled();
    // Should not even bother sampling the pane for a fresh agent.
    expect(capturePane).not.toHaveBeenCalled();
  });

  it("ignores non-working agents (idle/offline) even if stale", async () => {
    const sendEnter = vi.fn(async () => {});
    const d = deps(
      [
        session({ id: "a", name: "idle-agent", status: "idle" }),
        session({ id: "b", name: "off-agent", status: "offline" }),
      ],
      { sendEnter },
    );
    const { state } = makeState();

    await createSoftStallDetector(d).act(EVENT, state, makeComm());

    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("never nudges the coordinator (owned by health-monitor)", async () => {
    const sendEnter = vi.fn(async () => {});
    const d = deps([session({ name: "adjutant-coordinator" })], { sendEnter });
    const { state } = makeState();

    await createSoftStallDetector(d).act(EVENT, state, makeComm());

    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("escalates ONCE after auto-recovery attempts are exhausted, then stays quiet", async () => {
    const sendEnter = vi.fn(async () => {});
    const comm = makeComm();
    const d = deps([session()], { sendEnter, capturePane: vi.fn(async () => "STATIC") });
    const { state } = makeState();
    const behavior = createSoftStallDetector(d);

    // Cycle 1 + 2: auto-recover (Enter), no escalation yet.
    await behavior.act(EVENT, state, comm);
    await behavior.act(EVENT, state, comm);
    expect(sendEnter).toHaveBeenCalledTimes(MAX_AUTO_RECOVERIES);
    expect(comm.sendImportant).not.toHaveBeenCalled();

    // Cycle 3: exhausted → escalate once.
    await behavior.act(EVENT, state, comm);
    expect(comm.sendImportant).toHaveBeenCalledTimes(1);

    // Cycle 4: already escalated → stay quiet (no duplicate escalation, no Enter).
    await behavior.act(EVENT, state, comm);
    expect(comm.sendImportant).toHaveBeenCalledTimes(1);
    expect(sendEnter).toHaveBeenCalledTimes(MAX_AUTO_RECOVERIES);
  });

  it("resets the recovery counter when the agent recovers (pane starts changing)", async () => {
    let changing = false;
    let n = 0;
    const d = deps([session()], {
      capturePane: vi.fn(async () => (changing ? `LIVE ${n++}` : "STATIC")),
      sendEnter: vi.fn(async () => {}),
    });
    const { state, meta } = makeState();
    const behavior = createSoftStallDetector(d);

    await behavior.act(EVENT, state, makeComm()); // stall → counter 1
    expect(meta.get("soft_stall_recovery_s1")).toBe("1");

    changing = true; // agent resumed
    await behavior.act(EVENT, state, makeComm());
    expect(meta.get("soft_stall_recovery_s1")).toBe("0");
  });
});
