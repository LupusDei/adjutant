/**
 * MCP Memory Tools for Adjutant.
 *
 * Registers memory read and write tools on the MCP server
 * for the Adjutant's persistent memory system.
 *
 * Beads: adj-053.4.2, adj-053.6.1, adj-053.6.2, adj-053.6.3
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore, LearningQuery, Learning } from "../adjutant/memory-store.js";

const CATEGORY_ENUM = z.enum(["operational", "technical", "coordination", "project"]);

/** Optional dependency injection for resolving agent identity from session. */
export interface MemoryToolDeps {
  getAgentBySession?: (sessionId: string) => string | undefined;
}

/**
 * Register all memory MCP tools on the given server.
 */
export function registerMemoryTools(
  server: McpServer,
  memoryStore: MemoryStore,
  deps: MemoryToolDeps = {},
): void {
  // ========================================================================
  // query_memories
  // ========================================================================
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "query_memories",
    "Query the Adjutant memory for learnings by category, topic, or text search",
    {
      query: z.string().optional().describe("Full-text search query"),
      category: CATEGORY_ENUM
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
    // eslint-disable-next-line @typescript-eslint/require-await
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
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "get_session_retros",
    "Get recent session retrospectives",
    {
      limit: z.number().optional().describe("Max retrospectives to return (default 5)"),
    },
    // eslint-disable-next-line @typescript-eslint/require-await
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

  // ========================================================================
  // store_memory (adj-053.6.1)
  // ========================================================================
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "store_memory",
    "Store a new learning in the Adjutant memory system",
    {
      content: z.string().describe("The learning content to store"),
      category: CATEGORY_ENUM.describe("Learning category"),
      topic: z.string().describe("Topic for this learning"),
      source: z.string().optional().describe("Source attribution (defaults to calling agent name)"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence level 0-1 (default 0.5)"),
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ content, category, topic, source, confidence }, extra) => {
      // Resolve the calling agent's name from the session
      const sessionId = extra.sessionId;
      let agentName = "unknown";
      if (sessionId && deps.getAgentBySession) {
        agentName = deps.getAgentBySession(sessionId) ?? "unknown";
      }

      const learning = memoryStore.insertLearning({
        content,
        category,
        topic,
        sourceType: "agent",
        sourceRef: source ?? agentName,
        confidence: confidence ?? 0.5,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ learning }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // update_memory (adj-053.6.2)
  // ========================================================================
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "update_memory",
    "Update an existing learning's content, confidence, category, or topic",
    {
      id: z.number().describe("Learning ID to update"),
      content: z.string().optional().describe("New content"),
      confidence: z.number().min(0).max(1).optional().describe("New confidence level"),
      category: CATEGORY_ENUM.optional().describe("New category"),
      topic: z.string().optional().describe("New topic"),
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ id, content, confidence, category, topic }) => {
      // Build updates object with only provided fields
      const updates: Partial<Pick<Learning, "content" | "confidence" | "category" | "topic">> = {};
      if (content !== undefined) updates.content = content;
      if (confidence !== undefined) updates.confidence = confidence;
      if (category !== undefined) updates.category = category;
      if (topic !== undefined) updates.topic = topic;

      memoryStore.updateLearning(id, updates);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, id }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // reinforce_memory (adj-053.6.2)
  // ========================================================================
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "reinforce_memory",
    "Reinforce a learning — increases its confidence and reinforcement count",
    {
      id: z.number().describe("Learning ID to reinforce"),
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ id }) => {
      memoryStore.reinforceLearning(id);
      const learning = memoryStore.getLearning(id);

      if (!learning) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Learning ${id} not found` }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, learning }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // record_correction (adj-053.6.3)
  // ========================================================================
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  server.tool(
    "record_correction",
    "Record a correction — tracks wrong patterns and the right approach. Auto-deduplicates by reinforcing existing corrections.",
    {
      correctionType: z.string().describe("Type of correction (e.g. wrong_assumption, wrong_approach, wrong_pattern)"),
      wrongPattern: z.string().describe("The wrong pattern or assumption"),
      rightPattern: z.string().describe("The correct pattern or approach"),
      context: z.string().optional().describe("Additional context about when this correction was discovered"),
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ correctionType, wrongPattern, rightPattern, context }) => {
      // Check for existing similar correction
      const existing = memoryStore.findSimilarCorrection(correctionType, wrongPattern);

      if (existing) {
        // Reinforce the existing correction
        memoryStore.incrementRecurrence(existing.id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                correction: existing,
                isNew: false,
                reinforced: true,
              }),
            },
          ],
        };
      }

      // Create a new correction
      const description = context
        ? `${rightPattern}. Context: ${context}`
        : rightPattern;

      const correction = memoryStore.insertCorrection({
        correctionType,
        pattern: wrongPattern,
        description,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              correction,
              isNew: true,
            }),
          },
        ],
      };
    },
  );
}
