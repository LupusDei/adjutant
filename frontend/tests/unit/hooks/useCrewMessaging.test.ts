import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCrewMessaging,
  buildCrewAddress,
  isMessageForCrewMember,
  isCrewMessage,
} from "../../../src/hooks/useCrewMessaging";
import { api } from "../../../src/services/api";
import type { CrewMember } from "../../../src/types";

// Mock the API
vi.mock("../../../src/services/api", () => ({
  api: {
    agents: {
      list: vi.fn(),
    },
    mail: {
      send: vi.fn(),
    },
  },
}));

// Mock usePolling to return mock data directly
vi.mock("../../../src/hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

import { usePolling } from "../../../src/hooks/usePolling";

const mockUsePolling = usePolling as ReturnType<typeof vi.fn>;
const mockApiAgentsList = api.agents.list as ReturnType<typeof vi.fn>;
const mockApiMailSend = api.mail.send as ReturnType<typeof vi.fn>;

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockCrewMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "greenplace/nux",
    name: "nux",
    type: "polecat",
    rig: "greenplace",
    status: "working",
    unreadMail: 0,
    ...overrides,
  };
}

// =============================================================================
// buildCrewAddress Tests
// =============================================================================

describe("buildCrewAddress", () => {
  it("should build mayor address", () => {
    const member = createMockCrewMember({
      type: "mayor",
      rig: null,
      name: "mayor",
    });
    expect(buildCrewAddress(member)).toBe("mayor/");
  });

  it("should build deacon address", () => {
    const member = createMockCrewMember({
      type: "deacon",
      rig: null,
      name: "deacon",
    });
    expect(buildCrewAddress(member)).toBe("deacon/");
  });

  it("should build witness address", () => {
    const member = createMockCrewMember({
      type: "witness",
      rig: "greenplace",
      name: "witness",
    });
    expect(buildCrewAddress(member)).toBe("greenplace/witness");
  });

  it("should build refinery address", () => {
    const member = createMockCrewMember({
      type: "refinery",
      rig: "greenplace",
      name: "refinery",
    });
    expect(buildCrewAddress(member)).toBe("greenplace/refinery");
  });

  it("should build polecat address", () => {
    const member = createMockCrewMember({
      type: "polecat",
      rig: "greenplace",
      name: "nux",
    });
    expect(buildCrewAddress(member)).toBe("greenplace/nux");
  });

  it("should build crew address", () => {
    const member = createMockCrewMember({
      type: "crew",
      rig: "greenplace",
      name: "toast",
    });
    expect(buildCrewAddress(member)).toBe("greenplace/toast");
  });

  it("should fallback to id when rig is null", () => {
    const member = createMockCrewMember({
      id: "special-agent",
      type: "witness",
      rig: null,
      name: "witness",
    });
    expect(buildCrewAddress(member)).toBe("special-agent");
  });
});

// =============================================================================
// isMessageForCrewMember Tests
// =============================================================================

describe("isMessageForCrewMember", () => {
  it("should match exact address", () => {
    const member = createMockCrewMember({
      type: "polecat",
      rig: "greenplace",
      name: "nux",
    });
    expect(isMessageForCrewMember("greenplace/nux", member)).toBe(true);
  });

  it("should match case-insensitively", () => {
    const member = createMockCrewMember({
      type: "polecat",
      rig: "greenplace",
      name: "nux",
    });
    expect(isMessageForCrewMember("GREENPLACE/NUX", member)).toBe(true);
  });

  it("should handle trailing slashes", () => {
    const member = createMockCrewMember({
      type: "mayor",
      rig: null,
      name: "mayor",
    });
    expect(isMessageForCrewMember("mayor/", member)).toBe(true);
    expect(isMessageForCrewMember("mayor", member)).toBe(true);
  });

  it("should not match different addresses", () => {
    const member = createMockCrewMember({
      type: "polecat",
      rig: "greenplace",
      name: "nux",
    });
    expect(isMessageForCrewMember("greenplace/toast", member)).toBe(false);
  });
});

// =============================================================================
// isCrewMessage Tests
// =============================================================================

describe("isCrewMessage", () => {
  it("should identify crew messages", () => {
    expect(isCrewMessage("greenplace/nux", "greenplace/witness")).toBe(true);
    expect(isCrewMessage("greenplace/toast", "greenplace/refinery")).toBe(true);
  });

  it("should exclude mayor messages", () => {
    expect(isCrewMessage("mayor/", "greenplace/nux")).toBe(false);
    expect(isCrewMessage("greenplace/nux", "mayor/")).toBe(false);
  });

  it("should exclude overseer messages", () => {
    expect(isCrewMessage("overseer", "greenplace/nux")).toBe(false);
    expect(isCrewMessage("greenplace/nux", "overseer")).toBe(false);
  });

  it("should handle edge cases", () => {
    expect(isCrewMessage("simple-sender", "simple-recipient")).toBe(false);
  });
});

