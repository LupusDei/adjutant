import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import type Database from "better-sqlite3";

import type { TraitValues } from "../../src/types/personas.js";
import { PERSONA_TRAIT_KEYS } from "../../src/types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;
let db: Database.Database;
let app: express.Express;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-personaroute-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

function zeroTraits(): TraitValues {
  const traits = {} as Record<string, number>;
  for (const key of PERSONA_TRAIT_KEYS) {
    traits[key] = 0;
  }
  return traits as TraitValues;
}

function makeTraits(overrides: Partial<Record<string, number>>): TraitValues {
  const traits = zeroTraits();
  for (const [key, value] of Object.entries(overrides)) {
    (traits as Record<string, number>)[key] = value!;
  }
  return traits;
}

// ============================================================================
// Test Suite
// ============================================================================

describe("personas-routes", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();

    const { createPersonaService } = await import("../../src/services/persona-service.js");
    const { createPersonasRouter } = await import("../../src/routes/personas.js");
    const service = createPersonaService(db);

    app = express();
    app.use(express.json());
    app.use("/api/personas", createPersonasRouter(service));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // POST /api/personas
  // ==========================================================================

  describe("POST /api/personas", () => {
    it("should create a persona and return 201", async () => {
      const traits = makeTraits({ architecture_focus: 18, technical_depth: 15 });
      const res = await request(app)
        .post("/api/personas")
        .send({ name: "Architect", description: "System designer", traits });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Architect");
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.traits.architecture_focus).toBe(18);
      expect(res.body.data.createdAt).toBeTruthy();
    });

    it("should create a persona with default empty description", async () => {
      const res = await request(app)
        .post("/api/personas")
        .send({ name: "Minimal", traits: zeroTraits() });

      expect(res.status).toBe(201);
      expect(res.body.data.description).toBe("");
    });

    it("should return 400 when traits exceed budget", async () => {
      const traits = makeTraits({
        architecture_focus: 20,
        technical_depth: 20,
        code_review: 20,
        modular_architecture: 20,
        testing_unit: 20,
        documentation: 1,
      });

      const res = await request(app)
        .post("/api/personas")
        .send({ name: "OverBudget", traits });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/point|budget/i);
    });

    it("should return 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/personas")
        .send({ traits: zeroTraits() });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when traits are missing", async () => {
      const res = await request(app)
        .post("/api/personas")
        .send({ name: "NoTraits" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when a trait is out of range", async () => {
      const traits = zeroTraits();
      (traits as Record<string, number>).architecture_focus = 25;

      const res = await request(app)
        .post("/api/personas")
        .send({ name: "OutOfRange", traits });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 409 for duplicate name", async () => {
      const traits = zeroTraits();
      await request(app)
        .post("/api/personas")
        .send({ name: "Sentinel", traits });

      const res = await request(app)
        .post("/api/personas")
        .send({ name: "sentinel", traits }); // same name, different case

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for missing trait keys", async () => {
      const res = await request(app)
        .post("/api/personas")
        .send({
          name: "Partial",
          traits: { architecture_focus: 10 }, // missing 11 keys
        });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // GET /api/personas
  // ==========================================================================

  describe("GET /api/personas", () => {
    it("should return empty array when no personas exist", async () => {
      const res = await request(app).get("/api/personas");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("should return all personas sorted by name", async () => {
      const traits = zeroTraits();
      await request(app).post("/api/personas").send({ name: "Charlie", traits });
      await request(app).post("/api/personas").send({ name: "Alpha", traits });
      await request(app).post("/api/personas").send({ name: "Bravo", traits });

      const res = await request(app).get("/api/personas");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.map((p: { name: string }) => p.name)).toEqual([
        "Alpha",
        "Bravo",
        "Charlie",
      ]);
    });
  });

  // ==========================================================================
  // GET /api/personas/:id
  // ==========================================================================

  describe("GET /api/personas/:id", () => {
    it("should return a persona by ID", async () => {
      const traits = makeTraits({ qa_correctness: 18 });
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "QA", description: "Quality focus", traits });

      const id = createRes.body.data.id;
      const res = await request(app).get(`/api/personas/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("QA");
      expect(res.body.data.traits.qa_correctness).toBe(18);
    });

    it("should return 404 for non-existent ID", async () => {
      const res = await request(app).get("/api/personas/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // GET /api/personas/:id/prompt
  // ==========================================================================

  describe("GET /api/personas/:id/prompt", () => {
    it("should return generated prompt for an existing persona", async () => {
      const traits = makeTraits({
        architecture_focus: 18,
        qa_correctness: 15,
        testing_unit: 12,
      });
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Architect", description: "System design specialist", traits });

      const id = createRes.body.data.id;
      const res = await request(app).get(`/api/personas/${id}/prompt`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.prompt).toBeTruthy();
      expect(typeof res.body.data.prompt).toBe("string");
      // Prompt should contain the persona name
      expect(res.body.data.prompt).toContain("Architect");
      // Response should include the persona object
      expect(res.body.data.persona).toBeTruthy();
      expect(res.body.data.persona.name).toBe("Architect");
      expect(res.body.data.persona.id).toBe(id);
    });

    it("should return 404 for non-existent persona", async () => {
      const res = await request(app).get("/api/personas/nonexistent/prompt");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return a prompt containing architecture instructions for high architecture trait", async () => {
      const traits = makeTraits({ architecture_focus: 20 });
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "PureArchitect", traits });

      const id = createRes.body.data.id;
      const res = await request(app).get(`/api/personas/${id}/prompt`);

      expect(res.body.data.prompt).toMatch(/architec/i);
      expect(res.body.data.prompt).toMatch(/design/i);
    });

    it("should return a minimal prompt for all-zero traits", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Blank", description: "No specialization", traits });

      const id = createRes.body.data.id;
      const res = await request(app).get(`/api/personas/${id}/prompt`);

      expect(res.status).toBe(200);
      expect(res.body.data.prompt).toContain("Blank");
      // Should have the generalist fallback
      expect(res.body.data.prompt).toMatch(/generalist/i);
    });

    it("should produce deterministic prompts across multiple requests", async () => {
      const traits = makeTraits({
        qa_correctness: 18,
        testing_unit: 15,
        architecture_focus: 10,
      });
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Consistent", traits });

      const id = createRes.body.data.id;
      const res1 = await request(app).get(`/api/personas/${id}/prompt`);
      const res2 = await request(app).get(`/api/personas/${id}/prompt`);

      expect(res1.body.data.prompt).toBe(res2.body.data.prompt);
    });
  });

  // ==========================================================================
  // PUT /api/personas/:id
  // ==========================================================================

  describe("PUT /api/personas/:id", () => {
    it("should update persona name", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Old", traits });

      const id = createRes.body.data.id;
      const res = await request(app)
        .put(`/api/personas/${id}`)
        .send({ name: "New" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("New");
    });

    it("should update persona traits", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Test", traits });

      const id = createRes.body.data.id;
      const newTraits = makeTraits({ product_design: 20 });
      const res = await request(app)
        .put(`/api/personas/${id}`)
        .send({ traits: newTraits });

      expect(res.status).toBe(200);
      expect(res.body.data.traits.product_design).toBe(20);
    });

    it("should return 400 for over-budget trait update", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Test", traits });

      const id = createRes.body.data.id;
      const overBudget = makeTraits({
        architecture_focus: 20,
        product_design: 20,
        uiux_focus: 20,
        qa_scalability: 20,
        qa_correctness: 20,
        testing_unit: 1,
      });

      const res = await request(app)
        .put(`/api/personas/${id}`)
        .send({ traits: overBudget });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 404 for non-existent ID", async () => {
      const res = await request(app)
        .put("/api/personas/nonexistent")
        .send({ name: "Ghost" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return 409 for duplicate name on update", async () => {
      const traits = zeroTraits();
      await request(app)
        .post("/api/personas")
        .send({ name: "Alpha", traits });
      const betaRes = await request(app)
        .post("/api/personas")
        .send({ name: "Beta", traits });

      const betaId = betaRes.body.data.id;
      const res = await request(app)
        .put(`/api/personas/${betaId}`)
        .send({ name: "Alpha" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for empty update body", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "Test", traits });

      const id = createRes.body.data.id;
      const res = await request(app)
        .put(`/api/personas/${id}`)
        .send({});

      // Empty update is technically valid (no-op), should return 200
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // DELETE /api/personas/:id
  // ==========================================================================

  describe("DELETE /api/personas/:id", () => {
    it("should delete an existing persona and return 200", async () => {
      const traits = zeroTraits();
      const createRes = await request(app)
        .post("/api/personas")
        .send({ name: "ToDelete", traits });

      const id = createRes.body.data.id;
      const res = await request(app).delete(`/api/personas/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app).get(`/api/personas/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent ID", async () => {
      const res = await request(app).delete("/api/personas/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
