/**
 * Integration tests for the unauthenticated public proposal route (adj-200.2.5).
 *
 * GET /p/:token serves the composed, sanitized, self-contained HTML document to
 * anyone with the link — no API key. Proves the route → store → compose wiring plus
 * the security contract:
 *  - published proposal  → 200 text/html + strict CSP, zero external resource refs
 *  - unknown / unpublished / private proposal → 404 (no leak, indistinguishable)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";

import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createProposalStore, type ProposalStore } from "../../src/services/proposal-store.js";
import { createPublicProposalsRouter } from "../../src/routes/public-proposals.js";

let app: Express;
let server: http.Server;
let db: Database.Database;
let store: ProposalStore;

/** Resource references that force an external fetch (NOT navigational <a> links). */
function hasExternalResourceRef(html: string): boolean {
  return (
    /<script\b/i.test(html) ||
    /<link\b/i.test(html) ||
    /\bsrc\s*=\s*['"]?(?:https?:)?\/\//i.test(html) ||
    /url\(\s*['"]?(?:https?:)?\/\//i.test(html) ||
    /@import/i.test(html)
  );
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createProposalStore(db);

  app = express();
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

function seedPublished(html?: string): string {
  const p = store.insertProposal({
    author: "agent",
    title: "Shared Proposal",
    description: "A markdown summary that always exists.",
    type: "engineering",
    project: "adjutant",
  });
  if (html !== undefined) store.setHtml(p.id, html);
  return store.publishProposal(p.id)!.shareToken!;
}

describe("GET /p/:token", () => {
  it("should serve a published proposal as 200 text/html with no auth", async () => {
    const token = seedPublished(`<section><h2>Plan</h2><p>details</p></section>`);

    const res = await supertest(app).get(`/p/${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toMatch(/^<!DOCTYPE html>/i);
    expect(res.text).toContain("<h2>Plan</h2>");
  });

  it("should set strict CSP headers (inline style + data: images, no script/external)", async () => {
    const token = seedPublished();

    const res = await supertest(app).get(`/p/${token}`);
    const csp = res.headers["content-security-policy"];

    expect(csp).toBeTruthy();
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/img-src[^;]*data:/);
    // No script execution and no external connect permitted.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("connect-src https:");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should serve a document with zero external resource references", async () => {
    const token = seedPublished(
      `<img src="https://evil.example.com/x.png">` +
        `<div style="background:url(https://evil.example.com/bg.png)">x</div>` +
        `<p>body</p>`,
    );

    const res = await supertest(app).get(`/p/${token}`);

    expect(res.status).toBe(200);
    expect(hasExternalResourceRef(res.text)).toBe(false);
    expect(res.text).not.toContain("evil.example.com");
  });

  it("should return 404 for an unknown token", async () => {
    const res = await supertest(app).get(`/p/this-token-does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("should return 404 for a proposal that was unpublished (revoked link)", async () => {
    const token = seedPublished();
    // revoke
    const p = store.getProposalByToken(token)!;
    store.unpublishProposal(p.id);

    const res = await supertest(app).get(`/p/${token}`);
    expect(res.status).toBe(404);
  });

  it("should return 404 for a private (never-published) proposal", async () => {
    const p = store.insertProposal({
      author: "agent",
      title: "Private",
      description: "Never published.",
      type: "product",
      project: "adjutant",
    });
    // It has no token; even guessing an id-as-token must 404.
    const res = await supertest(app).get(`/p/${p.id}`);
    expect(res.status).toBe(404);
  });

  it("should not echo internal identifiers in the 404 body (no leak)", async () => {
    const res = await supertest(app).get(`/p/abc123unknowntoken`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("abc123unknowntoken");
  });
});
