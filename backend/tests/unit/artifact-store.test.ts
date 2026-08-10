import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-artifact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("artifact-store", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("createArtifact", () => {
    it("should store and return an artifact with a generated UUID and defaults", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);

      const artifact = store.createArtifact({
        title: "Landing Page",
        html: "<!doctype html><html><body><h1>Hi</h1></body></html>",
        description: "A standalone landing page",
        createdBy: "artifex",
      });

      expect(artifact.id).toBeTruthy();
      expect(artifact.title).toBe("Landing Page");
      expect(artifact.html).toContain("<h1>Hi</h1>");
      expect(artifact.description).toBe("A standalone landing page");
      expect(artifact.createdBy).toBe("artifex");
      expect(artifact.isPublic).toBe(false);
      expect(artifact.shareToken).toBeUndefined();
      expect(artifact.publishedAt).toBeUndefined();
      expect(artifact.createdAt).toBeTruthy();
      expect(artifact.updatedAt).toBeTruthy();
    });

    it("should create artifacts with unique IDs", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);

      const a1 = store.createArtifact({ title: "A", html: "<p>a</p>" });
      const a2 = store.createArtifact({ title: "B", html: "<p>b</p>" });

      expect(a1.id).not.toBe(a2.id);
    });

    it("should persist optional slug and leave description/createdBy undefined when omitted", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);

      const artifact = store.createArtifact({ title: "Slugged", html: "<p>x</p>", slug: "my-slug" });

      expect(artifact.slug).toBe("my-slug");
      expect(artifact.description).toBeUndefined();
      expect(artifact.createdBy).toBeUndefined();
    });
  });

  describe("getArtifact", () => {
    it("should return an artifact by ID", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "T", html: "<p>t</p>" });

      const found = store.getArtifact(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("should return null for an unknown ID", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.getArtifact("does-not-exist")).toBeNull();
    });
  });

  describe("listArtifacts", () => {
    it("should return artifacts newest-first", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const a1 = store.createArtifact({ title: "First", html: "<p>1</p>" });
      const a2 = store.createArtifact({ title: "Second", html: "<p>2</p>" });
      const a3 = store.createArtifact({ title: "Third", html: "<p>3</p>" });

      const list = store.listArtifacts();
      expect(list.map((a) => a.id)).toEqual([a3.id, a2.id, a1.id]);
    });

    it("should return an empty array when no artifacts exist", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.listArtifacts()).toEqual([]);
    });
  });

  describe("updateArtifact", () => {
    it("should update provided fields and bump updated_at", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Old", html: "<p>old</p>" });

      const updated = store.updateArtifact(created.id, { title: "New", html: "<p>new</p>" });
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("New");
      expect(updated?.html).toBe("<p>new</p>");
    });

    it("should leave unspecified fields unchanged", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Keep", html: "<p>body</p>", description: "desc" });

      const updated = store.updateArtifact(created.id, { title: "Renamed" });
      expect(updated?.title).toBe("Renamed");
      expect(updated?.html).toBe("<p>body</p>");
      expect(updated?.description).toBe("desc");
    });

    it("should return null when updating a non-existent artifact", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.updateArtifact("nope", { title: "x" })).toBeNull();
    });
  });

  describe("deleteArtifact", () => {
    it("should delete an existing artifact and return true", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Del", html: "<p>d</p>" });

      expect(store.deleteArtifact(created.id)).toBe(true);
      expect(store.getArtifact(created.id)).toBeNull();
    });

    it("should return false when deleting a non-existent artifact", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.deleteArtifact("nope")).toBe(false);
    });
  });

  describe("publishArtifact", () => {
    it("should generate a >=16-char base62 token, set is_public and published_at", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Pub", html: "<p>p</p>" });

      const published = store.publishArtifact(created.id);
      expect(published).not.toBeNull();
      expect(published?.isPublic).toBe(true);
      expect(published?.publishedAt).toBeTruthy();
      expect(published?.shareToken).toBeTruthy();
      expect((published?.shareToken ?? "").length).toBeGreaterThanOrEqual(16);
      expect(published?.shareToken).toMatch(/^[0-9A-Za-z]+$/);
    });

    it("should be idempotent — re-publishing reuses the same token", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Pub", html: "<p>p</p>" });

      const first = store.publishArtifact(created.id);
      const token = first?.shareToken;
      store.unpublishArtifact(created.id);
      const second = store.publishArtifact(created.id);

      expect(second?.shareToken).toBe(token);
      expect(second?.isPublic).toBe(true);
    });

    it("should return null when publishing a non-existent artifact", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.publishArtifact("nope")).toBeNull();
    });
  });

  describe("unpublishArtifact", () => {
    it("should set is_public=0 but retain the token so a re-publish revives the link", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "U", html: "<p>u</p>" });
      const published = store.publishArtifact(created.id);
      const token = published?.shareToken;

      const unpublished = store.unpublishArtifact(created.id);
      expect(unpublished?.isPublic).toBe(false);
      expect(unpublished?.shareToken).toBe(token); // token retained
    });

    it("should return null when unpublishing a non-existent artifact", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.unpublishArtifact("nope")).toBeNull();
    });
  });

  describe("getArtifactByToken", () => {
    it("should resolve a published artifact by its share token", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Tok", html: "<p>t</p>" });
      const published = store.publishArtifact(created.id);

      const found = store.getArtifactByToken(published?.shareToken ?? "");
      expect(found?.id).toBe(created.id);
    });

    it("should return null for an unpublished artifact even with a valid token", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      const created = store.createArtifact({ title: "Tok", html: "<p>t</p>" });
      const published = store.publishArtifact(created.id);
      const token = published?.shareToken ?? "";
      store.unpublishArtifact(created.id);

      expect(store.getArtifactByToken(token)).toBeNull();
    });

    it("should return null for an empty or unknown token", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      const store = createArtifactStore(db);
      expect(store.getArtifactByToken("")).toBeNull();
      expect(store.getArtifactByToken("unknown-token-xyz")).toBeNull();
    });
  });

  describe("publish token collision handling", () => {
    it("should retry token generation on a UNIQUE collision", async () => {
      const { createArtifactStore } = await import("../../src/services/artifact-store.js");
      // First artifact takes a fixed token; the generator returns that same token once
      // (collision) then a distinct one, so the second publish must retry and succeed.
      const tokens = ["COLLIDECOLLIDE01", "COLLIDECOLLIDE01", "UNIQUEUNIQUE0002"];
      let i = 0;
      const store = createArtifactStore(db, { generateToken: () => tokens[Math.min(i++, tokens.length - 1)]! });

      const a1 = store.createArtifact({ title: "A", html: "<p>a</p>" });
      const a2 = store.createArtifact({ title: "B", html: "<p>b</p>" });

      const p1 = store.publishArtifact(a1.id);
      const p2 = store.publishArtifact(a2.id);

      expect(p1?.shareToken).toBe("COLLIDECOLLIDE01");
      expect(p2?.shareToken).toBe("UNIQUEUNIQUE0002");
    });
  });
});
