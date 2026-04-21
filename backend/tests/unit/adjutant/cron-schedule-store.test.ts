import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-cron-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("CronScheduleStore", () => {
  let store: Awaited<ReturnType<typeof createStore>>;

  async function createStore() {
    const { CronScheduleStore } = await import(
      "../../../src/services/adjutant/cron-schedule-store.js"
    );
    return new CronScheduleStore(db);
  }

  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    store = await createStore();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ======================================================================
  // create
  // ======================================================================

  describe("create", () => {
    it("should create a schedule and return it with all fields", () => {
      const result = store.create({
        cronExpr: "*/15 * * * *",
        reason: "Health check",
        createdBy: "adjutant",
        nextFireAt: "2026-03-24T12:15:00.000Z",
      });

      expect(result.id).toBeDefined();
      expect(result.cronExpr).toBe("*/15 * * * *");
      expect(result.reason).toBe("Health check");
      expect(result.createdBy).toBe("adjutant");
      expect(result.nextFireAt).toBe("2026-03-24T12:15:00.000Z");
      expect(result.enabled).toBe(true);
      expect(result.fireCount).toBe(0);
      expect(result.lastFiredAt).toBeNull();
      expect(result.maxFires).toBeNull();
    });

    it("should accept optional maxFires", () => {
      const result = store.create({
        cronExpr: "0 * * * *",
        reason: "One-shot hourly",
        createdBy: "adjutant",
        nextFireAt: "2026-03-24T13:00:00.000Z",
        maxFires: 5,
      });

      expect(result.maxFires).toBe(5);
    });

    it("should throw when given an invalid cron expression", () => {
      expect(() => {
        store.create({
          cronExpr: "not a cron",
          reason: "Invalid",
          createdBy: "adjutant",
          nextFireAt: "2026-03-24T12:00:00.000Z",
        });
      }).toThrow(/Invalid cron expression/);
    });

    it("should generate unique IDs for each schedule", () => {
      const a = store.create({
        cronExpr: "*/10 * * * *",
        reason: "A",
        createdBy: "adjutant",
        nextFireAt: "2026-03-24T12:10:00.000Z",
      });
      const b = store.create({
        cronExpr: "*/20 * * * *",
        reason: "B",
        createdBy: "adjutant",
        nextFireAt: "2026-03-24T12:20:00.000Z",
      });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ======================================================================
  // getById
  // ======================================================================

  describe("getById", () => {
    it("should return the schedule when it exists", () => {
      const created = store.create({
        cronExpr: "*/15 * * * *",
        reason: "Health check",
        createdBy: "adjutant",
        nextFireAt: "2026-03-24T12:15:00.000Z",
      });

      const found = store.getById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.reason).toBe("Health check");
    });

    it("should return undefined for non-existent ID", () => {
      const found = store.getById("nonexistent-id");
      expect(found).toBeUndefined();
    });
  });

  // ======================================================================
  // listAll / listEnabled
  // ======================================================================

  describe("listAll", () => {
    it("should return all schedules", () => {
      store.create({ cronExpr: "*/10 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:10:00.000Z" });
      store.create({ cronExpr: "*/20 * * * *", reason: "B", createdBy: "adjutant", nextFireAt: "2026-03-24T12:20:00.000Z" });

      const all = store.listAll();
      expect(all).toHaveLength(2);
    });

    it("should return empty array when no schedules exist", () => {
      expect(store.listAll()).toHaveLength(0);
    });
  });

  describe("listEnabled", () => {
    it("should return only enabled schedules", () => {
      const a = store.create({ cronExpr: "*/10 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:10:00.000Z" });
      store.create({ cronExpr: "*/20 * * * *", reason: "B", createdBy: "adjutant", nextFireAt: "2026-03-24T12:20:00.000Z" });
      store.disable(a.id);

      const enabled = store.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.reason).toBe("B");
    });
  });

  // ======================================================================
  // update
  // ======================================================================

  describe("update", () => {
    it("should update specified fields", () => {
      const created = store.create({ cronExpr: "*/10 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:10:00.000Z" });

      const result = store.update(created.id, {
        reason: "Updated reason",
        cronExpr: "*/30 * * * *",
      });
      expect(result).toBe(true);

      const updated = store.getById(created.id);
      expect(updated!.reason).toBe("Updated reason");
      expect(updated!.cronExpr).toBe("*/30 * * * *");
    });

    it("should return false for non-existent ID", () => {
      const result = store.update("nonexistent", { reason: "X" });
      expect(result).toBe(false);
    });

    it("should not change fields that are not provided", () => {
      const created = store.create({ cronExpr: "*/10 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:10:00.000Z" });
      store.update(created.id, { reason: "B" });

      const updated = store.getById(created.id);
      expect(updated!.cronExpr).toBe("*/10 * * * *");
      expect(updated!.reason).toBe("B");
    });
  });

  // ======================================================================
  // delete
  // ======================================================================

  describe("delete", () => {
    it("should remove the schedule", () => {
      const created = store.create({ cronExpr: "*/10 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:10:00.000Z" });
      const result = store.delete(created.id);
      expect(result).toBe(true);
      expect(store.getById(created.id)).toBeUndefined();
    });

    it("should return false for non-existent ID", () => {
      expect(store.delete("nonexistent")).toBe(false);
    });
  });

  // ======================================================================
  // incrementFireCount
  // ======================================================================

  describe("incrementFireCount", () => {
    it("should atomically increment fire count and update timestamps", () => {
      const created = store.create({ cronExpr: "*/15 * * * *", reason: "Health check", createdBy: "adjutant", nextFireAt: "2026-03-24T12:15:00.000Z" });

      const result = store.incrementFireCount(
        created.id,
        "2026-03-24T12:15:00.000Z",
        "2026-03-24T12:30:00.000Z",
      );
      expect(result).toBe(true);

      const updated = store.getById(created.id);
      expect(updated!.fireCount).toBe(1);
      expect(updated!.lastFiredAt).toBe("2026-03-24T12:15:00.000Z");
      expect(updated!.nextFireAt).toBe("2026-03-24T12:30:00.000Z");
    });

    it("should return false for non-existent ID", () => {
      expect(store.incrementFireCount("nonexistent", "2026-03-24T12:15:00.000Z", "2026-03-24T12:30:00.000Z")).toBe(false);
    });

    it("should increment correctly on multiple fires", () => {
      const created = store.create({ cronExpr: "*/15 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:15:00.000Z" });

      store.incrementFireCount(created.id, "2026-03-24T12:15:00.000Z", "2026-03-24T12:30:00.000Z");
      store.incrementFireCount(created.id, "2026-03-24T12:30:00.000Z", "2026-03-24T12:45:00.000Z");
      store.incrementFireCount(created.id, "2026-03-24T12:45:00.000Z", "2026-03-24T13:00:00.000Z");

      const updated = store.getById(created.id);
      expect(updated!.fireCount).toBe(3);
      expect(updated!.lastFiredAt).toBe("2026-03-24T12:45:00.000Z");
      expect(updated!.nextFireAt).toBe("2026-03-24T13:00:00.000Z");
    });
  });

  // ======================================================================
  // disable
  // ======================================================================

  describe("disable", () => {
    it("should set enabled to false", () => {
      const created = store.create({ cronExpr: "*/15 * * * *", reason: "A", createdBy: "adjutant", nextFireAt: "2026-03-24T12:15:00.000Z" });
      const result = store.disable(created.id);
      expect(result).toBe(true);

      const updated = store.getById(created.id);
      expect(updated!.enabled).toBe(false);
    });

    it("should return false for non-existent ID", () => {
      expect(store.disable("nonexistent")).toBe(false);
    });
  });

  // ======================================================================
  // adj-163: Agent-scoped scheduling
  // ======================================================================

  describe("create with targetAgent (adj-163)", () => {
    it("should store targetAgent and targetTmuxSession when provided", () => {
      const result = store.create({
        cronExpr: "*/15 * * * *",
        reason: "Pipeline check",
        createdBy: "incubator-coordinator",
        nextFireAt: "2026-04-17T12:15:00.000Z",
        targetAgent: "incubator-coordinator",
        targetTmuxSession: "adj-swarm-incubator-coordinator",
      });

      expect(result.targetAgent).toBe("incubator-coordinator");
      expect(result.targetTmuxSession).toBe("adj-swarm-incubator-coordinator");
    });

    it("should default targetAgent to adjutant-coordinator when not provided", () => {
      const result = store.create({
        cronExpr: "*/15 * * * *",
        reason: "Health check",
        createdBy: "adjutant-coordinator",
        nextFireAt: "2026-04-17T12:15:00.000Z",
      });

      expect(result.targetAgent).toBe("adjutant-coordinator");
      expect(result.targetTmuxSession).toBe("adj-swarm-adjutant-coordinator");
    });
  });

  describe("listByAgent (adj-163)", () => {
    it("should return only schedules targeting the specified agent", () => {
      store.create({
        cronExpr: "*/15 * * * *",
        reason: "Coordinator check",
        createdBy: "adjutant-coordinator",
        nextFireAt: "2026-04-17T12:15:00.000Z",
        targetAgent: "adjutant-coordinator",
        targetTmuxSession: "adj-swarm-adjutant-coordinator",
      });
      store.create({
        cronExpr: "0 */6 * * *",
        reason: "Discovery sweep",
        createdBy: "incubator-coordinator",
        nextFireAt: "2026-04-17T18:00:00.000Z",
        targetAgent: "incubator-coordinator",
        targetTmuxSession: "adj-swarm-incubator-coordinator",
      });
      store.create({
        cronExpr: "*/30 * * * *",
        reason: "Nova reminder",
        createdBy: "adjutant-coordinator",
        nextFireAt: "2026-04-17T12:30:00.000Z",
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      });

      const incubatorSchedules = store.listByAgent("incubator-coordinator");
      expect(incubatorSchedules).toHaveLength(1);
      expect(incubatorSchedules[0]!.reason).toBe("Discovery sweep");

      const novaSchedules = store.listByAgent("nova");
      expect(novaSchedules).toHaveLength(1);
      expect(novaSchedules[0]!.reason).toBe("Nova reminder");

      const coordinatorSchedules = store.listByAgent("adjutant-coordinator");
      expect(coordinatorSchedules).toHaveLength(1);
      expect(coordinatorSchedules[0]!.reason).toBe("Coordinator check");
    });

    it("should return empty array when agent has no schedules", () => {
      expect(store.listByAgent("nonexistent-agent")).toHaveLength(0);
    });
  });

  describe("disableByAgent (adj-163)", () => {
    it("should disable all schedules for the specified agent", () => {
      store.create({
        cronExpr: "*/15 * * * *",
        reason: "Check A",
        createdBy: "nova",
        nextFireAt: "2026-04-17T12:15:00.000Z",
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      });
      store.create({
        cronExpr: "*/30 * * * *",
        reason: "Check B",
        createdBy: "nova",
        nextFireAt: "2026-04-17T12:30:00.000Z",
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      });
      store.create({
        cronExpr: "0 * * * *",
        reason: "Coordinator check",
        createdBy: "adjutant-coordinator",
        nextFireAt: "2026-04-17T13:00:00.000Z",
        targetAgent: "adjutant-coordinator",
        targetTmuxSession: "adj-swarm-adjutant-coordinator",
      });

      const count = store.disableByAgent("nova");
      expect(count).toBe(2);

      // Nova's schedules disabled
      const novaSchedules = store.listByAgent("nova");
      expect(novaSchedules.every(s => !s.enabled)).toBe(true);

      // Coordinator's schedule unaffected
      const coordSchedules = store.listByAgent("adjutant-coordinator");
      expect(coordSchedules[0]!.enabled).toBe(true);
    });

    it("should return 0 when agent has no schedules", () => {
      expect(store.disableByAgent("nonexistent")).toBe(0);
    });
  });
});

// ========================================================================
// computeNextFireAt
// ========================================================================

describe("computeNextFireAt", () => {
  it("should return a valid ISO date string in the future", async () => {
    const { computeNextFireAt } = await import(
      "../../../src/services/adjutant/cron-schedule-store.js"
    );

    const before = Date.now();
    const result = computeNextFireAt("*/15 * * * *");
    const after = Date.now();

    const resultMs = new Date(result).getTime();
    // Should be ~15 minutes in the future
    expect(resultMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 1);
    expect(resultMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 1);
  });

  it("should work with hourly cron expression", async () => {
    const { computeNextFireAt } = await import(
      "../../../src/services/adjutant/cron-schedule-store.js"
    );

    const before = Date.now();
    const result = computeNextFireAt("0 * * * *");
    const resultMs = new Date(result).getTime();
    // Should be ~60 minutes in the future
    expect(resultMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1);
  });

  it("should compute next fire from baseTime when provided to avoid drift", async () => {
    const { computeNextFireAt } = await import(
      "../../../src/services/adjutant/cron-schedule-store.js"
    );

    // Simulate: schedule was supposed to fire at 12:00 but actually fired at 12:01:30 (90s delay)
    const lastFiredAt = new Date("2026-03-24T12:00:00.000Z");
    const result = computeNextFireAt("*/15 * * * *", lastFiredAt);
    const resultMs = new Date(result).getTime();

    // Next fire should be exactly 15 minutes after lastFiredAt, not 15 minutes after "now"
    const expected = lastFiredAt.getTime() + 15 * 60 * 1000;
    expect(resultMs).toBe(expected);
  });

  it("should default to Date.now() when baseTime is not provided", async () => {
    const { computeNextFireAt } = await import(
      "../../../src/services/adjutant/cron-schedule-store.js"
    );

    const before = Date.now();
    const result = computeNextFireAt("*/15 * * * *");
    const after = Date.now();
    const resultMs = new Date(result).getTime();

    // Should be ~15 minutes from now (not from some other base)
    expect(resultMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 1);
    expect(resultMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 1);
  });
});
