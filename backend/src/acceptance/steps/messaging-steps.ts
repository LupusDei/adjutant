/**
 * Messaging Step Definitions — Given/When/Then steps for message-related scenarios.
 *
 * Registers steps into the global step registry as a side effect on import.
 *
 * @module acceptance/steps/messaging-steps
 */

import type { TestHarness } from "../test-harness.js";
import { defineGiven, defineWhen, defineThen } from "../step-registry.js";

// ============================================================================
// Given Steps
// ============================================================================

/**
 * Seed a message from a specific agent.
 * Pattern: "a message exists from <agent>"
 */
defineGiven(/^a message exists from (.+)$/, async (harness, agentId) => {
  const h = harness as TestHarness;
  await h.seedMessage({
    agentId,
    role: "agent",
    body: `Seeded message from ${agentId}`,
  });
});

/**
 * Seed N messages into a specific thread.
 * Pattern: "<N> messages exist in thread <threadId>"
 */
defineGiven(/^(\d+) messages exist in thread (.+)$/, async (harness, count, threadId) => {
  const h = harness as TestHarness;
  const n = parseInt(count, 10);
  for (let i = 0; i < n; i++) {
    await h.seedMessage({
      agentId: "test-agent",
      role: "agent",
      body: `Thread message ${i + 1}`,
      threadId,
    });
  }
});

// ============================================================================
// When Steps
// ============================================================================

/**
 * Send a message via POST /api/messages.
 */
defineWhen(/^a message is sent via POST \/api\/messages$/, async (harness) => {
  const h = harness as TestHarness;
  const res = await h.post("/api/messages", {
    agentId: "test-agent",
    role: "user",
    body: "Test message",
  });
  h.lastResponse = res;
});

/**
 * GET /api/messages.
 */
defineWhen(/^GET \/api\/messages is called$/, async (harness) => {
  const h = harness as TestHarness;
  const res = await h.get("/api/messages");
  h.lastResponse = res;
});

// ============================================================================
// Then Steps
// ============================================================================

/**
 * Assert the message is persisted (response has data with an id).
 */
defineThen(/^the message is persisted$/, async (harness) => {
  const h = harness as TestHarness;
  // Safe cast: body shape is { data: { id: string, ... } } from messages API
  const body = h.lastResponse?.body as { data?: { id?: string } } | undefined;
  if (!body?.data?.id) {
    throw new Error("Expected message to be persisted with an id, but no data.id found in response");
  }
});

/**
 * Assert unread count matches expected value.
 * Pattern: "unread count is <N>"
 */
defineThen(/^unread count is (\d+)$/, async (harness, expected) => {
  const h = harness as TestHarness;
  // Safe cast: body shape is { data: { unreadCount: number } }
  const body = h.lastResponse?.body as { data?: { unreadCount?: number } } | undefined;
  const actual = body?.data?.unreadCount;
  const expectedNum = parseInt(expected, 10);
  if (actual !== expectedNum) {
    throw new Error(`Expected unread count ${expectedNum}, got ${actual}`);
  }
});
