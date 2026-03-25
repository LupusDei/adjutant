/**
 * Tests for adj-136: proposal project filter resolution.
 * Verifies that list_proposals MCP tool and resolveProjectFilter
 * correctly match proposals by both project name and UUID.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock projects-service before importing
const { mockListProjects } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
}));
vi.mock("../../src/services/projects-service.js", () => ({
  listProjects: mockListProjects,
}));

import { resolveProjectFilter } from "../../src/services/proposal-store.js";

const PROJECTS = [
  { id: "71f9d993", name: "auto-tank", path: "/code/auto-tank" },
  { id: "f1e8f895", name: "adjutant", path: "/code/adjutant" },
];

describe("resolveProjectFilter (adj-136)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListProjects.mockReturnValue({ success: true, data: PROJECTS });
  });

  it("should resolve project name to [id, name] array", () => {
    const result = resolveProjectFilter("auto-tank");
    expect(result).toEqual(["71f9d993", "auto-tank"]);
  });

  it("should resolve project UUID to [id, name] array", () => {
    const result = resolveProjectFilter("71f9d993");
    expect(result).toEqual(["71f9d993", "auto-tank"]);
  });

  it("should return undefined for undefined input", () => {
    const result = resolveProjectFilter(undefined);
    expect(result).toBeUndefined();
    expect(mockListProjects).not.toHaveBeenCalled();
  });

  it("should return undefined for empty string input", () => {
    const result = resolveProjectFilter("");
    expect(result).toBeUndefined();
    expect(mockListProjects).not.toHaveBeenCalled();
  });

  it("should pass through unrecognized project value as-is", () => {
    const result = resolveProjectFilter("unknown-project");
    expect(result).toBe("unknown-project");
  });

  it("should return single id when id equals name", () => {
    mockListProjects.mockReturnValue({
      success: true,
      data: [{ id: "same", name: "same", path: "/x" }],
    });
    const result = resolveProjectFilter("same");
    expect(result).toBe("same");
  });

  it("should pass through value when listProjects fails", () => {
    mockListProjects.mockReturnValue({ success: false });
    const result = resolveProjectFilter("auto-tank");
    expect(result).toBe("auto-tank");
  });
});
