/**
 * MCP Memory Tools for Adjutant.
 *
 * Registers query_memories and get_session_retros tools on the MCP server
 * for querying the Adjutant's persistent memory system.
 *
 * Bead: adj-053.4.2
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore, LearningQuery } from "../adjutant/memory-store.js";

/**
 * Register all memory MCP tools on the given server.
 */
export function registerMemoryTools(server: McpServer, memoryStore: MemoryStore): void {
  // ========================================================================
  // query_memories
  // ========================================================================
  server.tool(
    "query_memories",
    "Query the Adjutant memory for learnings by category, topic, or text search",
    {
      query: z.string().optional().describe("Full-text search query"),
      category: z
        .enum(["operational", "technical", "coordination", "project"])
        .optional()
        .describe("Filter by learning category"),
      topic: z.string().optional().describe("Topic filter"),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence threshold"),
      limit: z.number().optional().describe("Max results to return (default 10)"),
    },
    async ({ query, category, topic, minConfidence, limit }) => {
      const effectiveLimit = limit ?? 10;

      let learnings;

      if (query) {
        // Full-text search takes priority when a query string is provided
        learnings = memoryStore.searchLearnings(query, effectiveLimit);
      } else {
        // Structured query by category, topic, confidence
        // Build query object without undefined values to satisfy exactOptionalPropertyTypes
        const q: LearningQuery = { limit: effectiveLimit };
        if (category !== undefined) q.category = category;
        if (topic !== undefined) q.topic = topic;
        if (minConfidence !== undefined) q.minConfidence = minConfidence;
        learnings = memoryStore.queryLearnings(q);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ learnings }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // get_session_retros
  // ========================================================================
  server.tool(
    "get_session_retros",
    "Get recent session retrospectives",
    {
      limit: z.number().optional().describe("Max retrospectives to return (default 5)"),
    },
    async ({ limit }) => {
      const effectiveLimit = limit ?? 5;
      const retrospectives = memoryStore.getRecentRetrospectives(effectiveLimit);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ retrospectives }),
          },
        ],
      };
    },
  );
}
