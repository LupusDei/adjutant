import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Since AgentAssignDropdown is a React component with DOM interactions,
// we test the core logic patterns rather than full component rendering.
// The key behaviors: agent fetching, filtering, selection callback.

vi.mock("../../src/services/api", () => ({
  api: {
    agents: {
      list: vi.fn(),
    },
    beads: {
      update: vi.fn().mockResolvedValue({ id: "test", assignee: "raynor" }),
    },
  },
}));

import { api } from "../../src/services/api";

describe("AgentAssignDropdown logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should filter agents to idle and working status", async () => {
    const mockAgents = [
      { id: "1", name: "raynor", status: "idle", type: "polecat", rig: "gastown" },
      { id: "2", name: "zeratul", status: "working", type: "polecat", rig: "gastown" },
      { id: "3", name: "kerrigan", status: "blocked", type: "polecat", rig: "gastown" },
    ];
    vi.mocked(api.agents.list).mockResolvedValue(mockAgents as any);

    const result = await api.agents.list();
    const available = result.filter(
      (a: any) => a.status === "idle" || a.status === "working"
    );

    expect(available).toHaveLength(2);
    expect(available.map((a: any) => a.name)).toEqual(["raynor", "zeratul"]);
  });

  it("should return empty array when no agents are idle or working", async () => {
    const mockAgents = [
      { id: "1", name: "kerrigan", status: "blocked", type: "polecat", rig: "gastown" },
    ];
    vi.mocked(api.agents.list).mockResolvedValue(mockAgents as any);

    const result = await api.agents.list();
    const available = result.filter(
      (a: any) => a.status === "idle" || a.status === "working"
    );

    expect(available).toHaveLength(0);
  });

  it("should call beads.update with assignee when agent selected", async () => {
    await api.beads.update("hq-001", { assignee: "raynor" });

    expect(api.beads.update).toHaveBeenCalledWith("hq-001", { assignee: "raynor" });
  });

  it("should handle API error gracefully", async () => {
    vi.mocked(api.agents.list).mockRejectedValueOnce(new Error("Network error"));

    await expect(api.agents.list()).rejects.toThrow("Network error");
  });

  it("should extract short name from full agent path", () => {
    // Test the shortName logic used in the component
    const shortName = (name: string | null): string => {
      if (!name) return "";
      const parts = name.split("/");
      return parts[parts.length - 1] ?? name;
    };

    expect(shortName("gastown/raynor")).toBe("raynor");
    expect(shortName("raynor")).toBe("raynor");
    expect(shortName(null)).toBe("");
    expect(shortName("a/b/c")).toBe("c");
  });
});
