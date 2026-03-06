import { describe, it, expect, beforeEach } from "vitest";

import {
  detectApiCall,
  detectAssertions,
  detectPrecondition,
  classifyScenario,
} from "../../src/acceptance/pattern-detector.js";
import { clearSteps, defineWhen } from "../../src/acceptance/step-registry.js";
import type { Scenario } from "../../src/acceptance/types.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal Scenario for classification tests. */
function makeScenario(
  overrides: Partial<Scenario> & { given: string; when: string; then: string },
): Scenario {
  return {
    index: 1,
    raw: `**Given** ${overrides.given}, **When** ${overrides.when}, **Then** ${overrides.then}`,
    ...overrides,
  };
}

// ============================================================================
// Tests — detectApiCall (When-clause)
// ============================================================================

describe("detectApiCall", () => {
  it("should detect POST /api/proposals", () => {
    const result = detectApiCall(
      "a proposal is created via POST /api/proposals",
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe("POST");
    expect(result!.path).toBe("/api/proposals");
    expect(result!.query).toBeUndefined();
    expect(result!.body).toBeUndefined();
  });

  it("should detect GET /api/proposals with ?status=pending query param", () => {
    const result = detectApiCall(
      "GET /api/proposals is called with `?status=pending`",
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe("GET");
    expect(result!.path).toBe("/api/proposals");
    expect(result!.query).toEqual({ status: "pending" });
  });

  it("should detect GET with ?status=pending without backticks", () => {
    const result = detectApiCall(
      "GET /api/proposals is called with ?status=pending",
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe("GET");
    expect(result!.path).toBe("/api/proposals");
    expect(result!.query).toEqual({ status: "pending" });
  });

  it("should detect PATCH /api/proposals/:id with body", () => {
    const result = detectApiCall(
      'PATCH /api/proposals/:id with `{ "status": "accepted" }`',
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe("PATCH");
    expect(result!.path).toBe("/api/proposals/:id");
    expect(result!.body).toEqual({ status: "accepted" });
  });

  it("should detect PATCH with escaped quotes in body", () => {
    const result = detectApiCall(
      'PATCH /api/proposals/:id with `{ "status": "accepted" }`',
    );
    expect(result).not.toBeNull();
    expect(result!.body).toEqual({ status: "accepted" });
  });

  it("should detect PUT /api/proposals/:id", () => {
    const result = detectApiCall("PUT /api/proposals/:id with new data");
    expect(result).not.toBeNull();
    expect(result!.method).toBe("PUT");
    expect(result!.path).toBe("/api/proposals/:id");
  });

  it("should detect DELETE /api/proposals/:id", () => {
    const result = detectApiCall("DELETE /api/proposals/:id is called");
    expect(result).not.toBeNull();
    expect(result!.method).toBe("DELETE");
    expect(result!.path).toBe("/api/proposals/:id");
  });

  it("should return null for UI interactions", () => {
    const result = detectApiCall("the user clicks Accept");
    expect(result).toBeNull();
  });

  it("should return null for agent behavior", () => {
    const result = detectApiCall("it generates a proposal");
    expect(result).toBeNull();
  });

  it("should detect method at start of text", () => {
    const result = detectApiCall("POST /api/messages sends a new message");
    expect(result).not.toBeNull();
    expect(result!.method).toBe("POST");
    expect(result!.path).toBe("/api/messages");
  });

  it("should handle multiple query parameters", () => {
    const result = detectApiCall(
      "GET /api/proposals is called with `?status=pending&type=engineering`",
    );
    expect(result).not.toBeNull();
    expect(result!.query).toEqual({ status: "pending", type: "engineering" });
  });
});

// ============================================================================
// Tests — detectAssertions (Then-clause)
// ============================================================================

describe("detectAssertions", () => {
  it("should detect status field assertion", () => {
    const result = detectAssertions(
      'it is persisted with status "pending" and a generated UUID',
    );
    expect(result.length).toBeGreaterThanOrEqual(1);

    const statusAssertion = result.find((a) => a.path === "data.status");
    expect(statusAssertion).toBeDefined();
    expect(statusAssertion!.value).toBe("pending");
    expect(statusAssertion!.matcher).toBe("toBe");
  });

  it("should detect UUID/id existence check", () => {
    const result = detectAssertions(
      'it is persisted with status "pending" and a generated UUID',
    );

    const idAssertion = result.find((a) => a.path === "data.id");
    expect(idAssertion).toBeDefined();
    expect(idAssertion!.matcher).toBe("toBeTruthy");
  });

  it("should detect response status code", () => {
    const result = detectAssertions("the response status is 200");

    expect(result.length).toBeGreaterThanOrEqual(1);
    const statusAssertion = result.find((a) => a.path === "status");
    expect(statusAssertion).toBeDefined();
    expect(statusAssertion!.value).toBe(200);
    expect(statusAssertion!.matcher).toBe("toBe");
  });

  it("should detect response status code 404", () => {
    const result = detectAssertions("the response status is 404");

    const statusAssertion = result.find((a) => a.path === "status");
    expect(statusAssertion).toBeDefined();
    expect(statusAssertion!.value).toBe(404);
  });

  it("should detect data existence for filter assertions", () => {
    const result = detectAssertions(
      "only pending proposals are returned sorted by newest first",
    );
    expect(result.length).toBeGreaterThanOrEqual(1);

    const dataAssertion = result.find((a) => a.path === "data");
    expect(dataAssertion).toBeDefined();
    expect(dataAssertion!.matcher).toBe("toBeTruthy");
  });

  it("should return empty array for unrecognized text", () => {
    const result = detectAssertions("something entirely unknown happens");
    expect(result).toEqual([]);
  });
});

// ============================================================================
// Tests — detectPrecondition (Given-clause)
// ============================================================================

describe("detectPrecondition", () => {
  it("should detect 'the database is initialized' as database type", () => {
    const result = detectPrecondition("the database is initialized");
    expect(result.type).toBe("database");
  });

  it("should detect 'proposals exist' as proposal type", () => {
    const result = detectPrecondition("proposals exist");
    expect(result.type).toBe("proposal");
  });

  it("should detect 'a pending proposal' as proposal with status param", () => {
    const result = detectPrecondition("a pending proposal");
    expect(result.type).toBe("proposal");
    expect(result.params).toEqual({ status: "pending" });
  });

  it("should detect 'an agent connected via MCP' as agent type", () => {
    const result = detectPrecondition("an agent connected via MCP");
    expect(result.type).toBe("agent");
  });

  it("should detect UI navigation as none type", () => {
    const result = detectPrecondition(
      "the user navigates to the Proposals tab",
    );
    expect(result.type).toBe("none");
  });

  it("should detect message-related preconditions as message type", () => {
    const result = detectPrecondition("messages exist in the database");
    expect(result.type).toBe("message");
  });

  it("should default to none for unrecognized preconditions", () => {
    const result = detectPrecondition("some random state");
    expect(result.type).toBe("none");
  });
});

// ============================================================================
// Tests — classifyScenario
// ============================================================================

describe("classifyScenario", () => {
  beforeEach(() => {
    // Clear step registry to ensure classification tests are deterministic
    clearSteps();
  });

  it("should classify API scenario as api-testable", () => {
    const scenario = makeScenario({
      given: "the database is initialized",
      when: "a proposal is created via POST /api/proposals",
      then: 'it is persisted with status "pending"',
    });
    expect(classifyScenario(scenario)).toBe("api-testable");
  });

  it("should classify UI interaction as ui-only", () => {
    const scenario = makeScenario({
      given: "the user navigates to the Proposals tab",
      when: "the user clicks Accept on a proposal",
      then: "the proposal card shows accepted status",
    });
    expect(classifyScenario(scenario)).toBe("ui-only");
  });

  it("should classify agent behavior as agent-behavior", () => {
    const scenario = makeScenario({
      given: "an agent connected via MCP",
      when: "it calls create_proposal with title, description, and type",
      then: "the proposal is created with the agent's resolved identity as author",
    });
    expect(classifyScenario(scenario)).toBe("agent-behavior");
  });

  it("should classify scenario with step-registry matches as step-matched", () => {
    // Register a step that matches the When clause
    defineWhen(
      /^a custom step that matches$/,
      async () => { /* no-op */ },
    );

    const scenario = makeScenario({
      given: "some unknown precondition with no API",
      when: "a custom step that matches",
      then: "some unknown result with no API",
    });
    // Step registry match should take priority
    expect(classifyScenario(scenario)).toBe("step-matched");
  });

  it("should default to unknown for unrecognized scenarios", () => {
    const scenario = makeScenario({
      given: "some random precondition",
      when: "something non-standard happens",
      then: "an outcome occurs",
    });
    expect(classifyScenario(scenario)).toBe("unknown");
  });

  it("should detect 'navigates' as UI keyword", () => {
    const scenario = makeScenario({
      given: "the user is on the dashboard",
      when: "the user navigates to settings",
      then: "settings page is displayed",
    });
    expect(classifyScenario(scenario)).toBe("ui-only");
  });

  it("should detect 'sees' as UI keyword", () => {
    const scenario = makeScenario({
      given: "proposals exist",
      when: "the user views the proposals page",
      then: "they see proposal cards sorted by date",
    });
    expect(classifyScenario(scenario)).toBe("ui-only");
  });

  it("should detect 'spawns' as agent keyword", () => {
    const scenario = makeScenario({
      given: "an agent has no remaining tasks",
      when: "the agent enters proposal mode",
      then: "it spawns teammates to evaluate proposals",
    });
    expect(classifyScenario(scenario)).toBe("agent-behavior");
  });

  it("should prefer step-matched over api-testable", () => {
    // When a scenario has both API patterns AND step-registry matches,
    // step-matched takes priority
    defineWhen(
      /^a proposal is created via POST \/api\/proposals$/,
      async () => { /* no-op */ },
    );

    const scenario = makeScenario({
      given: "the database is initialized",
      when: "a proposal is created via POST /api/proposals",
      then: 'it is persisted with status "pending"',
    });
    expect(classifyScenario(scenario)).toBe("step-matched");
  });

  it("should prefer api-testable over ui-only", () => {
    // A scenario that has an API call in When but UI-ish text in Given
    const scenario = makeScenario({
      given: "the user navigates to the proposals page",
      when: "POST /api/proposals is called",
      then: "the response status is 201",
    });
    expect(classifyScenario(scenario)).toBe("api-testable");
  });
});
