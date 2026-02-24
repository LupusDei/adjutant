/**
 * MCP tools for bead (issue tracker) operations.
 *
 * Provides create, update, close, list, and show tools that wrap
 * the bd-client service. All calls are serialized through a mutex
 * to prevent concurrent bd access (SQLite SIGSEGV).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execBd, type BdResult, type BeadsIssue } from "../bd-client.js";
import { logError, logInfo } from "../../utils/index.js";

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
 * Checks if a bead is an epic by looking up its type via bd show.
 * Must be called inside bdMutex to avoid concurrent bd access.
 */
async function isBeadEpic(id: string): Promise<boolean> {
  const result = await execBd<BeadsIssue[]>(["show", id, "--json"]);
  if (!result.success || !result.data || result.data.length === 0) return false;
  return result.data[0]?.issue_type === "epic";
}

/**
 * Runs `bd epic close-eligible` to auto-close epics whose children are all done.
 * Returns list of auto-closed epic IDs.
 */
async function autoCompleteEpics(): Promise<string[]> {
  const result = await execBd<Array<{ id: string; title?: string }>>(
    ["epic", "close-eligible", "--json"]
  );
  if (!result.success || !result.data) return [];

  const closedIds: string[] = [];
  for (const epic of result.data) {
    const epicId = typeof epic === "string" ? epic : epic.id;
    if (epicId) {
      closedIds.push(epicId);
      logInfo("epic auto-completed via MCP", { epicId });
    }
  }
  return closedIds;
}

// =============================================================================
// Tool registration
// =============================================================================

export function registerBeadTools(server: McpServer): void {
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
    },
    async ({ id, title, description, type, priority }) => {
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

        const result = await execBd(args);
        if (!result.success) {
          logError("create_bead failed", { error: result.error });
          return errorResult(result);
        }

        const data = result.data as Record<string, unknown> | undefined;
        const createdId = data?.['id'] ?? "unknown";
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
    },
    async ({ id, status, title, description, assignee, priority }) => {
      return bdMutex.runExclusive(async () => {
        // Guard: epics cannot be set to "closed" directly — they auto-complete
        if (status === "closed" && await isBeadEpic(id)) {
          return {
            content: [{
              type: "text" as const,
              text: `Error: Epics cannot be closed directly. Epic ${id} will auto-complete when all its sub-beads are closed.`,
            }],
            isError: true,
          };
        }

        const args: string[] = ["update", id, "--json"];

        if (status) args.push(`--status=${status}`);
        if (title) args.push("--title", title);
        if (description) args.push("--description", description);
        if (assignee) args.push("--assignee", assignee);
        if (priority !== undefined && priority !== null) args.push("--priority", String(priority));

        const result = await execBd(args);
        if (!result.success) {
          logError("update_bead failed", { id, error: result.error });
          return errorResult(result);
        }

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
    },
    async ({ id, reason }) => {
      return bdMutex.runExclusive(async () => {
        // Guard: epics cannot be closed directly — they auto-complete
        if (await isBeadEpic(id)) {
          return {
            content: [{
              type: "text" as const,
              text: `Error: Epics cannot be closed directly. Epic ${id} will auto-complete when all its sub-beads are closed.`,
            }],
            isError: true,
          };
        }

        const args: string[] = ["close", id, "--json"];
        if (reason) {
          args.push("--reason", reason);
        }

        const result = await execBd(args);
        if (!result.success) {
          logError("close_bead failed", { id, error: result.error });
          return errorResult(result);
        }

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
    },
    async ({ status, assignee, type }) => {
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["list", "--json"];

        if (status === "all") {
          args.push("--all");
        } else if (status) {
          args.push("--status", status);
        }
        if (assignee) args.push("--assignee", assignee);
        if (type) args.push("--type", type);

        const result = await execBd(args);
        if (!result.success) {
          logError("list_beads failed", { error: result.error });
          return errorResult(result);
        }

        const beads = result.data as Array<Record<string, unknown>> | undefined;
        if (!beads || beads.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No beads found." }],
          };
        }

        const lines = beads.map((b) =>
          `[${b['status']}] ${b['id']} (${b['issue_type']}, P${b['priority']}): ${b['title']}`,
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
    },
    async ({ id }) => {
      return bdMutex.runExclusive(async () => {
        const args: string[] = ["show", id, "--json"];

        const result = await execBd(args);
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
          `ID: ${bead['id']}`,
          `Title: ${bead['title']}`,
          `Status: ${bead['status']}`,
          `Type: ${bead['issue_type']}`,
          `Priority: P${bead['priority']}`,
        ];
        if (bead['assignee']) lines.push(`Assignee: ${bead['assignee']}`);
        if (bead['description']) lines.push(`Description: ${bead['description']}`);
        if (bead['created_at']) lines.push(`Created: ${bead['created_at']}`);
        if (bead['updated_at']) lines.push(`Updated: ${bead['updated_at']}`);

        const deps = bead['dependencies'] as Array<Record<string, string>> | undefined;
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
