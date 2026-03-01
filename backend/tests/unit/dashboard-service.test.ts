import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — vi.hoisted ensures fns exist before vi.mock factories run
// ============================================================================

const {
  mockGetStatus,
  mockGetAgents,
  mockListBeads,
  mockListEpicsWithProgress,
} = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockGetAgents: vi.fn(),
  mockListBeads: vi.fn(),
  mockListEpicsWithProgress: vi.fn(),
}));

vi.mock("../../src/services/status/index.js", () => ({
  getStatusProvider: vi.fn(() => ({
    getStatus: mockGetStatus,
  })),
}));

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: mockGetAgents,
}));

vi.mock("../../src/services/beads/index.js", () => ({
  listBeads: mockListBeads,
  listEpicsWithProgress: mockListEpicsWithProgress,
}));

import { createDashboardService } from "../../src/services/dashboard-service.js";
import type { MessageStore } from "../../src/services/message-store.js";
import type { BeadInfo, EpicWithChildren } from "../../src/services/beads/types.js";
import type { CrewMember } from "../../src/types/index.js";

// ============================================================================
// Fixtures
// ============================================================================

function createBeadInfo(overrides: Partial<BeadInfo> = {}): BeadInfo {
  return {
    id: "adj-001",
    title: "Test bead",
    status: "open",
    priority: 2,
    type: "task",
    assignee: null,
    rig: null,
    source: "town",
    labels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

function createCrewMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "test-agent",
    name: "test-agent",
    type: "agent",
    rig: null,
    status: "idle",
    ...overrides,
  };
}

function createEpicWithChildren(overrides: Partial<EpicWithChildren> = {}): EpicWithChildren {
  return {
    epic: createBeadInfo({ type: "epic", status: "in_progress" }),
    children: [],
    totalCount: 3,
    closedCount: 1,
    progress: 0.33,
    ...overrides,
  };
}

function createMockMessageStore(): MessageStore {
  return {
    insertMessage: vi.fn(),
    getMessage: vi.fn(),
    getMessages: vi.fn(),
    getPendingForRecipient: vi.fn(),
    markDelivered: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    searchMessages: vi.fn(),
    getUnreadCounts: vi.fn(() => [
      { agentId: "agent-a", count: 3 },
      { agentId: "agent-b", count: 1 },
    ]),
    getThreads: vi.fn(),
  } as unknown as MessageStore;
}

// ============================================================================
// Tests
// ============================================================================

