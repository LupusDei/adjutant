import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-proposal-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("migrateProposalProjectNames", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should migrate proposals with project name strings to UUIDs", async () => {
    const { migrateProposalProjectNames } = await import("../../src/services/proposal-store.js");
    const { listProjects } = await import("../../src/services/projects-service.js");

    // Insert a proposal with a name-based project field (legacy format)
    db.prepare(
      "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run("proposal-1", "test-agent", "Fix bugs", "Description", "engineering", "adjutant", "pending");

    // Mock listProjects to return a project with known UUID
    const mockUUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    vi.spyOn(await import("../../src/services/projects-service.js"), "listProjects").mockReturnValue({
      success: true,
      data: [
        {
          id: mockUUID,
          name: "adjutant",
          path: "/some/path",
          mode: "swarm" as const,
          sessions: [],
          createdAt: "2026-01-01",
          active: true,
          autoDevelop: false,
        },
      ],
    });

    const result = migrateProposalProjectNames(db);

    expect(result.migrated).toBe(1);
    expect(result.warnings).toHaveLength(0);

    // Verify the proposal now has the UUID
    const row = db.prepare("SELECT project FROM proposals WHERE id = ?").get("proposal-1") as { project: string };
    expect(row.project).toBe(mockUUID);
  });

  it("should leave proposals already using UUID unchanged", async () => {
    const { migrateProposalProjectNames } = await import("../../src/services/proposal-store.js");

    const existingUUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    // Insert a proposal that already has a UUID in the project field
    db.prepare(
      "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run("proposal-2", "test-agent", "Add caching", "Description", "engineering", existingUUID, "pending");

    vi.spyOn(await import("../../src/services/projects-service.js"), "listProjects").mockReturnValue({
      success: true,
      data: [
        {
          id: existingUUID,
          name: "adjutant",
          path: "/some/path",
          mode: "swarm" as const,
          sessions: [],
          createdAt: "2026-01-01",
          active: true,
          autoDevelop: false,
        },
      ],
    });

    const result = migrateProposalProjectNames(db);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);

    // Verify the project field was not changed
    const row = db.prepare("SELECT project FROM proposals WHERE id = ?").get("proposal-2") as { project: string };
    expect(row.project).toBe(existingUUID);
  });

  it("should leave proposals with unknown project names unchanged and log a warning", async () => {
    const { migrateProposalProjectNames } = await import("../../src/services/proposal-store.js");

    // Insert a proposal with a project name that doesn't match any registered project
    db.prepare(
      "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run("proposal-3", "test-agent", "Something", "Description", "engineering", "unknown-project", "pending");

    vi.spyOn(await import("../../src/services/projects-service.js"), "listProjects").mockReturnValue({
      success: true,
      data: [
        {
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          name: "adjutant",
          path: "/some/path",
          mode: "swarm" as const,
          sessions: [],
          createdAt: "2026-01-01",
          active: true,
          autoDevelop: false,
        },
      ],
    });

    const result = migrateProposalProjectNames(db);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown-project");

    // Verify the project field was not changed
    const row = db.prepare("SELECT project FROM proposals WHERE id = ?").get("proposal-3") as { project: string };
    expect(row.project).toBe("unknown-project");
  });

  it("should handle mixed proposals (some with names, some with UUIDs)", async () => {
    const { migrateProposalProjectNames } = await import("../../src/services/proposal-store.js");

    const mockUUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    // One with name, one with UUID
    db.prepare(
      "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run("p-name", "agent", "Title1", "Desc", "engineering", "adjutant", "pending");

    db.prepare(
      "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run("p-uuid", "agent", "Title2", "Desc", "engineering", mockUUID, "pending");

    vi.spyOn(await import("../../src/services/projects-service.js"), "listProjects").mockReturnValue({
      success: true,
      data: [
        {
          id: mockUUID,
          name: "adjutant",
          path: "/some/path",
          mode: "swarm" as const,
          sessions: [],
          createdAt: "2026-01-01",
          active: true,
          autoDevelop: false,
        },
      ],
    });

    const result = migrateProposalProjectNames(db);

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(1);

    // Name proposal should now have UUID
    const nameRow = db.prepare("SELECT project FROM proposals WHERE id = ?").get("p-name") as { project: string };
    expect(nameRow.project).toBe(mockUUID);

    // UUID proposal should be unchanged
    const uuidRow = db.prepare("SELECT project FROM proposals WHERE id = ?").get("p-uuid") as { project: string };
    expect(uuidRow.project).toBe(mockUUID);
  });

  it("should return early when listProjects fails", async () => {
    const { migrateProposalProjectNames } = await import("../../src/services/proposal-store.js");

    vi.spyOn(await import("../../src/services/projects-service.js"), "listProjects").mockReturnValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "DB failure" },
    });

    const result = migrateProposalProjectNames(db);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Could not list projects");
  });
});

describe("isUUID", () => {
  it("should return true for valid UUIDs", async () => {
    const { isUUID } = await import("../../src/services/proposal-store.js");
    expect(isUUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    expect(isUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("should return false for project name strings", async () => {
    const { isUUID } = await import("../../src/services/proposal-store.js");
    expect(isUUID("adjutant")).toBe(false);
    expect(isUUID("my-project")).toBe(false);
    expect(isUUID("")).toBe(false);
  });

  it("should return true for 8-char hex project IDs (adj-159: generateId() format)", async () => {
    const { isUUID } = await import("../../src/services/proposal-store.js");
    expect(isUUID("a1b2c3d4")).toBe(true);
    expect(isUUID("0e578d15")).toBe(true);
  });

  it("should return false for non-hex 8-char strings", async () => {
    const { isUUID } = await import("../../src/services/proposal-store.js");
    expect(isUUID("abcdefgh")).toBe(false);
    expect(isUUID("1234567z")).toBe(false);
  });
});
