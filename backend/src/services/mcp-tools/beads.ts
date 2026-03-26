/**
 * MCP tools for bead (issue tracker) operations.
 *
 * Provides create, update, close, list, and show tools that wrap
 * the bd-client service. All calls are serialized through a mutex
 * to prevent concurrent bd access (SQLite SIGSEGV).
 *
 * When an agent has project context (from session metadata), bead
 * operations are scoped to that project's .beads/ directory. Legacy
 * agents without project context fall back to workspace-default behavior.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { execBd, type BdExecOptions, type BdResult } from "../bd-client.js";
import { logError } from "../../utils/index.js";
import { autoCompleteEpics } from "../beads/index.js";
import { getAgentBySession, resolveToolProjectContext } from "../mcp-server.js";
import type { EventStore } from "../event-store.js";
import type { ProposalStore } from "../proposal-store.js";
import { getEventBus } from "../event-bus.js";

// =============================================================================
// Mutex for serializing bd access
// =============================================================================

class SimpleMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const bdMutex = new SimpleMutex();

// =============================================================================
// Helpers
// =============================================================================

function errorResult(result: BdResult) {
  const msg = result.error?.message ?? "Unknown error";
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

/**
 * Resolve bd execution options from MCP session project context.
 * If the agent has a project context, scopes bd to that project's .beads/.
 * Otherwise returns empty options (workspace-default behavior).
 *
 * Logs warnings when agents access beads without project context,
 * helping catch misconfigured agents (adj-029.2.5).
 */
function resolveBdOptions(extra?: { sessionId?: string | undefined }, explicitProjectId?: string): BdExecOptions {
  const ctx = resolveToolProjectContext(explicitProjectId, extra?.sessionId);
  if (!ctx) {
    if (!extra?.sessionId) console.warn("[beads] Bead tool called without session ID");
    else console.warn(`[beads] Agent session ${extra.sessionId} has no project context`);
    return {};
  }
  return { cwd: ctx.projectPath, beadsDir: ctx.beadsDir };
}

// =============================================================================
// Tool registration
// =============================================================================


