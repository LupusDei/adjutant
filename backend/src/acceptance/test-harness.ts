/**
 * TestHarness — Reusable acceptance test fixture that spins up a real
 * Express server with a fresh SQLite database for API-level testing.
 *
 * Encapsulates the setup/teardown patterns used across the project's
 * existing test suites into a single class.
 *
 * Usage:
 *   const harness = new TestHarness();
 *   await harness.setup();
 *   const res = await harness.request.get("/api/messages");
 *   await harness.destroy();
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import supertest from "supertest";
import type Database from "better-sqlite3";

import type { HarnessConfig } from "./types.js";
import type { MessageStore, Message } from "../services/message-store.js";
import type { ProposalStore } from "../services/proposal-store.js";
import type { EventStore } from "../services/event-store.js";
import type { Proposal, ProposalType } from "../types/proposals.js";
import type { PersonaService } from "../services/persona-service.js";
import type { Persona } from "../types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a uniquely named temp directory for test isolation. */
function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================================
// TestHarness
// ============================================================================

export class TestHarness {
  private app: express.Express | null = null;
  private db: Database.Database | null = null;
  private testDir: string | null = null;
  private _request: supertest.Agent | null = null;
  private destroyed = false;

  // Exposed stores for seed helpers
  private _messageStore: MessageStore | null = null;
  private _proposalStore: ProposalStore | null = null;
  private _eventStore: EventStore | null = null;
  private _personaService: PersonaService | null = null;

  /** Stores the last API response for step definition assertions */
  public lastResponse: { status: number; body: unknown } | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Set up the full Express app with all injectable routes and a fresh
   * SQLite database. Does NOT call app.listen() — supertest works
   * directly with the Express app instance.
   *
   * Throws if the harness has already been destroyed.
   */
  async setup(config?: HarnessConfig): Promise<void> {
    if (this.destroyed) {
      throw new Error(
        "TestHarness has been destroyed and cannot be set up again. Create a new instance instead.",
      );
    }
    // 1. Create temp directory
    this.testDir = config?.dbPath ? null : freshTestDir();
    const dbPath = config?.dbPath ?? join(this.testDir!, "test.db");

    // 2. Create database + run migrations (dynamic import for clean module state)
    const { createDatabase, runMigrations } = await import("../services/database.js");
    this.db = createDatabase(dbPath);
    runMigrations(this.db);

    // 3. Create stores from the fresh database
    const { createMessageStore } = await import("../services/message-store.js");
    const { createProposalStore } = await import("../services/proposal-store.js");
    const { createEventStore } = await import("../services/event-store.js");

    const { createPersonaService } = await import("../services/persona-service.js");

    this._messageStore = createMessageStore(this.db);
    this._proposalStore = createProposalStore(this.db);
    this._eventStore = createEventStore(this.db);
    this._personaService = createPersonaService(this.db);

    // 4. Create Express app with standard middleware (no auth for tests)
    this.app = express();
    this.app.use(express.json());

    // 5. Mount production routes that accept injected dependencies
    const { createMessagesRouter } = await import("../routes/messages.js");
    const { createProposalsRouter } = await import("../routes/proposals.js");
    const { createEventsRouter } = await import("../routes/events.js");
    const { createOverviewRouter } = await import("../routes/overview.js");
    const { createProjectsRouter } = await import("../routes/projects.js");
    const { createPersonasRouter } = await import("../routes/personas.js");

    this.app.use("/api/messages", createMessagesRouter(this._messageStore));
    this.app.use("/api/proposals", createProposalsRouter(this._proposalStore));
    this.app.use("/api/events", createEventsRouter(this._eventStore));
    this.app.use("/api/overview", createOverviewRouter(this._messageStore));
    this.app.use("/api/projects", createProjectsRouter(this._messageStore));
    this.app.use("/api/personas", createPersonasRouter(this._personaService));

    // Health check for smoke tests
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    // 6. Create supertest agent
    this._request = supertest.agent(this.app);
  }

  /**
   * Clean up: close the database and remove the temp directory.
   *
   * Idempotent — safe to call multiple times. After the first call,
   * subsequent calls are no-ops. Also safe after partial setup (e.g.
   * if setup() threw midway through, destroy() cleans up whatever was
   * created).
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Already closed — safe to ignore
      }
      this.db = null;
    }

    if (this.testDir) {
      rmSync(this.testDir, { recursive: true, force: true });
      this.testDir = null;
    }

    this.app = null;
    this._request = null;
    this._messageStore = null;
    this._proposalStore = null;
    this._eventStore = null;
    this._personaService = null;
    this.destroyed = true;
  }

  // ── Accessors ──────────────────────────────────────────────────────

  /** Get the temp directory path for cleanup verification in tests. */
  get testDirPath(): string | null {
    return this.testDir;
  }

