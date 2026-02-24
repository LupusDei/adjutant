import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Proposal, ProposalRow, ProposalStatus, ProposalType } from "../types/proposals.js";

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    author: row.author,
    title: row.title,
    description: row.description,
    type: row.type as ProposalType,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface InsertProposalInput {
  author: string;
  title: string;
  description: string;
  type: ProposalType;
}

interface GetProposalsOptions {
  status?: ProposalStatus | undefined;
  type?: ProposalType | undefined;
}

export interface ProposalStore {
  insertProposal(input: InsertProposalInput): Proposal;
  getProposal(id: string): Proposal | null;
  getProposals(opts?: GetProposalsOptions): Proposal[];
  updateProposalStatus(id: string, status: ProposalStatus): Proposal | null;
}

export function createProposalStore(db: Database.Database): ProposalStore {
  const insertStmt = db.prepare(`
    INSERT INTO proposals (id, author, title, description, type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
  `);

  const getByIdStmt = db.prepare("SELECT * FROM proposals WHERE id = ?");

  const updateStatusStmt = db.prepare(`
    UPDATE proposals SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);

  return {
    insertProposal(input: InsertProposalInput): Proposal {
      const id = randomUUID();
      insertStmt.run(id, input.author, input.title, input.description, input.type);
      const row = getByIdStmt.get(id) as ProposalRow;
      return rowToProposal(row);
    },

    getProposal(id: string): Proposal | null {
      const row = getByIdStmt.get(id) as ProposalRow | undefined;
      return row !== undefined ? rowToProposal(row) : null;
    },

    getProposals(opts?: GetProposalsOptions): Proposal[] {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts?.status !== undefined) {
        conditions.push("status = ?");
        params.push(opts.status);
      }

      if (opts?.type !== undefined) {
        conditions.push("type = ?");
        params.push(opts.type);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM proposals ${where} ORDER BY created_at DESC, rowid DESC`;
      const rows = db.prepare(sql).all(...params) as ProposalRow[];
      return rows.map(rowToProposal);
    },

    updateProposalStatus(id: string, status: ProposalStatus): Proposal | null {
      const result = updateStatusStmt.run(status, id);
      if (result.changes === 0) return null;
      const row = getByIdStmt.get(id) as ProposalRow;
      return rowToProposal(row);
    },
  };
}
