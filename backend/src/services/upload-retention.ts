/**
 * Upload retention sweep (adj-203.6.1 / T016).
 *
 * Screenshots the Commander shares accumulate on disk indefinitely without a
 * sweep. This prunes attachment ROWS and their backing FILES older than
 * `ADJUTANT_UPLOAD_TTL_DAYS` (default 7) and LOGS the pruned count — never a
 * silent truncation. It reuses the existing primitives (`attachment-store.
 * deleteOlderThan` for rows, `upload-storage.delete` for files) — no new storage
 * or DB access.
 *
 * `pruneOldUploads` is the pure, testable unit. `startUploadRetentionScheduler`
 * wires it onto a periodic interval at server boot (mirrors the audio-cache
 * cleanup scheduler).
 */

import type { AttachmentStore } from "./attachment-store.js";
import type { UploadStorage } from "./upload-storage.js";
import { logInfo, logWarn } from "../utils/logger.js";

/** Default retention window: 7 days. */
export const DEFAULT_UPLOAD_TTL_DAYS = 7;

/** Default sweep interval: 6 hours. */
const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Resolve the retention window from `ADJUTANT_UPLOAD_TTL_DAYS`. Falls back to
 * {@link DEFAULT_UPLOAD_TTL_DAYS} for unset / non-numeric / non-positive values.
 */
export function resolveUploadTtlDays(): number {
  const raw = process.env["ADJUTANT_UPLOAD_TTL_DAYS"];
  if (raw === undefined) return DEFAULT_UPLOAD_TTL_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_UPLOAD_TTL_DAYS;
  }
  return parsed;
}

export interface PruneOldUploadsDeps {
  attachmentStore: Pick<AttachmentStore, "deleteOlderThan">;
  storage: Pick<UploadStorage, "delete">;
  /** Retention window in days. Defaults to {@link resolveUploadTtlDays}. */
  ttlDays?: number;
}

export interface PruneResult {
  /** Number of attachment rows pruned. */
  prunedCount: number;
  /** Number of backing files successfully deleted (≤ prunedCount; some may be gone). */
  filesDeleted: number;
  /** ISO cutoff used (rows created strictly before this were pruned). */
  cutoff: string;
}

/**
 * Delete attachment rows (and their backing files) older than the TTL. Best-effort
 * on the file leg: a missing/errored file never blocks pruning the row. Returns the
 * counts and logs a single summary line (always, even when nothing was pruned so the
 * sweep is observable).
 */
export function pruneOldUploads(deps: PruneOldUploadsDeps): PruneResult {
  const ttlDays = deps.ttlDays ?? resolveUploadTtlDays();
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

  // Rows first — deleteOlderThan returns the removed rows so we can unlink their files.
  const pruned = deps.attachmentStore.deleteOlderThan(cutoff);

  let filesDeleted = 0;
  for (const row of pruned) {
    try {
      deps.storage.delete(row.storagePath);
      filesDeleted++;
    } catch (err) {
      // A file that errors on delete (already gone, permissions) must not abort the
      // sweep — the row is already pruned; log and continue.
      logWarn("upload retention: failed to delete backing file", {
        attachmentId: row.id,
        storagePath: row.storagePath,
        error: String(err),
      });
    }
  }

  logInfo("upload retention sweep: pruned old attachments", {
    prunedCount: pruned.length,
    filesDeleted,
    ttlDays,
    cutoff,
  });

  return { prunedCount: pruned.length, filesDeleted, cutoff };
}

export interface UploadRetentionSchedulerDeps {
  attachmentStore: Pick<AttachmentStore, "deleteOlderThan">;
  storage: Pick<UploadStorage, "delete">;
  /** Sweep interval in ms. Defaults to 6 hours. */
  intervalMs?: number;
  /** Retention window in days. Defaults to {@link resolveUploadTtlDays}. */
  ttlDays?: number;
}

let sweepIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic upload retention sweep. Runs once immediately, then every
 * `intervalMs`. Idempotent — a second call is a no-op while one is running. The
 * interval is `unref`'d so it never keeps the process alive on its own.
 */
export function startUploadRetentionScheduler(deps: UploadRetentionSchedulerDeps): void {
  if (sweepIntervalId !== null) return;

  const intervalMs = deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const run = (): void => {
    try {
      pruneOldUploads({
        attachmentStore: deps.attachmentStore,
        storage: deps.storage,
        ...(deps.ttlDays !== undefined ? { ttlDays: deps.ttlDays } : {}),
      });
    } catch (err) {
      logWarn("upload retention sweep failed", { error: String(err) });
    }
  };

  run(); // immediate first sweep
  sweepIntervalId = setInterval(run, intervalMs);
  sweepIntervalId.unref?.();

  logInfo("upload retention scheduler started", {
    intervalMinutes: Math.round(intervalMs / 60000),
    ttlDays: deps.ttlDays ?? resolveUploadTtlDays(),
  });
}

/** Stop the retention sweep scheduler (test/shutdown hygiene). */
export function stopUploadRetentionScheduler(): void {
  if (sweepIntervalId !== null) {
    clearInterval(sweepIntervalId);
    sweepIntervalId = null;
  }
}
