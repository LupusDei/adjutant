import { describe, it, expect, afterEach } from "vitest";

import type { TestHarness } from "../../src/acceptance/test-harness.js";

// We'll create fresh harnesses per test using dynamic import
// to match the existing test pattern and avoid module state leaks.

async function createHarness(): Promise<TestHarness> {
  const { TestHarness: HarnessClass } = await import("../../src/acceptance/test-harness.js");
  return new HarnessClass();
}

describe("TestHarness", () => {
  const harnesses: TestHarness[] = [];

  // Clean up all harnesses after each test
  afterEach(async () => {
    for (const h of harnesses) {
      await h.destroy();
    }
    harnesses.length = 0;
  });

  function track(h: TestHarness): TestHarness {
    harnesses.push(h);
    return h;
  }

  // ── adj-035.3.1 — Lifecycle ──────────────────────────────────────────

  describe("setup and lifecycle", () => {
    it("should create a working Express app with database", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      // Database should be accessible
      expect(harness.database).toBeDefined();

      // Request agent should be accessible
      expect(harness.request).toBeDefined();
    });

    it("should mount routes that respond to HTTP requests", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      // GET /api/messages should return 200 (proves routes are mounted)
      const res = await harness.request.get("/api/messages");
      expect(res.status).toBe(200);
    });

    it("should clean up temp dir and close database on destroy", async () => {
      const harness = await createHarness();
      await harness.setup();

      const db = harness.database;
      await harness.destroy();

      // Database should be closed (executing a query should throw)
      expect(() => db.prepare("SELECT 1").get()).toThrow();
    });

    it("should support multiple isolated instances with different databases", async () => {
      const h1 = track(await createHarness());
      const h2 = track(await createHarness());
      await h1.setup();
      await h2.setup();

      // Databases should be different objects
      expect(h1.database).not.toBe(h2.database);

      // Insert into h1 — should not appear in h2
      await h1.seedMessage({
        agentId: "test-agent",
        role: "agent",
        body: "hello from h1",
      });

      const res1 = await h1.request.get("/api/messages");
      const res2 = await h2.request.get("/api/messages");

      expect(res1.body.data.items.length).toBe(1);
      expect(res2.body.data.items.length).toBe(0);
    });
  });

  // ── adj-035.3.2 — API Client Wrapper ─────────────────────────────────

  describe("typed convenience methods", () => {
    it("should support post() with typed response", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      const result = await harness.post<{ success: boolean; data: { id: string } }>(
        "/api/proposals",
        {
          author: "test-agent",
          title: "Test Proposal",
          description: "A test proposal",
          type: "engineering",
          project: "adjutant",
        },
      );

      expect(result.status).toBe(201);
      expect(result.body.success).toBe(true);
      expect(result.body.data.id).toBeTruthy();
    });

    it("should support get() with typed response", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      const result = await harness.get<{ success: boolean; data: { counts: unknown[] } }>(
        "/api/messages/unread",
      );

      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
    });

    it("should support get() with query parameters", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      // Create a proposal first
      await harness.post("/api/proposals", {
        author: "test-agent",
        title: "Test",
        description: "Desc",
        type: "product",
        project: "adjutant",
      });

      const result = await harness.get<{ success: boolean; data: unknown[] }>(
        "/api/proposals",
        { type: "product" },
      );

      expect(result.status).toBe(200);
      expect(result.body.data).toHaveLength(1);
    });

    it("should support patch() with typed response", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      // Create proposal, then patch it
      const createRes = await harness.post<{ success: boolean; data: { id: string } }>(
        "/api/proposals",
        {
          author: "test-agent",
          title: "To Patch",
          description: "Will be patched",
          type: "engineering",
          project: "adjutant",
        },
      );

      const patchRes = await harness.patch<{ success: boolean; data: { status: string } }>(
        `/api/proposals/${createRes.body.data.id}`,
        { status: "accepted" },
      );

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.status).toBe("accepted");
    });
  });

  // ── adj-035.3.3 — Seed Helpers ───────────────────────────────────────

  describe("seed helpers", () => {
    it("should seed a message retrievable via API", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      const msg = await harness.seedMessage({
        agentId: "agent-x",
        role: "agent",
        body: "Hello from seed",
      });

      expect(msg.id).toBeTruthy();
      expect(msg.body).toBe("Hello from seed");
      expect(msg.agentId).toBe("agent-x");

      // Verify via API
      const res = await harness.get<{ success: boolean; data: { items: Array<{ id: string; body: string }> } }>(
        "/api/messages",
        { agentId: "agent-x" },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]!.body).toBe("Hello from seed");
    });

    it("should seed a message with optional threadId", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      const msg = await harness.seedMessage({
        agentId: "agent-y",
        role: "user",
        body: "Threaded message",
        threadId: "thread-1",
      });

      expect(msg.threadId).toBe("thread-1");
    });

    it("should seed a proposal retrievable via API", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      const proposal = await harness.seedProposal({
        author: "test-author",
        title: "Seed Proposal",
        description: "Created via seedProposal",
        type: "product",
        project: "adjutant",
      });

      expect(proposal.id).toBeTruthy();
      expect(proposal.title).toBe("Seed Proposal");

      // Verify via API
      const res = await harness.get<{ success: boolean; data: { id: string; title: string } }>(
        `/api/proposals/${proposal.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Seed Proposal");
    });

    it("should seed an agent", async () => {
      const harness = track(await createHarness());
      await harness.setup();

      // seedAgent should not throw
      await harness.seedAgent({ agentId: "seeded-agent", name: "Test Agent" });

      // The agent should now have a record in the messages table
      // (we insert a system message as a registration marker)
      const res = await harness.get<{ success: boolean; data: { items: Array<{ agentId: string }> } }>(
        "/api/messages",
        { agentId: "seeded-agent" },
      );
      expect(res.status).toBe(200);
    });
  });
});
