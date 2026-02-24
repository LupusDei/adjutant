import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProposals } from "../../src/hooks/useProposals";
import type { Proposal } from "../../src/types";

const { mockList, mockUpdateStatus } = vi.hoisted(() => {
  const proposals: Proposal[] = [
    {
      id: "p1",
      author: "agent-1",
      title: "Improve UX",
      description: "Add onboarding flow",
      type: "product",
      status: "pending",
      createdAt: "2026-02-24T00:00:00Z",
      updatedAt: "2026-02-24T00:00:00Z",
    },
    {
      id: "p2",
      author: "agent-2",
      title: "Refactor services",
      description: "Extract shared logic",
      type: "engineering",
      status: "pending",
      createdAt: "2026-02-24T01:00:00Z",
      updatedAt: "2026-02-24T01:00:00Z",
    },
  ];

  return {
    mockList: vi.fn().mockResolvedValue([...proposals]),
    mockUpdateStatus: vi.fn().mockImplementation((id: string, status: string) =>
      Promise.resolve({ ...proposals.find((p) => p.id === id)!, status }),
    ),
  };
});

vi.mock("../../src/services/api", () => ({
  default: {
    proposals: {
      list: mockList,
      updateStatus: mockUpdateStatus,
    },
  },
}));

describe("useProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([
      {
        id: "p1",
        author: "agent-1",
        title: "Improve UX",
        description: "Add onboarding flow",
        type: "product",
        status: "pending",
        createdAt: "2026-02-24T00:00:00Z",
        updatedAt: "2026-02-24T00:00:00Z",
      },
      {
        id: "p2",
        author: "agent-2",
        title: "Refactor services",
        description: "Extract shared logic",
        type: "engineering",
        status: "pending",
        createdAt: "2026-02-24T01:00:00Z",
        updatedAt: "2026-02-24T01:00:00Z",
      },
    ]);
    mockUpdateStatus.mockImplementation((id: string, status: string) => {
      const proposals = [
        { id: "p1", author: "agent-1", title: "Improve UX", description: "Add onboarding flow", type: "product", status: "pending", createdAt: "2026-02-24T00:00:00Z", updatedAt: "2026-02-24T00:00:00Z" },
        { id: "p2", author: "agent-2", title: "Refactor services", description: "Extract shared logic", type: "engineering", status: "pending", createdAt: "2026-02-24T01:00:00Z", updatedAt: "2026-02-24T01:00:00Z" },
      ];
      return Promise.resolve({ ...proposals.find((p) => p.id === id)!, status });
    });
  });

  it("should load proposals on mount", async () => {
    const { result } = renderHook(() => useProposals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.proposals).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("should default to pending status filter", () => {
    const { result } = renderHook(() => useProposals());
    expect(result.current.statusFilter).toBe("pending");
  });

  it("should default to all type filter", () => {
    const { result } = renderHook(() => useProposals());
    expect(result.current.typeFilter).toBe("all");
  });

  it("should accept a proposal", async () => {
    const { result } = renderHook(() => useProposals());

    await waitFor(() => {
      expect(result.current.proposals).toHaveLength(2);
    });

    await act(async () => {
      await result.current.accept("p1");
    });

    const updated = result.current.proposals.find((p) => p.id === "p1");
    expect(updated?.status).toBe("accepted");
  });

  it("should dismiss a proposal", async () => {
    const { result } = renderHook(() => useProposals());

    await waitFor(() => {
      expect(result.current.proposals).toHaveLength(2);
    });

    await act(async () => {
      await result.current.dismiss("p2");
    });

    const updated = result.current.proposals.find((p) => p.id === "p2");
    expect(updated?.status).toBe("dismissed");
  });

  it("should update status filter", async () => {
    const { result } = renderHook(() => useProposals());

    act(() => {
      result.current.setStatusFilter("accepted");
    });

    expect(result.current.statusFilter).toBe("accepted");
  });

  it("should update type filter", async () => {
    const { result } = renderHook(() => useProposals());

    act(() => {
      result.current.setTypeFilter("engineering");
    });

    expect(result.current.typeFilter).toBe("engineering");
  });
});
