/**
 * Route tests for `GET /api/overview/projects` (adj-208.1.3 / US1).
 *
 * The route is a thin adapter: it calls the injected coordination service,
 * validates the payload against the response schema, and wraps it in the
 * standard `ApiResponse` envelope. All business logic lives in the service, so
 * these tests mock the service and assert only envelope + status behavior.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { createOverviewRouter } from "../../src/routes/overview.js";
import type { CoordinationOverviewService } from "../../src/services/coordination-overview-service.js";
import type { OverviewProjectsResponse } from "../../src/types/overview-projects.js";
import type { MessageStore } from "../../src/services/message-store.js";

const mockStore = {
  getUnreadCounts: vi.fn().mockReturnValue([]),
  getUnreadSummaries: vi.fn().mockReturnValue([]),
} as unknown as MessageStore;

const SAMPLE: OverviewProjectsResponse = {
  projects: [
    {
      projectId: "alpha-id",
      name: "alpha",
      activeEpic: {
        id: "alpha-1",
        title: "Active epic",
        completionPercent: 67,
        closedChildren: 2,
        totalChildren: 3,
      },
      epicsRemaining: 1,
      openBeadsRemaining: 3,
      agents: [{ id: "A1", status: "working" }],
      status: "on_track",
    },
  ],
  totals: {
    projects: 1,
    agentsActive: 1,
    epicsRemaining: 1,
    openBeadsRemaining: 3,
    blocked: 0,
    needsInput: 0,
    portfolioCompletionPercent: 67,
  },
};

function appWith(service?: CoordinationOverviewService): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/overview", createOverviewRouter(mockStore, service));
  return app;
}

describe("GET /api/overview/projects", () => {
  it("should return the rollup wrapped in a success envelope", async () => {
    const service: CoordinationOverviewService = {
      getOverviewProjects: vi.fn(async () => SAMPLE),
    };

    const res = await request(appWith(service)).get("/api/overview/projects");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.timestamp).toBeTypeOf("string");
    expect(res.body.data).toEqual(SAMPLE);
    // Route delegates — service called exactly once, no arguments.
    expect(service.getOverviewProjects).toHaveBeenCalledTimes(1);
  });

  it("should return a 500 error envelope when the service throws", async () => {
    const service: CoordinationOverviewService = {
      getOverviewProjects: vi.fn(async () => {
        throw new Error("projects unavailable");
      }),
    };

    const res = await request(appWith(service)).get("/api/overview/projects");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("should 500 when the service returns a payload that fails schema validation", async () => {
    // A malformed payload (missing totals) must never leak out unvalidated.
    const service = {
      getOverviewProjects: vi.fn(async () => ({ projects: [] })),
    } as unknown as CoordinationOverviewService;

    const res = await request(appWith(service)).get("/api/overview/projects");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("should 503 when no coordination service is wired", async () => {
    const res = await request(appWith(undefined)).get("/api/overview/projects");

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
