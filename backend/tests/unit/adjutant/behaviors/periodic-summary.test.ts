// Suppress logging
vi.mock("../../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock session bridge
const mockSendInput = vi.fn();
const mockFindByTmuxSession = vi.fn();
const mockBridge = {
  registry: { findByTmuxSession: mockFindByTmuxSession },
  sendInput: mockSendInput,
};
vi.mock("../../../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
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

  it("sends prompt via session bridge sendInput", async () => {
    const mockSession = { id: "session-123", tmuxPane: "adj-swarm-adjutant-coordinator:1.1" };
    mockFindByTmuxSession.mockReturnValue(mockSession);
    mockSendInput.mockResolvedValue(true);

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(mockFindByTmuxSession).toHaveBeenCalledWith("adj-swarm-adjutant-coordinator");
    expect(mockSendInput).toHaveBeenCalledOnce();
    expect(mockSendInput).toHaveBeenCalledWith("session-123", expect.stringContaining("HOURLY HEARTBEAT CHECK"));
  });

  it("sets last_heartbeat_sent meta on success", async () => {
    mockFindByTmuxSession.mockReturnValue({ id: "s1" });
    mockSendInput.mockResolvedValue(true);

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
    mockFindByTmuxSession.mockReturnValue({ id: "s1" });
    mockSendInput.mockResolvedValue(true);

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

  it("logs failure when session is not in registry", async () => {
    mockFindByTmuxSession.mockReturnValue(undefined);

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(mockSendInput).not.toHaveBeenCalled();
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "periodic-summary",
      action: "heartbeat_failed",
      target: "adj-swarm-adjutant-coordinator",
      reason: "tmux send-keys failed — session may not exist",
    });
    expect(state.setMeta).not.toHaveBeenCalled();
  });

  it("logs failure when sendInput returns false", async () => {
    mockFindByTmuxSession.mockReturnValue({ id: "s1" });
    mockSendInput.mockResolvedValue(false);

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "periodic-summary",
      action: "heartbeat_failed",
      target: "adj-swarm-adjutant-coordinator",
      reason: "tmux send-keys failed — session may not exist",
    });
    expect(state.setMeta).not.toHaveBeenCalled();
  });

  it("flushes routine queue from comm manager", async () => {
    mockFindByTmuxSession.mockReturnValue({ id: "s1" });
    mockSendInput.mockResolvedValue(true);

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();
    comm.flushRoutineQueue.mockReturnValue(["msg1", "msg2"]);

    await behavior.act(makeCronEvent(), state, comm);

    expect(comm.flushRoutineQueue).toHaveBeenCalledOnce();

    // The prompt should include routine messages
    const sentPrompt = mockSendInput.mock.calls[0]![1] as string;
    expect(sentPrompt).toContain("ROUTINE NOTES");
    expect(sentPrompt).toContain("msg1");
    expect(sentPrompt).toContain("msg2");

    // The decision log should note the routine messages
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Included 2 routine messages",
      }),
    );
  });

  it("handles sendInput failure gracefully (no throw)", async () => {
    mockFindByTmuxSession.mockReturnValue({ id: "s1" });
    mockSendInput.mockRejectedValue(new Error("tmux error"));

    const behavior = createPeriodicSummaryBehavior();
    const state = createMockState();
    const comm = createMockComm();

    // Should not throw — the act() must be resilient
    await expect(
      behavior.act(makeCronEvent(), state, comm),
    ).resolves.toBeUndefined();
  });
});