// =============================================================================
// useCrewMessaging Hook Tests
// =============================================================================

describe("useCrewMessaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should load crew members", () => {
    const mockCrew = [
      createMockCrewMember({ id: "1", name: "nux", status: "working" }),
      createMockCrewMember({ id: "2", name: "toast", status: "idle" }),
    ];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    const { result } = renderHook(() => useCrewMessaging());

    expect(result.current.crewMembers).toEqual(mockCrew);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should return online crew members", () => {
    const mockCrew = [
      createMockCrewMember({ id: "1", name: "nux", status: "working" }),
      createMockCrewMember({ id: "2", name: "toast", status: "offline" }),
      createMockCrewMember({ id: "3", name: "furiosa", status: "idle" }),
    ];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    const { result } = renderHook(() => useCrewMessaging());

    expect(result.current.onlineCrew).toHaveLength(2);
    expect(result.current.onlineCrew.map((c) => c.name)).toEqual([
      "nux",
      "furiosa",
    ]);
  });

  it("should filter by type", () => {
    const mockCrew = [
      createMockCrewMember({ id: "1", name: "nux", type: "polecat" }),
      createMockCrewMember({ id: "2", name: "witness", type: "witness" }),
      createMockCrewMember({ id: "3", name: "refinery", type: "refinery" }),
    ];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    const { result } = renderHook(() => useCrewMessaging());

    const polecats = result.current.filterByType(["polecat"]);
    expect(polecats).toHaveLength(1);
    expect(polecats[0]?.name).toBe("nux");

    const infra = result.current.filterByType(["witness", "refinery"]);
    expect(infra).toHaveLength(2);
  });

  it("should filter by rig", () => {
    const mockCrew = [
      createMockCrewMember({ id: "1", name: "nux", rig: "greenplace" }),
      createMockCrewMember({ id: "2", name: "toast", rig: "citadel" }),
      createMockCrewMember({ id: "3", name: "furiosa", rig: "greenplace" }),
    ];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    const { result } = renderHook(() => useCrewMessaging());

    const greenplaceAgents = result.current.filterByRig("greenplace");
    expect(greenplaceAgents).toHaveLength(2);
    expect(greenplaceAgents.map((c) => c.name)).toEqual(["nux", "furiosa"]);
  });

  it("should send message to crew member", async () => {
    const mockCrew = [createMockCrewMember()];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    mockApiMailSend.mockResolvedValue({ messageId: "msg-123" });

    const { result } = renderHook(() => useCrewMessaging());

    await act(async () => {
      const response = await result.current.sendToCrewMember({
        to: mockCrew[0] as CrewMember,
        subject: "Test subject",
        body: "Test body",
      });
      expect(response.messageId).toBe("msg-123");
    });

    expect(mockApiMailSend).toHaveBeenCalledWith({
      to: "greenplace/nux",
      subject: "Test subject",
      body: "Test body",
      priority: 2,
      type: "task",
    });
  });

  it("should handle send error", async () => {
    const mockCrew = [createMockCrewMember()];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    mockApiMailSend.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCrewMessaging());

    // Use act and expect the promise to reject
    await act(async () => {
      try {
        await result.current.sendToCrewMember({
          to: mockCrew[0] as CrewMember,
          subject: "Test",
          body: "Test body",
        });
      } catch (e) {
        // Expected - error is set before throwing
        expect((e as Error).message).toBe("Network error");
      }
    });

    expect(result.current.sendError?.message).toBe("Network error");
  });

  it("should clear send error", async () => {
    const mockCrew = [createMockCrewMember()];

    mockUsePolling.mockReturnValue({
      data: mockCrew,
      loading: false,
      error: null,
      refresh: vi.fn(),
      lastUpdated: new Date(),
    });

    mockApiMailSend.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCrewMessaging());

    // Trigger error
    await act(async () => {
      try {
        await result.current.sendToCrewMember({
          to: mockCrew[0] as CrewMember,
          subject: "Test",
          body: "Test body",
        });
      } catch {
        // Expected
      }
    });

    expect(result.current.sendError).not.toBeNull();

    // Clear error
    act(() => {
      result.current.clearSendError();
    });

    expect(result.current.sendError).toBeNull();
  });
});
