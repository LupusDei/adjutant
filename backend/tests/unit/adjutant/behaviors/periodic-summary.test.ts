const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createPeriodicSummaryBehavior,
  getHeartbeatPrompt,
} from "../../../../src/services/adjutant/behaviors/periodic-summary.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

function createMockState() {
  return {
    upsertAgentProfile: vi.fn(),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn(),
    getRecentDecisions: vi.fn(),
    getMeta: vi.fn(),
    setMeta: vi.fn(),
  };
}

function createMockComm() {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(),
    escalate: vi.fn(),
    messageAgent: vi.fn(),
    flushRoutineQueue: vi.fn(() => [] as string[]),
    getRoutineQueueLength: vi.fn(),
  };
}

function makeCronEvent(): BehaviorEvent {
  return {
    name: "periodic-summary",
    data: { cronTick: true, behavior: "periodic-summary" },
    seq: 1,
  };
}

/**
 * Helper: make mockExecFile call its callback with success or error.
 */
function setupExecFileSuccess() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(null);
    },
  );
}

function setupExecFileFailure() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(new Error("tmux not found"));
    },
  );
}

describe("createPeriodicSummaryBehavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the name "periodic-summary"', () => {
    const behavior = createPeriodicSummaryBehavior();
    expect(behavior.name).toBe("periodic-summary");
  });

  it('has schedule "0 * * * *"', () => {
    const behavior = createPeriodicSummaryBehavior();
    expect(behavior.schedule).toBe("0 * * * *");
  });

  it("has an empty triggers array", () => {
    const behavior = createPeriodicSummaryBehavior();
    expect(behavior.triggers).toEqual([]);
  });

  it("shouldAct always returns true", () => {
    const behavior = createPeriodicSummaryBehavior();
    const event = makeCronEvent();
    expect(behavior.shouldAct(event, {})).toBe(true);
  });
});

describe("getHeartbeatPrompt", () => {
  it('returns a string containing "list_agents"', () => {
    const prompt = getHeartbeatPrompt([]);
    expect(prompt).toContain("list_agents");
  });

  it("includes routine messages when provided", () => {
    const prompt = getHeartbeatPrompt([
      "Agent alpha connected",
      "Bead adj-100 closed",
    ]);
    expect(prompt).toContain("ROUTINE NOTES");
    expect(prompt).toContain("Agent alpha connected");
    expect(prompt).toContain("Bead adj-100 closed");
  });

  it("returns clean prompt with no routine section when messages are empty", () => {
    const prompt = getHeartbeatPrompt([]);
    expect(prompt).not.toContain("ROUTINE NOTES");
  });

  it('contains "HOURLY HEARTBEAT CHECK"', () => {
    const prompt = getHeartbeatPrompt([]);
    expect(prompt).toContain("HOURLY HEARTBEAT CHECK");
  });

  it('contains "send_message"', () => {
    const prompt = getHeartbeatPrompt([]);
    expect(prompt).toContain("send_message");
  });
});

describe("periodic-summary act()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends tmux commands when tmux succeeds", async () => {
    setupExecFileSuccess();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    // Should call execFile twice: once for send-keys -l (text), once for Enter
    expect(mockExecFile).toHaveBeenCalledTimes(2);

    const firstCall = mockExecFile.mock.calls[0];
    expect(firstCall[0]).toBe("tmux");
    expect(firstCall[1]).toContain("send-keys");
    expect(firstCall[1]).toContain("-l");

    const secondCall = mockExecFile.mock.calls[1];
    expect(secondCall[0]).toBe("tmux");
    expect(secondCall[1]).toContain("Enter");
  });

  it("sets last_heartbeat_sent meta on success", async () => {
    setupExecFileSuccess();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(state.setMeta).toHaveBeenCalledOnce();
    expect(state.setMeta).toHaveBeenCalledWith(
      "last_heartbeat_sent",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("logs decision on success", async () => {
    setupExecFileSuccess();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(state.logDecision).toHaveBeenCalledOnce();
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "periodic-summary",
      action: "heartbeat_sent",
      target: "adj-swarm-adjutant-coordinator",
      reason: null,
    });
  });

  it("logs failure decision when tmux fails", async () => {
    setupExecFileFailure();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(state.logDecision).toHaveBeenCalledOnce();
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "periodic-summary",
      action: "heartbeat_failed",
      target: "adj-swarm-adjutant-coordinator",
      reason: "tmux send-keys failed — session may not exist",
    });

    // Should NOT set meta on failure
    expect(state.setMeta).not.toHaveBeenCalled();
  });

  it("flushes routine queue from comm manager", async () => {
    setupExecFileSuccess();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();
    comm.flushRoutineQueue.mockReturnValue(["msg1", "msg2"]);

    await behavior.act(makeCronEvent(), state, comm);

    expect(comm.flushRoutineQueue).toHaveBeenCalledOnce();

    // The decision log should note the routine messages
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Included 2 routine messages",
      }),
    );
  });

  it("handles tmux failure gracefully (no throw)", async () => {
    setupExecFileFailure();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    // Should not throw
    await expect(
      behavior.act(makeCronEvent(), state, comm),
    ).resolves.toBeUndefined();
  });

  it("does not send Enter if first send-keys fails", async () => {
    setupExecFileFailure();

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    // Only the first call should be made; Enter should not be sent
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
