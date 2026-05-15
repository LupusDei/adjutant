import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "node:crypto";

import { createWebhooksRouter } from "../../src/routes/webhooks.js";
import type { EventStore, InsertEventInput } from "../../src/services/event-store.js";
import type { TimelineEvent } from "../../src/types/events.js";

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const SECRET = "test-secret-do-not-use-in-prod";

function signBody(body: string | Buffer, secret: string = SECRET): string {
  return createHmac("sha1", secret).update(body).digest("hex");
}

/**
 * Shape mirrors the real Vercel webhook payload for `deployment.succeeded`
 * (captured from Vercel's public docs, not hand-crafted from a TS type).
 */
const realVercelSuccessPayload = {
  type: "deployment.succeeded",
  id: "evt_5f4WdJpEvFaXkF8x7g2bU9N4LdwL",
  createdAt: 1700000000000,
  payload: {
    deployment: {
      id: "dpl_8mDLP1aL3pTaqPpvUFhFf9YJ7Eod",
      url: "bloomfolio-abc123-myorg.vercel.app",
      name: "bloomfolio",
      target: "production",
      inspectorUrl: "https://vercel.com/myorg/bloomfolio/8mDLP1aL3pTaqPpvUFhFf9YJ7Eod",
      meta: {
        githubCommitSha: "0123456789abcdef0123456789abcdef01234567",
        githubCommitRef: "main",
        githubCommitOrg: "myorg",
        githubCommitRepo: "bloomfolio",
      },
    },
    project: {
      id: "prj_abcdefghijklmnopqrstuvwxyz",
      name: "bloomfolio",
    },
  },
};

/** Build a mock EventStore that records inserts. */
function createMockEventStore(): { store: EventStore; inserts: InsertEventInput[] } {
  const inserts: InsertEventInput[] = [];
  const store: EventStore = {
    insertEvent: vi.fn((input: InsertEventInput): TimelineEvent => {
      inserts.push(input);
      return {
        id: `evt-${inserts.length}`,
        eventType: input.eventType as TimelineEvent["eventType"],
        agentId: input.agentId,
        action: input.action,
        detail: input.detail ?? null,
        beadId: input.beadId ?? null,
        messageId: input.messageId ?? null,
        createdAt: "2026-05-15T00:00:00.000Z",
      };
    }),
    getEvents: vi.fn(() => []),
    pruneOldEvents: vi.fn(() => 0),
  };
  return { store, inserts };
}

function createTestApp(store: EventStore) {
  const app = express();
  app.use("/api/webhooks", createWebhooksRouter(store));
  return app;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("POST /api/webhooks/vercel", () => {
  const originalSecret = process.env["VERCEL_WEBHOOK_SECRET"];

  beforeEach(() => {
    process.env["VERCEL_WEBHOOK_SECRET"] = SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env["VERCEL_WEBHOOK_SECRET"];
    } else {
      process.env["VERCEL_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("accepts a valid deployment.succeeded event and records a timeline event", async () => {
    const { store, inserts } = createMockEventStore();
    const app = createTestApp(store);

    const body = JSON.stringify(realVercelSuccessPayload);
    const sig = signBody(body);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .set("x-vercel-signature", sig)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.eventId).toBe("evt-1");
    expect(response.body.data.status).toBe("succeeded");

    expect(inserts).toHaveLength(1);
    const stored = inserts[0]!;
    expect(stored.eventType).toBe("deploy_status");
    expect(stored.agentId).toBe("vercel");
    expect(stored.detail?.["projectName"]).toBe("bloomfolio");
    expect(stored.detail?.["environment"]).toBe("Production");
    expect(stored.detail?.["status"]).toBe("succeeded");
    expect(stored.detail?.["commitShaShort"]).toBe("0123456");
    expect(stored.detail?.["commitUrl"]).toBe(
      "https://github.com/myorg/bloomfolio/commit/0123456789abcdef0123456789abcdef01234567",
    );
    expect(stored.detail?.["deployUrl"]).toBe(
      "https://bloomfolio-abc123-myorg.vercel.app",
    );
    expect(stored.detail?.["vercelEventType"]).toBe("deployment.succeeded");
  });

  it("rejects an invalid signature with 401 and does not persist", async () => {
    const { store, inserts } = createMockEventStore();
    const app = createTestApp(store);

    const body = JSON.stringify(realVercelSuccessPayload);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .set("x-vercel-signature", signBody(body, "wrong-secret"))
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(inserts).toHaveLength(0);
  });

  it("rejects a missing signature header with 400", async () => {
    const { store } = createMockEventStore();
    const app = createTestApp(store);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .send(realVercelSuccessPayload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.message).toMatch(/signature/i);
  });

  it("returns 503 when VERCEL_WEBHOOK_SECRET is not configured", async () => {
    delete process.env["VERCEL_WEBHOOK_SECRET"];

    const { store } = createMockEventStore();
    const app = createTestApp(store);

    const body = JSON.stringify(realVercelSuccessPayload);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .set("x-vercel-signature", "deadbeef")
      .send(body);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("ignores unsupported event types with 200 (so Vercel does not retry)", async () => {
    const { store, inserts } = createMockEventStore();
    const app = createTestApp(store);

    const payload = { type: "project.created", payload: { project: { name: "x" } } };
    const body = JSON.stringify(payload);
    const sig = signBody(body);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .set("x-vercel-signature", sig)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.data.ignored).toBe(true);
    expect(response.body.data.type).toBe("project.created");
    expect(inserts).toHaveLength(0);
  });

  it("maps deployment.error to status=error", async () => {
    const { store, inserts } = createMockEventStore();
    const app = createTestApp(store);

    const payload = {
      ...realVercelSuccessPayload,
      type: "deployment.error",
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body);

    const response = await request(app)
      .post("/api/webhooks/vercel")
      .set("Content-Type", "application/json")
      .set("x-vercel-signature", sig)
      .send(body);

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.detail?.["status"]).toBe("error");
    expect(inserts[0]!.detail?.["vercelEventType"]).toBe("deployment.error");
  });
});
