/**
 * Bead Step Definitions — Given/When/Then steps for bead-related scenarios.
 *
 * Registers steps into the global step registry as a side effect on import.
 *
 * @module acceptance/steps/bead-steps
 */

import type { TestHarness } from "../test-harness.js";
import { defineGiven, defineWhen, defineThen } from "../step-registry.js";

// ============================================================================
// Given Steps
// ============================================================================

/**
 * Seed a bead with a specific title.
 * Pattern: "a bead exists with title <title>"
 */
defineGiven(/^a bead exists with title (.+)$/, async (harness, title) => {
  const h = harness as TestHarness;
  await h.seedBead({ title, type: "task" });
});

// ============================================================================
// When Steps
// ============================================================================

/**
 * Create a bead via POST /api/beads.
 */
defineWhen(/^a bead is created via POST \/api\/beads$/, async (harness) => {
  const h = harness as TestHarness;
  const res = await h.post("/api/beads", {
    title: "Test Bead",
    type: "task",
  });
  h.lastResponse = res;
});

// ============================================================================
// Then Steps
// ============================================================================

/**
 * Assert the bead status matches expected value.
 * Pattern: "the bead status is <status>"
 */
// eslint-disable-next-line @typescript-eslint/require-await
defineThen(/^the bead status is (\S+)$/, async (harness, expected) => {
  const h = harness as TestHarness;
  // Safe cast: body shape is { data: { status: string } }
  const body = h.lastResponse?.body as { data?: { status?: string } } | undefined;
  const actual = body?.data?.status;
  if (actual !== expected) {
    throw new Error(`Expected bead status "${expected}", got "${actual}"`);
  }
});
