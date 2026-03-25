import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { cronToIntervalMs } from "./adjutant-core.js";

// ============================================================================
// Types
// ============================================================================

export interface CronSchedule {
  id: string;
  cronExpr: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  lastFiredAt: string | null;
  nextFireAt: string;
  enabled: boolean;
  maxFires: number | null;
  fireCount: number;
}

interface CronScheduleRow {
  id: string;
  cron_expr: string;
  reason: string;
  created_by: string;
  created_at: string;
  last_fired_at: string | null;
  next_fire_at: string;
  enabled: number;
  max_fires: number | null;
  fire_count: number;
}

interface CreateParams {
  cronExpr: string;
  reason: string;
  createdBy: string;
  nextFireAt: string;
  maxFires?: number;
}

type UpdatableFields = Partial<{
  cronExpr: string;
  reason: string;
  enabled: boolean;
  nextFireAt: string;
  lastFiredAt: string;
  fireCount: number;
}>;

// ============================================================================
// Row-to-model conversion
// ============================================================================

function rowToSchedule(row: CronScheduleRow): CronSchedule {
  return {
    id: row.id,
    cronExpr: row.cron_expr,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastFiredAt: row.last_fired_at,
    nextFireAt: row.next_fire_at,
    enabled: row.enabled === 1,
    maxFires: row.max_fires,
    fireCount: row.fire_count,
  };
}

// ============================================================================
// CronScheduleStore
// ============================================================================

export class CronScheduleStore {
  private insertStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private listAllStmt: Database.Statement;
  private listEnabledStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private incrementFireStmt: Database.Statement;
  private disableStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO cron_schedules (id, cron_expr, reason, created_by, next_fire_at, max_fires)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = db.prepare("SELECT * FROM cron_schedules WHERE id = ?");

    this.listAllStmt = db.prepare("SELECT * FROM cron_schedules ORDER BY created_at ASC");

    this.listEnabledStmt = db.prepare(
      "SELECT * FROM cron_schedules WHERE enabled = 1 ORDER BY created_at ASC",
    );

    this.deleteStmt = db.prepare("DELETE FROM cron_schedules WHERE id = ?");

    this.incrementFireStmt = db.prepare(`
      UPDATE cron_schedules
      SET fire_count = fire_count + 1, last_fired_at = ?, next_fire_at = ?
      WHERE id = ?
    `);

    this.disableStmt = db.prepare(
      "UPDATE cron_schedules SET enabled = 0 WHERE id = ?",
    );
  }

  /** Insert a new cron schedule. Returns the created schedule. */
  create(params: CreateParams): CronSchedule {
    // Validate cron expression before persisting
    try {
      cronToIntervalMs(params.cronExpr);
    } catch (err) {
      throw new Error(`Invalid cron expression "${params.cronExpr}": ${String(err)}`);
    }

    const id = randomUUID();
    this.insertStmt.run(
      id,
      params.cronExpr,
      params.reason,
      params.createdBy,
      params.nextFireAt,
      params.maxFires ?? null,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we just inserted, so getById will find it
    return this.getById(id)!;
  }

  /** Get a schedule by ID. Returns undefined if not found. */
  getById(id: string): CronSchedule | undefined {
    const row = this.getByIdStmt.get(id) as CronScheduleRow | undefined;
    return row ? rowToSchedule(row) : undefined;
  }

  /** List all schedules. */
  listAll(): CronSchedule[] {
    const rows = this.listAllStmt.all() as CronScheduleRow[];
    return rows.map(rowToSchedule);
  }

  /** List only enabled schedules. */
  listEnabled(): CronSchedule[] {
    const rows = this.listEnabledStmt.all() as CronScheduleRow[];
    return rows.map(rowToSchedule);
  }

  /** Update specified fields on a schedule. Returns true if the row existed. */
  update(id: string, fields: UpdatableFields): boolean {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (fields.cronExpr !== undefined) {
      setClauses.push("cron_expr = ?");
      values.push(fields.cronExpr);
    }
    if (fields.reason !== undefined) {
      setClauses.push("reason = ?");
      values.push(fields.reason);
    }
    if (fields.enabled !== undefined) {
      setClauses.push("enabled = ?");
      values.push(fields.enabled ? 1 : 0);
    }
    if (fields.nextFireAt !== undefined) {
      setClauses.push("next_fire_at = ?");
      values.push(fields.nextFireAt);
    }
    if (fields.lastFiredAt !== undefined) {
      setClauses.push("last_fired_at = ?");
      values.push(fields.lastFiredAt);
    }
    if (fields.fireCount !== undefined) {
      setClauses.push("fire_count = ?");
      values.push(fields.fireCount);
    }

    if (setClauses.length === 0) return false;

    values.push(id);
    const sql = `UPDATE cron_schedules SET ${setClauses.join(", ")} WHERE id = ?`;
    const result = this.db.prepare(sql).run(...values);
    return result.changes > 0;
  }

  /** Delete a schedule by ID. Returns true if the row existed. */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  /** Atomically increment fire count and update timestamps. */
  incrementFireCount(id: string, lastFiredAt: string, nextFireAt: string): boolean {
    const result = this.incrementFireStmt.run(lastFiredAt, nextFireAt, id);
    return result.changes > 0;
  }

  /** Disable a schedule (set enabled=0). */
  disable(id: string): boolean {
    const result = this.disableStmt.run(id);
    return result.changes > 0;
  }
}

// ============================================================================
// Helper: compute next fire time from cron expression
// ============================================================================

/**
 * Compute the next fire time from a cron expression.
 * Uses cronToIntervalMs() to get the interval, then adds it to the base time.
 * When baseTime is provided (e.g., lastFiredAt), next fire is computed from that
 * timestamp to maintain a fixed cadence and avoid schedule drift.
 */
export function computeNextFireAt(cronExpr: string, baseTime?: Date): string {
  const intervalMs = cronToIntervalMs(cronExpr);
  const base = baseTime ?? new Date();
  return new Date(base.getTime() + intervalMs).toISOString();
}