  /** Get the supertest request agent for making HTTP calls. */
  get request(): supertest.Agent {
    if (!this._request) {
      throw new Error("TestHarness.request accessed before setup()");
    }
    return this._request;
  }

  /** Get the raw database for advanced assertions. */
  get database(): Database.Database {
    if (!this.db) {
      throw new Error("TestHarness.database accessed before setup()");
    }
    return this.db;
  }

  // ── Typed API Client Wrapper (adj-035.3.2) ─────────────────────────

  /** POST JSON to a path and return the parsed response. */
  async post<T = Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const res = await this.request.post(path).send(body);
    return { status: res.status, body: res.body as T };
  }

  /** GET a path and return the parsed response. */
  async get<T = Record<string, unknown>>(
    path: string,
    query?: Record<string, string>,
  ): Promise<{ status: number; body: T }> {
    let req = this.request.get(path);
    if (query) {
      req = req.query(query);
    }
    const res = await req;
    return { status: res.status, body: res.body as T };
  }

  /** PATCH a path and return the parsed response. */
  async patch<T = Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const res = await this.request.patch(path).send(body);
    return { status: res.status, body: res.body as T };
  }

  /** PUT JSON to a path and return the parsed response. */
  async put<T = Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const res = await this.request.put(path).send(body);
    return { status: res.status, body: res.body as T };
  }

  /** DELETE a path and return the parsed response. */
  async delete<T = Record<string, unknown>>(
    path: string,
  ): Promise<{ status: number; body: T }> {
    const res = await this.request.delete(path);
    return { status: res.status, body: res.body as T };
  }

  // ── Precondition Seed Helpers (adj-035.3.3) ────────────────────────

  /**
   * Insert a message into the store via the real service layer.
   */
  async seedMessage(opts: {
    agentId: string;
    role: "user" | "agent" | "system" | "announcement";
    body: string;
    threadId?: string;
  }): Promise<Message> {
    if (!this._messageStore) {
      throw new Error("TestHarness.seedMessage() called before setup()");
    }
    const input: Parameters<MessageStore["insertMessage"]>[0] = {
      agentId: opts.agentId,
      role: opts.role,
      body: opts.body,
    };
    if (opts.threadId !== undefined) {
      input.threadId = opts.threadId;
    }
    return this._messageStore.insertMessage(input);
  }

  /**
   * Register a mock agent by inserting a system message as a
   * registration marker. This makes the agent visible in the
   * message store's agent-related queries.
   */
  async seedAgent(opts: { agentId: string; name?: string; status?: string }): Promise<void> {
    if (!this._messageStore) {
      throw new Error("TestHarness.seedAgent() called before setup()");
    }
    const statusSuffix = opts.status ? ` [status: ${opts.status}]` : "";
    this._messageStore.insertMessage({
      agentId: opts.agentId,
      role: "system",
      body: `Agent registered: ${opts.name ?? opts.agentId}${statusSuffix}`,
    });
  }

  /**
   * Seed a bead by inserting a system message marker.
   * Beads are managed via the `bd` CLI in production, so in tests
   * we simulate their existence with a marker message.
   */
  async seedBead(opts: {
    title: string;
    type?: string;
    status?: string;
  }): Promise<{ id: string; title: string }> {
    if (!this._messageStore) {
      throw new Error("TestHarness.seedBead() called before setup()");
    }
    const beadId = `bead-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this._messageStore.insertMessage({
      agentId: "system",
      role: "system",
      body: `Bead created: ${opts.title} [id: ${beadId}, type: ${opts.type ?? "task"}, status: ${opts.status ?? "open"}]`,
    });
    return { id: beadId, title: opts.title };
  }

  /**
   * Create a proposal via the real proposal store.
   */
  async seedProposal(opts: {
    author: string;
    title: string;
    description: string;
    type: string;
    project: string;
  }): Promise<Proposal> {
    if (!this._proposalStore) {
      throw new Error("TestHarness.seedProposal() called before setup()");
    }
    return this._proposalStore.insertProposal({
      author: opts.author,
      title: opts.title,
      description: opts.description,
      type: opts.type as ProposalType,
      project: opts.project,
    });
  }

  /**
   * Create a persona via the real persona service.
   */
  async seedPersona(opts: {
    name: string;
    description?: string;
  }): Promise<Persona> {
    if (!this._personaService) {
      throw new Error("TestHarness.seedPersona() called before setup()");
    }
    const { PersonaTrait } = await import("../types/personas.js");
    // Minimal valid trait values (all zeros, sums to 0 which is <= 100)
    const traits = Object.values(PersonaTrait).reduce<Record<string, number>>(
      (acc, key) => {
        acc[key as keyof typeof PersonaTrait] = 0;
        return acc;
      },
      {},
    );
    return this._personaService.createPersona({
      name: opts.name,
      description: opts.description ?? "Seeded for testing",
      traits: traits as unknown as import("../types/personas.js").TraitValues,
    });
  }
}
