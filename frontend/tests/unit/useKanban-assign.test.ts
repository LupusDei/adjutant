import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { DragEvent } from "react";
import { useKanban } from "../../src/hooks/useKanban";
import type { BeadInfo } from "../../src/types";

// Mock the api module
vi.mock("../../src/services/api", () => ({
  api: {
    beads: {
      update: vi.fn().mockResolvedValue({ id: "bead-1", status: "in_progress" }),
    },
  },
}));

// Mock ModeContext
vi.mock("../../src/contexts/ModeContext", () => ({
  useMode: vi.fn().mockReturnValue({ isSwarm: false, isGasTown: true }),
}));

import { api } from "../../src/services/api";

function createBead(overrides: Partial<BeadInfo> = {}): BeadInfo {
  return {
    id: "bead-1",
    title: "Test Bead",
    status: "open",
    priority: 2,
    type: "task",
    assignee: null,
    rig: null,
    source: "town",
    labels: [],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

function createMockDragEvent(): DragEvent<HTMLDivElement> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { setData: vi.fn(), getData: vi.fn() },
  } as unknown as DragEvent<HTMLDivElement>;
}

describe("useKanban assign request", () => {
  let onBeadsChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onBeadsChange = vi.fn();
  });

  it("should call onAssignRequest when dropping unassigned bead to in_progress", async () => {
    const onAssignRequest = vi.fn().mockResolvedValue("raynor");
    const beads = [createBead({ id: "bead-1", status: "open", assignee: null })];

    const { result } = renderHook(() =>
      useKanban(beads, onBeadsChange, { onAssignRequest })
    );

    // Simulate drag start from open column
    act(() => {
      result.current.handleDragStart(createMockDragEvent(), beads[0]!);
    });

    // Simulate drop on in_progress
    await act(async () => {
      await result.current.handleDrop(createMockDragEvent(), "in_progress");
    });

    expect(onAssignRequest).toHaveBeenCalledWith("bead-1", "in_progress");
    expect(api.beads.update).toHaveBeenCalledWith("bead-1", {
      status: "in_progress",
      assignee: "raynor",
    });
  });

  it("should abort drop when onAssignRequest returns null (cancelled)", async () => {
    const onAssignRequest = vi.fn().mockResolvedValue(null);
    const beads = [createBead({ id: "bead-1", status: "open", assignee: null })];

    const { result } = renderHook(() =>
      useKanban(beads, onBeadsChange, { onAssignRequest })
    );

    // Simulate drag start
    act(() => {
      result.current.handleDragStart(createMockDragEvent(), beads[0]!);
    });

    // Simulate drop on in_progress
    await act(async () => {
      await result.current.handleDrop(createMockDragEvent(), "in_progress");
    });

    expect(onAssignRequest).toHaveBeenCalledWith("bead-1", "in_progress");
    // API should NOT have been called since user cancelled
    expect(api.beads.update).not.toHaveBeenCalled();
    // beads should NOT have been changed
    expect(onBeadsChange).not.toHaveBeenCalled();
  });

  it("should NOT trigger onAssignRequest when dropping to other columns", async () => {
    const onAssignRequest = vi.fn().mockResolvedValue("raynor");
    const beads = [createBead({ id: "bead-1", status: "open", assignee: null })];

    const { result } = renderHook(() =>
      useKanban(beads, onBeadsChange, { onAssignRequest })
    );

    // Simulate drag start
    act(() => {
      result.current.handleDragStart(createMockDragEvent(), beads[0]!);
    });

    // Drop on blocked (not in_progress)
    await act(async () => {
      await result.current.handleDrop(createMockDragEvent(), "blocked");
    });

    // onAssignRequest should NOT have been called
    expect(onAssignRequest).not.toHaveBeenCalled();
    // But normal update should proceed
    expect(api.beads.update).toHaveBeenCalledWith("bead-1", { status: "blocked" });
  });

  it("should NOT trigger onAssignRequest when bead already has an assignee", async () => {
    const onAssignRequest = vi.fn().mockResolvedValue("raynor");
    const beads = [createBead({ id: "bead-1", status: "open", assignee: "zeratul" })];

    const { result } = renderHook(() =>
      useKanban(beads, onBeadsChange, { onAssignRequest })
    );

    // Simulate drag start
    act(() => {
      result.current.handleDragStart(createMockDragEvent(), beads[0]!);
    });

    // Drop on in_progress
    await act(async () => {
      await result.current.handleDrop(createMockDragEvent(), "in_progress");
    });

    // Should skip onAssignRequest since already assigned
    expect(onAssignRequest).not.toHaveBeenCalled();
    // Standard update should proceed
    expect(api.beads.update).toHaveBeenCalledWith("bead-1", { status: "in_progress" });
  });

  it("should rollback on API error after successful assignment", async () => {
    const onAssignRequest = vi.fn().mockResolvedValue("raynor");
    const onError = vi.fn();
    vi.mocked(api.beads.update).mockRejectedValueOnce(new Error("Server error"));

    const beads = [createBead({ id: "bead-1", status: "open", assignee: null })];

    const { result } = renderHook(() =>
      useKanban(beads, onBeadsChange, { onAssignRequest, onError })
    );

    // Simulate drag start
    act(() => {
      result.current.handleDragStart(createMockDragEvent(), beads[0]!);
    });

    // Drop on in_progress
    await act(async () => {
      await result.current.handleDrop(createMockDragEvent(), "in_progress");
    });

    // onBeadsChange should have been called twice: once for optimistic, once for rollback
    expect(onBeadsChange).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalled();
  });
});
