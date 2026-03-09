/**
 * Agent Step Definitions — Given/When/Then steps for agent-related scenarios.
 *
 * Registers steps into the global step registry as a side effect on import.
 *
 * @module acceptance/steps/agent-steps
 */

import type { TestHarness } from "../test-harness.js";
import { defineGiven, defineThen } from "../step-registry.js";

// ============================================================================
// Given Steps
// ============================================================================

/**
 * Seed an agent connection.
 * Pattern: "an agent <name> is connected"
 */
defineGiven(/^an agent (\S+) is connected$/, async (harness, name) => {
  const h = harness as TestHarness;
  await h.seedAgent({ agentId: name, name });
});

/**
 * Seed an agent with a specific status.
 * Pattern: "an agent with status <status>"
 */
defineGiven(/^an agent with status (\S+)$/, async (harness, status) => {
  const h = harness as TestHarness;
  await h.seedAgent({ agentId: "test-agent", status });
});

// ============================================================================
// Then Steps
// ============================================================================

/**
 * Assert agent status matches expected value.
 * Pattern: "agent status is <status>"
 */
defineThen(/^agent status is (\S+)$/, async (harness, expected) => {
  const h = harness as TestHarness;
  // Safe cast: body shape is { data: { status: string } }
  const body = h.lastResponse?.body as { data?: { status?: string } } | undefined;
  const actual = body?.data?.status;
  if (actual !== expected) {
    throw new Error(`Expected agent status "${expected}", got "${actual}"`);
  }
});