describe("DashboardService", () => {
  let mockMessageStore: MessageStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageStore = createMockMessageStore();
  });

  it("should return all sections populated when all services succeed", async () => {
    // Arrange
    mockGetStatus.mockResolvedValue({
      success: true,
      data: { powerState: "running", fetchedAt: "2026-01-01T00:00:00Z" },
    });
    mockListBeads.mockImplementation(
      (opts: { status: string }) =>
        Promise.resolve({
          success: true,
          data: [createBeadInfo({ status: opts.status })],
        }),
    );
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [createCrewMember()],
    });
    mockListEpicsWithProgress.mockResolvedValue({
      success: true,
      data: [createEpicWithChildren()],
    });
    // Act
    const service = createDashboardService(mockMessageStore);
    const result = await service.fetchDashboard();

    // Assert
    expect(result.status.data).toBeTruthy();
    expect(result.status.error).toBeUndefined();

    expect(result.beads.data).toBeTruthy();
    expect(result.beads.data!.inProgress.items).toHaveLength(1);
    expect(result.beads.data!.open.items).toHaveLength(1);
    expect(result.beads.data!.closed.items).toHaveLength(1);

    expect(result.crew.data).toHaveLength(1);
    expect(result.crew.error).toBeUndefined();

    expect(result.unreadCounts.data).toEqual({ "agent-a": 3, "agent-b": 1 });

    expect(result.epics.data).toBeTruthy();
    expect(result.epics.data!.inProgress.items).toHaveLength(1);
    expect(result.epics.data!.inProgress.items[0]!.progress).toBe(0.33);

    expect(result.timestamp).toBeTruthy();
  });

  it("should handle partial failures — beads fails, others succeed", async () => {
    // Arrange
    mockGetStatus.mockResolvedValue({
      success: true,
      data: { powerState: "running", fetchedAt: "2026-01-01T00:00:00Z" },
    });
    mockListBeads.mockRejectedValue(new Error("beads CLI unavailable"));
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [createCrewMember()],
    });
    mockListEpicsWithProgress.mockResolvedValue({
      success: true,
      data: [],
    });

    // Act
    const service = createDashboardService(mockMessageStore);
    const result = await service.fetchDashboard();

    // Assert — beads section has error, everything else works
    expect(result.beads.data).toBeNull();
    expect(result.beads.error).toContain("beads CLI unavailable");

    expect(result.status.data).toBeTruthy();
    expect(result.crew.data).toHaveLength(1);
    expect(result.unreadCounts.data).toBeTruthy();
  });

  it("should handle all failures — all sections null with errors", async () => {
    // Arrange
    mockGetStatus.mockRejectedValue(new Error("status failed"));
    mockListBeads.mockRejectedValue(new Error("beads failed"));
    mockGetAgents.mockRejectedValue(new Error("agents failed"));
    (mockMessageStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("db failed");
    });
    mockListEpicsWithProgress.mockRejectedValue(new Error("epics failed"));

    // Act
    const service = createDashboardService(mockMessageStore);
    const result = await service.fetchDashboard();

    // Assert — all sections null with errors, but timestamp present
    expect(result.status.data).toBeNull();
    expect(result.status.error).toContain("status failed");

    expect(result.beads.data).toBeNull();
    expect(result.beads.error).toBeTruthy();

    expect(result.crew.data).toBeNull();
    expect(result.crew.error).toContain("agents failed");

    expect(result.unreadCounts.data).toBeNull();
    expect(result.unreadCounts.error).toContain("db failed");

    expect(result.epics.data).toBeNull();
    expect(result.epics.error).toContain("epics failed");

    expect(result.timestamp).toBeTruthy();
  });

  it("should cap bead items at 5 per category", async () => {
    // Arrange
    const manyBeads = Array.from({ length: 10 }, (_, i) =>
      createBeadInfo({ id: `adj-${i}`, title: `Bead ${i}` }),
    );
    mockGetStatus.mockResolvedValue({ success: true, data: {} });
    mockListBeads.mockResolvedValue({ success: true, data: manyBeads });
    mockGetAgents.mockResolvedValue({ success: true, data: [] });
    mockListEpicsWithProgress.mockResolvedValue({ success: true, data: [] });

    // Act
    const service = createDashboardService(mockMessageStore);
    const result = await service.fetchDashboard();

    // Assert — each category capped at 5 items
    expect(result.beads.data!.inProgress.items).toHaveLength(5);
    expect(result.beads.data!.inProgress.totalCount).toBe(10);
    expect(result.beads.data!.open.items).toHaveLength(5);
    expect(result.beads.data!.closed.items).toHaveLength(5);
  });

  it("should split epics into inProgress and completed correctly", async () => {
    // Arrange
    const inProgressEpic = createEpicWithChildren({
      epic: createBeadInfo({ id: "epic-1", status: "in_progress", type: "epic" }),
      progress: 0.5,
    });
    const completedEpic = createEpicWithChildren({
      epic: createBeadInfo({ id: "epic-2", status: "closed", type: "epic" }),
      progress: 1.0,
    });

    mockGetStatus.mockResolvedValue({ success: true, data: {} });
    mockListBeads.mockResolvedValue({ success: true, data: [] });
    mockGetAgents.mockResolvedValue({ success: true, data: [] });
    mockListEpicsWithProgress.mockResolvedValue({
      success: true,
      data: [inProgressEpic, completedEpic],
    });
    // Act
    const service = createDashboardService(mockMessageStore);
    const result = await service.fetchDashboard();

    // Assert
    expect(result.epics.data!.inProgress.items).toHaveLength(1);
    expect(result.epics.data!.inProgress.items[0]!.epic.id).toBe("epic-1");
    expect(result.epics.data!.inProgress.totalCount).toBe(1);

    expect(result.epics.data!.completed.items).toHaveLength(1);
    expect(result.epics.data!.completed.items[0]!.epic.id).toBe("epic-2");
    expect(result.epics.data!.completed.totalCount).toBe(1);
  });
});
