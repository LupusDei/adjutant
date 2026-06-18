/**
 * Integration tests for the proposal publish/unpublish REST endpoints and the extended
 * GET payload (adj-200.2.6).
 *
 *  - POST /api/proposals/:id/publish    → 200, returns the full public URL, sets public
 *  - POST /api/proposals/:id/unpublish  → 200, revokes → public GET /p/:token 404s
 *  - GET  /api/proposals/:id            → payload includes html, isPublic, shareToken, publishedAt
 *
 * Mounts BOTH the authed proposals router and the public /p router so the end-to-end
 * revoke (publish → unpublish → 404) is proven across the trust boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";

import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createProposalStore, type ProposalStore } from "../../src/services/proposal-store.js";
import { createProposalsRouter } from "../../src/routes/proposals.js";
import { createPublicProposalsRouter } from "../../src/routes/public-proposals.js";

let app: Express;
let server: http.Server;
let db: Database.Database;
let store: ProposalStore;

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createProposalStore(db);

  app = express();
  app.use(express.json());
  app.use("/api/proposals", createProposalsRouter(store));
  app.use("/p", createPublicProposalsRouter(store));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  db.close();
});

function seed(): string {
  return store.insertProposal({
    author: "agent",
    title: "Routes Proposal",
    description: "A markdown summary.",
    type: "engineering",
    project: "adjutant",
  }).id;
}

describe("POST /api/proposals/:id/publish", () => {
  it("should publish the proposal and return the full public URL", async () => {
    const id = seed();

    const res = await supertest(app).post(`/api/proposals/${id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal.isPublic).toBe(true);
    expect(res.body.data.proposal.shareToken).toMatch(/^[0-9A-Za-z]{16,}$/);
    expect(res.body.data.publicUrl).toContain(`/p/${res.body.data.proposal.shareToken}`);
    expect(res.body.data.publicUrl).toMatch(/^https?:\/\//);
  });

  it("should make the published proposal reachable via the public route", async () => {
    const id = seed();
    const publish = await supertest(app).post(`/api/proposals/${id}/publish`);
    const token = publish.body.data.proposal.shareToken;

    const page = await supertest(app).get(`/p/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
  });

  it("should return 404 for an unknown proposal id", async () => {
    const res = await supertest(app).post(`/api/proposals/does-not-exist/publish`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("should build the public URL from X-Forwarded-Proto/Host behind a tunnel (adj-200.2.6.1)", async () => {
    const id = seed();

    const res = await supertest(app)
      .post(`/api/proposals/${id}/publish`)
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "happy-otter.ngrok.app");

    expect(res.status).toBe(200);
    const token = res.body.data.proposal.shareToken;
    // The link reflects the EXTERNAL tunnel origin, not the internal http://127.0.0.1.
    expect(res.body.data.publicUrl).toBe(`https://happy-otter.ngrok.app/p/${token}`);
  });
});

describe("POST /api/proposals/:id/unpublish", () => {
  it("should unpublish and revoke public access (next /p/:token is 404)", async () => {
    const id = seed();
    const publish = await supertest(app).post(`/api/proposals/${id}/publish`);
    const token = publish.body.data.proposal.shareToken;
    expect((await supertest(app).get(`/p/${token}`)).status).toBe(200);

    const res = await supertest(app).post(`/api/proposals/${id}/unpublish`);
    expect(res.status).toBe(200);
    expect(res.body.data.proposal.isPublic).toBe(false);

    const page = await supertest(app).get(`/p/${token}`);
    expect(page.status).toBe(404);
  });

  it("should return 404 for an unknown proposal id", async () => {
    const res = await supertest(app).post(`/api/proposals/nope/unpublish`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/proposals/:id payload (adj-200)", () => {
  it("should include html, isPublic, shareToken, and publishedAt", async () => {
    const id = seed();
    store.setHtml(id, "<h1>Body</h1>");
    await supertest(app).post(`/api/proposals/${id}/publish`);

    const res = await supertest(app).get(`/api/proposals/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.html).toBe("<h1>Body</h1>");
    expect(res.body.data.isPublic).toBe(true);
    expect(res.body.data.shareToken).toMatch(/^[0-9A-Za-z]{16,}$/);
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  it("should report isPublic false and no token for a private proposal", async () => {
    const id = seed();
    const res = await supertest(app).get(`/api/proposals/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isPublic).toBe(false);
    expect(res.body.data.shareToken ?? null).toBeNull();
  });
});
