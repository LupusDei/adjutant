import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before importing the module under test
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn().mockReturnValue("/mock/.beads"),
}));

vi.mock("../../src/services/beads/beads-database.js", () => ({
  resolveBeadDatabase: vi.fn().mockResolvedValue({
    workDir: "/mock/workdir",
    beadsDir: "/mock/.beads",
  }),
}));

vi.mock("../../src/services/beads/beads-prefix-map.js", () => ({
  ensurePrefixMap: vi.fn().mockResolvedValue(undefined),
  loadPrefixMap: vi.fn().mockReturnValue(new Map()),
  prefixToSource: vi.fn().mockReturnValue("town"),
}));

vi.mock("../../src/services/beads/beads-transform.js", () => ({
  transformBead: vi.fn().mockImplementation((issue: { id: string; status: string }) => ({
    id: issue.id,
    status: issue.status,
    title: `Mock ${issue.id}`,
    type: "task",
    source: "town",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  })),
}));

vi.mock("../../src/services/beads/beads-dependency.js", () => ({
  processEpicChildren: vi.fn().mockImplementation((issues: { id: string; status: string }[]) =>
    issues.map((i) => ({
      id: i.id,
      status: i.status,
      title: `Mock ${i.id}`,
      type: "task",
      source: "town",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }))
  ),
  buildEpicWithChildren: vi.fn(),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  listAllBeadsDirs: vi.fn().mockResolvedValue([]),
  resolveWorkspaceRoot: vi.fn().mockReturnValue("/mock/workspace"),
}));

import { execBd } from "../../src/services/bd-client.js";
import { getEpicChildren } from "../../src/services/beads/beads-epics.js";

const mockExecBd = vi.mocked(execBd);

describe("getEpicChildren", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use bd list --parent --all to include closed children", async () => {
    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-065.1", status: "closed", title: "Closed task", issue_type: "task" },
        { id: "adj-065.2", status: "open", title: "Open task", issue_type: "task" },
      ],
    });

    await getEpicChildren("adj-065");

    // bd children doesn't support --all, so use bd list --parent --all instead
    expect(mockExecBd).toHaveBeenCalledWith(
      ["list", "--parent", "adj-065", "--all", "--json"],
      expect.objectContaining({ cwd: "/mock/workdir", beadsDir: "/mock/.beads" })
    );
  });

  it("should return closed children in the results", async () => {
    const closedTask = { id: "adj-065.1", status: "closed", title: "Done task", issue_type: "task" };
    const openTask = { id: "adj-065.2", status: "open", title: "Open task", issue_type: "task" };

    mockExecBd.mockResolvedValue({
      success: true,
      data: [closedTask, openTask],
    });

    const result = await getEpicChildren("adj-065");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      // Verify closed task is included
      expect(result.data.some((b) => b.id === "adj-065.1")).toBe(true);
    }
  });
});
