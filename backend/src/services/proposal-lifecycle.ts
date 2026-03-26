/**
 * Proposal lifecycle service.
 *
 * Listens for bead:closed events and auto-completes proposals
 * when all linked epics are closed. Also provides helpers
 * for querying proposal-epic linkage.
 */

import type Database from "better-sqlite3";

import type { ProposalStore } from "./proposal-store.js";
import { getEventBus } from "./event-bus.js";
import type { BeadClosedEvent } from "./event-bus.js";
import { execBd, resolveBeadsDir } from "./bd-client.js";
import { resolveWorkspaceRoot } from "./workspace/index.js";
import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ProposalEpicLink {
  proposalId: string;
  epicId: string;
  projectId: string;
}

// ============================================================================
// Query helpers
// ============================================================================

/**
 * Get all proposal links for a given epic ID.
 */
/** Raw row shape from SQLite (snake_case columns) */
interface ProposalEpicRow {
  proposal_id: string;
  epic_id: string;
  project_id: string;
}

/**
 * Get all proposal links for a given epic ID.
 */
export function getProposalLinksForEpic(
  db: Database.Database,
  epicId: string,
): ProposalEpicLink[] {
  const rows = db.prepare(
    "SELECT proposal_id, epic_id, project_id FROM proposal_epics WHERE epic_id = ?",
  ).all(epicId) as ProposalEpicRow[];
  return rows.map((r) => ({
    proposalId: r.proposal_id,
    epicId: r.epic_id,
    projectId: r.project_id,
  }));
}

/**
 * Get all epic IDs linked to a proposal.
 */
export function getEpicsForProposal(
  db: Database.Database,
  proposalId: string,
): string[] {
  const rows = db.prepare(
    "SELECT epic_id FROM proposal_epics WHERE proposal_id = ?",
  ).all(proposalId) as { epic_id: string }[];
  return rows.map((r) => r.epic_id);
}

/**
 * Check if a bead is closed by querying bd CLI.
 * Returns true if the bead status is "closed".
 */
async function isBeadClosed(beadId: string): Promise<boolean> {
  const workDir = resolveWorkspaceRoot();
  const beadsDir = resolveBeadsDir(workDir);
  const shortId = beadId.includes("-") ? beadId.split("-").slice(1).join("-") : beadId;
  const result = await execBd<Record<string, unknown>>(
    ["show", shortId, "--json"],
    { cwd: workDir, beadsDir },
  );
  if (!result.success || !result.data) return false;
  return result.data["status"] === "closed";
}

/**
 * Check if ALL epics linked to a proposal are closed.
 * If so, mark the proposal as completed and emit event.
 */
export async function checkAndCompleteProposal(
  db: Database.Database,
  proposalStore: ProposalStore,
  proposalId: string,
  projectId: string,
): Promise<boolean> {
  const proposal = proposalStore.getProposal(proposalId);
  if (!proposal) return false;
  if (proposal.status === "completed") return false;

  const epicIds = getEpicsForProposal(db, proposalId);
  if (epicIds.length === 0) return false;

  // Check each linked epic's status
  for (const epicId of epicIds) {
    const closed = await isBeadClosed(epicId);
    if (!closed) return false;
  }

  // All epics are closed — complete the proposal
  proposalStore.updateProposalStatus(proposalId, "completed");

  getEventBus().emit("proposal:completed", {
    proposalId,
    projectId,
  });

  logInfo("Proposal auto-completed — all linked epics closed", {
    proposalId,
    epicCount: epicIds.length,
  });

  return true;
}

// ============================================================================
// EventBus wiring
// ============================================================================

/**
 * Initialize proposal lifecycle event listeners.
 *
 * Listens for bead:closed events and checks if the closed bead
 * is linked to a proposal via proposal_epics. If all linked epics
 * are now closed, auto-completes the proposal.
 */
export function initProposalLifecycle(
  db: Database.Database,
  proposalStore: ProposalStore,
): void {
  const bus = getEventBus();

  bus.on("bead:closed", (data: BeadClosedEvent) => {
    // Fire-and-forget: check if this bead closure completes any proposals
    void handleBeadClosed(db, proposalStore, data).catch((err) => {
      logWarn("proposal-lifecycle: error handling bead:closed", {
        beadId: data.id,
        error: String(err),
      });
    });
  });

  logInfo("Proposal lifecycle listeners initialized");
}

async function handleBeadClosed(
  db: Database.Database,
  proposalStore: ProposalStore,
  data: BeadClosedEvent,
): Promise<void> {
  const links = getProposalLinksForEpic(db, data.id);
  if (links.length === 0) return;

  for (const link of links) {
    await checkAndCompleteProposal(db, proposalStore, link.proposalId, link.projectId);
  }
}
