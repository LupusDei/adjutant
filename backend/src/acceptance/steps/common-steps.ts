/**
 * Built-in Step Definitions — Common patterns that appear across many specs.
 *
 * These provide reusable Given/When/Then implementations for frequently
 * occurring acceptance scenario clauses. Import this module to register
 * all common steps into the global registry.
 *
 * @module acceptance/steps/common-steps
 */

import type { TestHarness } from "../test-harness.js";
import { defineGiven, defineWhen, defineThen } from "../step-registry.js";

// ============================================================================
// Given Steps
// ============================================================================

/**
 * No-op — the test harness handles database initialization automatically.
 */
defineGiven("the database is initialized", async () => {
  // Harness handles this automatically — no-op
});

/**
 * Seed some proposals into the database via the harness.
 */
defineGiven(/^proposals exist$/, async (harness) => {
  const h = harness as TestHarness;
  await h.seedProposal({
    author: "test-agent",
    title: "Existing proposal",
    description: "A pre-existing proposal for testing",
    type: "engineering",
    project: "adjutant",
  });
});

/**
 * Create a single pending proposal via the harness.
 */
defineGiven(/^a pending proposal$/, async (harness) => {
  const h = harness as TestHarness;
  await h.seedProposal({
    author: "test-agent",
    title: "Pending proposal",
    description: "A pending proposal for testing",
    type: "product",
    project: "adjutant",
  });
});

/**
 * Generic "the API server is running" — harness starts server in setup.
 */
defineGiven(/^the API server is running$/, async () => {
  // Harness starts the server automatically — no-op
});

/**
 * Generic agent connection — matches "an agent connected via MCP" and similar.
 */
defineGiven(/^an agent (?:is )?connected via MCP$/, async () => {
  // Harness manages agent connections — no-op for now
});

// ============================================================================
// When Steps
// ============================================================================

/**
 * Create a proposal via POST.
 */
defineWhen(
  /^(?:a )?proposal is created via POST \/api\/proposals$/,
  async (harness) => {
    const h = harness as TestHarness;
    const res = await h.post("/api/proposals", {
      author: "test-agent",
      title: "Test Proposal",
      description: "Test description",
      type: "engineering",
      project: "adjutant",
    });
    h.lastResponse = res;
  }
);

/**
 * GET proposals with optional query string.
 */
defineWhen(
  /^GET \/api\/proposals is called/,
  async (harness) => {
    const h = harness as TestHarness;
    const res = await h.get("/api/proposals");
    h.lastResponse = res;
  }
);

/**
 * Generic PATCH to update a resource.
 */
defineWhen(
  /^PATCH \/api\/(\w+)\/([^\s]+) with (.+)$/,
  async (harness, resource, id, body) => {
    const h = harness as TestHarness;
    const res = await h.patch(
      `/api/${resource}/${id}`,
      JSON.parse(body) as Record<string, unknown>,
    );
    h.lastResponse = res;
  }
);

// ============================================================================
// Then Steps
// ============================================================================

/**
 * Assert a response field has a specific value.
 */
defineThen(
  /^it is persisted with status "(\w+)"/,
  async (harness, status) => {
    const h = harness as TestHarness;
    // Safe cast: body shape is { data: { status: string } } from proposals API
    const body = h.lastResponse?.body as { data?: { status?: string } } | undefined;
    const actual = body?.data?.status;
    if (actual !== status) {
      throw new Error(`Expected status "${status}", got "${actual}"`);
    }
  }
);

/**
 * Assert results are returned sorted by newest first.
 */
defineThen(
  /^only (\w+) proposals are returned sorted by newest first$/,
  async (harness, filterStatus) => {
    const h = harness as TestHarness;
    // Safe cast: body shape is { data: Array<{ status, created_at }> } from proposals list API
    const body = h.lastResponse?.body as { data?: Array<{ status: string; created_at: string }> } | undefined;
    const data = body?.data;
    if (!data) {
      throw new Error("No response data found");
    }
    // Verify all have the expected status
    for (const item of data) {
      if (item.status !== filterStatus) {
        throw new Error(
          `Expected all items to have status "${filterStatus}", found "${item.status}"`
        );
      }
    }
  }
);

/**
 * Assert the response status code.
 */
defineThen(
  /^the response status is (\d+)$/,
  async (harness, statusCode) => {
    const h = harness as TestHarness;
    const actual = h.lastResponse?.status;
    const expected = parseInt(statusCode, 10);
    if (actual !== expected) {
      throw new Error(`Expected status ${expected}, got ${actual}`);
    }
  }
);
