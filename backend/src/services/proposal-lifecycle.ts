/**
 * Proposal lifecycle query helpers.
 *
 * Provides functions for querying proposal-epic linkage via the
 * proposal_epics junction table. Proposal completion is coordinator-driven
 * in the VALIDATE phase (adj-153) — the coordinator marks proposals complete
 * after QA passes, rather than automated bead:closed listeners.
 */

import type Database from "better-sqlite3";

import type { ProposalStore } from "./proposal-store.js";
import { getEventBus } from "./event-bus.js";
import { logInfo } from "../utils/index.js";

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
 * Mark a proposal as completed and emit the event.
 * Called by the coordinator during VALIDATE phase after QA passes.
 */
export function completeProposal(
  proposalStore: ProposalStore,
  proposalId: string,
  projectId: string,
  epicId?: string,
): boolean {
  const proposal = proposalStore.getProposal(proposalId);
  if (!proposal) return false;
  if (proposal.status === "completed") return false;

  proposalStore.updateProposalStatus(proposalId, "completed");

  const payload = epicId != null
    ? { proposalId, projectId, epicId }
    : { proposalId, projectId };
  getEventBus().emit("proposal:completed", payload);

  logInfo("Proposal marked completed by coordinator", {
    proposalId,
    epicId,
  });

  return true;
}