export function registerBeadTools(server: McpServer, eventStore?: EventStore, _proposalStore?: ProposalStore, _db?: Database.Database): void {
  // ---------------------------------------------------------------------------
  // create_bead
  // ---------------------------------------------------------------------------
  server.tool(
    "create_bead",
    {
      id: z.string().optional().describe("Bead ID (auto-generated if omitted)"),
      title: z.string().describe("Bead title"),
      description: z.string().describe("Bead description"),
      type: z.enum(["epic", "task", "bug"]).describe("Bead type"),
      priority: z.number().min(0).max(4).describe("Priority: 0=critical, 4=backlog"),
      projectId: z.string().optional().describe("Project UUID for cross-project operations (defaults to session project)"),
    },
    async ({ id, title, description, type, priority, projectId }, extra) => {
      const bdOpts = resolveBdOptions(extra, projectId);
      return bdMutex.runExclusive(async () => {
        const args: string[] = [
          "create",
          "--json",
          "--title", title,
          "--description", description,
          "--type", type,
          "--priority", String(priority),
        ];
        if (id) {
          args.push("--id", id);
        }

        const result = await execBd(args, bdOpts);
        if (!result.success) {
          logError("create_bead failed", { error: result.error });
          return errorResult(result);
        }

        const data = result.data as Record<string, unknown> | undefined;
        const createdId = String(data?.['id'] ?? "unknown");

        getEventBus().emit("bead:created", {
          id: createdId,
          title,
          status: "open",
          type,
        });

        return {
          content: [{ type: "text" as const, text: `Created bead ${createdId}: ${title}` }],
        };
      });
    },
  );

  // ---------------------------------------------------------------------------
  // update_bead
  // ---------------------------------------------------------------------------
  server.tool(
    "update_bead",
    {
      id: z.string().describe("Bead ID to update"),
      status: z.enum(["open", "in_progress", "closed"]).optional().describe("New status"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      assignee: z.string().optional().describe("Assignee name"),
      priority: z.number().min(0).max(4).optional().describe("Priority: 0=critical, 4=backlog"),
      projectId: z.string().optional().describe("Project UUID for cross-project operations (defaults to session project)"),
    },
    async ({ id, status, title, description, assignee, priority, projectId }, extra) => {
      const bdOpts = resolveBdOptions(extra, projectId);
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["update", id, "--json"];

        if (status) args.push(`--status=${status}`);
        if (title) args.push("--title", title);
        if (description) args.push("--description", description);
        if (assignee) args.push("--assignee", assignee);
        if (priority !== undefined && priority !== null) args.push("--priority", String(priority));

        const result = await execBd(args, bdOpts);
        if (!result.success) {
          logError("update_bead failed", { id, error: result.error });
          return errorResult(result);
        }

        // Emit timeline event for bead update
        const resolvedAgent = extra?.sessionId ? getAgentBySession(extra.sessionId) : undefined;
        const updateEventInput: Parameters<NonNullable<typeof eventStore>["insertEvent"]>[0] = {
          eventType: "bead_updated",
          agentId: resolvedAgent ?? "system",
          action: `Updated bead ${id}`,
          detail: { id, status, assignee },
          beadId: id,
        };
        eventStore?.insertEvent(updateEventInput);

        // After closing a task/bug via update, auto-complete any eligible parent epics
        const messages = [`Updated bead ${id}`];
        if (status === "closed") {
          const autoCompleted = await autoCompleteEpics();
          if (autoCompleted.length > 0) {
            messages.push(`Auto-completed epics: ${autoCompleted.join(", ")}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: messages.join("\n") }],
        };
      });
    },
  );

  // ---------------------------------------------------------------------------
  // close_bead
  // ---------------------------------------------------------------------------
  server.tool(
    "close_bead",
    {
      id: z.string().describe("Bead ID to close"),
      reason: z.string().optional().describe("Close reason"),
      projectId: z.string().optional().describe("Project UUID for cross-project operations (defaults to session project)"),
    },
    async ({ id, reason, projectId }, extra) => {
      const bdOpts = resolveBdOptions(extra, projectId);
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["close", id, "--json"];
        if (reason) {
          args.push("--reason", reason);
        }

        const result = await execBd(args, bdOpts);
        if (!result.success) {
          logError("close_bead failed", { id, error: result.error });
          return errorResult(result);
        }

        // Emit timeline event for bead close
        const resolvedAgent = extra?.sessionId ? getAgentBySession(extra.sessionId) : undefined;
        const closeEventInput: Parameters<NonNullable<typeof eventStore>["insertEvent"]>[0] = {
          eventType: "bead_closed",
          agentId: resolvedAgent ?? "system",
          action: `Closed bead ${id}`,
          detail: { id, reason },
          beadId: id,
        };
        eventStore?.insertEvent(closeEventInput);

        // After closing a task/bug, auto-complete any eligible parent epics
        const autoCompleted = await autoCompleteEpics();

        const messages = [`Closed bead ${id}`];
        if (autoCompleted.length > 0) {
          messages.push(`Auto-completed epics: ${autoCompleted.join(", ")}`);
        }

        return {
          content: [{ type: "text" as const, text: messages.join("\n") }],
        };
      });
    },
  );

  // ---------------------------------------------------------------------------
  // list_beads
  // ---------------------------------------------------------------------------
  server.tool(
    "list_beads",
    {
      status: z.enum(["open", "in_progress", "closed", "all"]).optional().describe("Filter by status (default: open)"),
      assignee: z.string().optional().describe("Filter by assignee"),
      type: z.enum(["epic", "task", "bug"]).optional().describe("Filter by bead type"),
      projectId: z.string().optional().describe("Project UUID for cross-project operations (defaults to session project)"),
    },
    async ({ status, assignee, type, projectId }, extra) => {
      const bdOpts = resolveBdOptions(extra, projectId);
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["list", "--json"];

        if (status === "all") {
          args.push("--all");
        } else if (status) {
          args.push("--status", status);
        }
        if (assignee) args.push("--assignee", assignee);
        if (type) args.push("--type", type);

        const result = await execBd(args, bdOpts);
        if (!result.success) {
          logError("list_beads failed", { error: result.error });
          return errorResult(result);
        }

        const beads = result.data as Record<string, unknown>[] | undefined;
        if (!beads || beads.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No beads found." }],
          };
        }

        const lines = beads.map((b) =>
          `[${String(b['status'])}] ${String(b['id'])} (${String(b['issue_type'])}, P${String(b['priority'])}): ${String(b['title'])}`,
        );
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );

  // ---------------------------------------------------------------------------
  // show_bead
  // ---------------------------------------------------------------------------
  server.tool(
    "show_bead",
    {
      id: z.string().describe("Bead ID to show"),
      projectId: z.string().optional().describe("Project UUID for cross-project operations (defaults to session project)"),
    },
    async ({ id, projectId }, extra) => {
      const bdOpts = resolveBdOptions(extra, projectId);
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["show", id, "--json"];

        const result = await execBd(args, bdOpts);
        if (!result.success) {
          logError("show_bead failed", { id, error: result.error });
          return errorResult(result);
        }

        const bead = result.data as Record<string, unknown> | undefined;
        if (!bead) {
          return {
            content: [{ type: "text" as const, text: `Bead ${id} not found.` }],
            isError: true,
          };
        }

        const lines = [
          `ID: ${String(bead['id'])}`,
          `Title: ${String(bead['title'])}`,
          `Status: ${String(bead['status'])}`,
          `Type: ${String(bead['issue_type'])}`,
          `Priority: P${String(bead['priority'])}`,
        ];
        if (bead['assignee']) lines.push(`Assignee: ${String(bead['assignee'])}`);
        if (bead['description']) lines.push(`Description: ${String(bead['description'])}`);
        if (bead['created_at']) lines.push(`Created: ${String(bead['created_at'])}`);
        if (bead['updated_at']) lines.push(`Updated: ${String(bead['updated_at'])}`);

        const deps = bead['dependencies'] as Record<string, string>[] | undefined;
        if (deps && deps.length > 0) {
          lines.push(`Dependencies:`);
          for (const dep of deps) {
            lines.push(`  - ${dep['depends_on_id']} (${dep['type']})`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );
}
