/**
 * End-to-end verification for the proposal sharing flow (adj-200.7.2).
 *
 * Exercises the FULL assembled stack — the authenticated proposals router
 * (/api/proposals) and the unauthenticated public router (/p) sharing one store —
 * through the real lifecycle the feature promises:
 *
 *   create → set html → publish → GET /p/:token (no auth) → unpublish → 404
 *
 * Plus an mXSS regression at the served-document layer: a proposal whose html
 * carries an `<svg><style><img onerror>` mutation-XSS vector must serve a document
 * that re-parses (parse5 — the browser-equivalent parser) to ZERO live event-handler
 * nodes. This is the boundary every downstream surface (iOS loadHTMLString, embeds)
 * trusts, so it is verified here against the integrated code, not just the unit.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";
import { parseFragment } from "parse5";

import { runMigrations } from "../../src/services/database.js";
import { createProposalStore, type ProposalStore } from "../../src/services/proposal-store.js";
import { createProposalsRouter } from "../../src/routes/proposals.js";
import { createPublicProposalsRouter } from "../../src/routes/public-proposals.js";

let app: Express;
let db: Database.Database;
let store: ProposalStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createProposalStore(db);

  app = express();
  app.use(express.json());
  app.use("/api/proposals", createProposalsRouter(store));
  app.use("/p", createPublicProposalsRouter(store));
});

afterEach(() => {
  db.close();
});

/** Recursively collect every attribute name across a parse5 fragment tree. */
function collectAttrNames(node: unknown, acc: string[] = []): string[] {
  const n = node as { attrs?: { name: string }[]; childNodes?: unknown[] };
  if (Array.isArray(n.attrs)) {
    for (const a of n.attrs) acc.push(a.name.toLowerCase());
  }
  if (Array.isArray(n.childNodes)) {
    for (const child of n.childNodes) collectAttrNames(child, acc);
  }
  return acc;
}

/** Create a proposal via REST, then attach html via the store (the authoring path). */
function createWithHtml(html: string): string {
  const res = { id: "" };
  const created = store.insertProposal({
    author: "fenix",
    title: "E2E Shared Proposal",
    description: "Markdown summary that always exists.",
    type: "engineering",
    project: "adjutant",
  });
  store.setHtml(created.id, html);
  res.id = created.id;
  return res.id;
}

describe("Proposal sharing — end to end (adj-200.7.2)", () => {
  it("creates via REST, publishes, serves publicly with no auth, then revokes on unpublish", async () => {
    // create via the REST route (no html field on create — html is set via the authoring path)
    const createRes = await supertest(app)
      .post("/api/proposals")
      .send({
        author: "fenix",
        title: "Sharable",
        description: "summary",
        type: "engineering",
        project: "adjutant",
      });
    expect(createRes.status).toBe(201);
    const id: string = createRes.body.data.id;

    // attach a rich, self-contained html body (the authoring path)
    store.setHtml(id, '<section><h1>Vision</h1><p>Clean shareable page.</p></section>');

    // publish → returns a public URL with the share token
    const pubRes = await supertest(app).post(`/api/proposals/${id}/publish`);
    expect(pubRes.status).toBe(200);
    const publicUrl: string = pubRes.body.data.publicUrl;
    const proposal = pubRes.body.data.proposal;
    expect(proposal.isPublic).toBe(true);
    expect(proposal.shareToken).toBeTruthy();
    expect(publicUrl).toContain(`/p/${proposal.shareToken}`);

    // UNAUTHENTICATED fetch of the public page → 200 + composed document
    const token: string = proposal.shareToken;
    const pageRes = await supertest(app).get(`/p/${token}`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers["content-type"]).toMatch(/text\/html/);
    expect(pageRes.text).toContain("Clean shareable page.");
    // self-contained defense-in-depth: CSP meta present, no external resource refs
    expect(pageRes.text).toMatch(/http-equiv=["']?Content-Security-Policy/i);
    expect(pageRes.text).not.toMatch(/\bsrc\s*=\s*['"]?(?:https?:)?\/\//i);
    expect(pageRes.text).not.toMatch(/<script\b/i);

    // unpublish → the share link is revoked
    const unpubRes = await supertest(app).post(`/api/proposals/${id}/unpublish`);
    expect(unpubRes.status).toBe(200);

    const goneRes = await supertest(app).get(`/p/${token}`);
    expect(goneRes.status).toBe(404);
  });

  it("never serves a live event handler from an mXSS payload (parse5 re-parse)", async () => {
    const id = createWithHtml('<svg><style><img src=1 href=1 onerror=alert(1) //></style></svg><p>body</p>');
    const token = store.publishProposal(id)!.shareToken!;

    const pageRes = await supertest(app).get(`/p/${token}`);
    expect(pageRes.status).toBe(200);

    // Re-parse the SERVED document the way a real browser would, and prove no
    // on*-handler attribute survives anywhere in the tree.
    const tree = parseFragment(pageRes.text);
    const attrs = collectAttrNames(tree);
    expect(attrs.some((name) => name.startsWith("on"))).toBe(false);
  });

  it("404s for unknown tokens without leaking existence", async () => {
    const res = await supertest(app).get("/p/this-token-was-never-issued");
    expect(res.status).toBe(404);
  });
});
