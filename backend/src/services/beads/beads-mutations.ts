/**
 * Bead mutation operations.
 *
 * All write operations that modify bead state: update, close, auto-complete epics.
 */

import { execBd, resolveBeadsDir } from "../bd-client.js";
import { resolveWorkspaceRoot } from "../workspace/index.js";
import { getEventBus } from "../event-bus.js";
import { logInfo } from "../../utils/index.js";
import type {
  BeadStatus,
  BeadsServiceResult,
  UpdateBeadOptions,
} from "./types.js";
import { ALL_STATUSES } from "./types.js";
import { resolveBeadDatabase } from "./beads-database.js";
import { isBeadEpic } from "./beads-epics.js";

// ============================================================================
// Auto-Complete Epics
// ============================================================================

/**
 * Runs `bd epic close-eligible` to auto-close epics whose children are all done.
 * Called after any task/bug is closed to propagate completion up the hierarchy.
 *
 * @param workDir Working directory (defaults to workspace root)
 * @param beadsDir Beads directory (defaults to resolved from workDir)
 * @returns Array of auto-closed epic IDs (may be empty)
 */
export async function autoCompleteEpics(
  workDir?: string,
  beadsDir?: string
): Promise<string[]> {
  const effectiveWorkDir = workDir ?? resolveWorkspaceRoot();
  const effectiveBeadsDir = beadsDir ?? resolveBeadsDir(effectiveWorkDir);

  const result = await execBd<Array<{ id: string; title?: string }>>(
    ["epic", "close-eligible", "--json"],
    { cwd: effectiveWorkDir, beadsDir: effectiveBeadsDir }
  );

  if (!result.success || !result.data) return [];

  const closedIds: string[] = [];
  for (const epic of result.data) {
    const epicId = typeof epic === "string" ? epic : epic.id;
    if (epicId) {
      closedIds.push(epicId);
      getEventBus().emit("bead:closed", {
        id: epicId,
        title: typeof epic === "object" ? (epic.title ?? "") : "",
        closedAt: new Date().toISOString(),
      });
      logInfo("epic auto-completed", { epicId });
    }
  }

  return closedIds;
}

// ============================================================================
// Update Operations
// ============================================================================

/**
 * Updates a bead's fields (status, assignee, or both).
 *
 * NOTE: Epics cannot be set to "closed" directly. They auto-complete
 * when all sub-beads are closed (via `bd epic close-eligible`).
 */
export async function updateBead(
  beadId: string,
  options: UpdateBeadOptions
): Promise<BeadsServiceResult<{ id: string; status?: string; assignee?: string; autoCompleted?: string[] }>> {
  try {
    const { status, assignee } = options;

    if (!status && assignee === undefined) {
      return {
        success: false,
        error: { code: "INVALID_REQUEST", message: "At least one of 'status' or 'assignee' must be provided" },
      };
    }

    if (status && !ALL_STATUSES.includes(status)) {
      return {
        success: false,
        error: { code: "INVALID_STATUS", message: `Invalid status: ${status}. Valid values: ${ALL_STATUSES.join(", ")}` },
      };
    }

    const db = await resolveBeadDatabase(beadId);
    if ("error" in db) {
      return { success: false, error: db.error };
    }

    // Guard: epics cannot be closed directly — they auto-complete
    if (status === "closed") {
      const epic = await isBeadEpic(beadId, db);
      if (epic) {
        return {
          success: false,
          error: {
            code: "EPIC_CLOSE_BLOCKED",
            message: `Epics cannot be closed directly. Epic ${beadId} will auto-complete when all its sub-beads are closed.`,
          },
        };
      }
    }

    const shortId = beadId.includes("-") ? beadId.split("-").slice(1).join("-") : beadId;
    const args = ["update", shortId];

    if (status) args.push("--status", status);
    if (assignee !== undefined) args.push("--assignee", assignee);

    const result = await execBd<void>(args, { cwd: db.workDir, beadsDir: db.beadsDir, parseJson: false });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "UPDATE_FAILED",
          message: result.error?.message ?? "Failed to update bead",
        },
      };
    }

    // Emit bead event for SSE/WebSocket consumers
    if (status === "closed") {
      getEventBus().emit("bead:closed", {
        id: beadId,
        title: "",
        closedAt: new Date().toISOString(),
      });
    } else {
      getEventBus().emit("bead:updated", {
        id: beadId,
        status: status ?? "",
        title: "",
        updatedAt: new Date().toISOString(),
        ...(assignee !== undefined ? { assignee } : {}),
      });
    }

    // After closing a non-epic bead, auto-complete any eligible parent epics
    let autoCompleted: string[] = [];
    if (status === "closed") {
      autoCompleted = await autoCompleteEpics(db.workDir, db.beadsDir);
    }

    const responseData: { id: string; status?: string; assignee?: string; autoCompleted?: string[] } = { id: beadId };
    if (status) responseData.status = status;
    if (assignee !== undefined) responseData.assignee = assignee;
    if (autoCompleted.length > 0) responseData.autoCompleted = autoCompleted;

    return { success: true, data: responseData };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "UPDATE_ERROR",
        message: err instanceof Error ? err.message : "Failed to update bead",
      },
    };
  }
}

/**
 * Updates a bead's status. Backward-compatible wrapper around updateBead().
 */
export async function updateBeadStatus(
  beadId: string,
  status: BeadStatus
): Promise<BeadsServiceResult<{ id: string; status: string; autoCompleted?: string[] }>> {
  const result = await updateBead(beadId, { status });
  if (!result.success) return result as BeadsServiceResult<{ id: string; status: string; autoCompleted?: string[] }>;

  return {
    success: true,
    data: {
      id: result.data!.id,
      status: result.data!.status ?? status,
      ...(result.data!.autoCompleted ? { autoCompleted: result.data!.autoCompleted } : {}),
    },
  };
}
