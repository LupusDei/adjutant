/**
 * Integration test harness that spins up a real Express server
 * with a test SQLite database for cross-service testing.
 *
 * Creates an in-memory database, runs all migrations, and assembles
 * the Express app with the same route structure as the production server.
 * External dependencies (tmux, MCP transport, session-bridge) are excluded.
 */

import http from "node:http";
import { AddressInfo } from "node:net";

import cors from "cors";
import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { createMessageStore, type MessageStore } from "../../../src/services/message-store.js";
import { createProposalStore } from "../../../src/services/proposal-store.js";
import { createEventStore, type EventStore } from "../../../src/services/event-store.js";
import { runMigrations } from "../../../src/services/database.js";
import { createMessagesRouter } from "../../../src/routes/messages.js";
import { createEventsRouter } from "../../../src/routes/events.js";
import { createProposalsRouter } from "../../../src/routes/proposals.js";

export class TestHarness {
  app: Express;
  server: http.Server | null = null;
  port = 0;
  baseUrl = "";
  db: Database.Database;
  messageStore: MessageStore;
  eventStore: EventStore;

  constructor() {
    // Create in-memory SQLite database
    this.db = new Database(":memory:");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Run all migrations to create schema
    runMigrations(this.db);

    // Create stores backed by the test database
    this.messageStore = createMessageStore(this.db);
    this.eventStore = createEventStore(this.db);
    const proposalStore = createProposalStore(this.db);

    // Assemble Express app
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    // No API key auth middleware in tests — open mode

    // Mount routes
    this.app.use("/api/messages", createMessagesRouter(this.messageStore));
    this.app.use("/api/events", createEventsRouter(this.eventStore));
    this.app.use("/api/proposals", createProposalsRouter(proposalStore));

    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, () => {
        const addr = this.server!.address() as AddressInfo; // safe: server is listening
        this.port = addr.port;
        this.baseUrl = `http://localhost:${this.port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          this.db.close();
          if (err) reject(err);
          else resolve();
        });
      } else {
        this.db.close();
        resolve();
      }
    });
  }

  /**
   * Get a supertest agent bound to the Express app.
   * This avoids needing to start the server for simple HTTP tests.
   */
  request(): supertest.Agent {
    return supertest.agent(this.app);
  }

  /** Send a message via the REST API */
  async sendMessage(to: string, body: string, threadId?: string): Promise<supertest.Response> {
    const payload: Record<string, string> = { to, body };
    if (threadId) payload["threadId"] = threadId;
    return this.request().post("/api/messages").send(payload);
  }

  /** Get messages with optional query params */
  async getMessages(params?: Record<string, string>): Promise<supertest.Response> {
    let url = "/api/messages";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    return this.request().get(url);
  }

  /** Get unread counts */
  async getUnreadCounts(): Promise<supertest.Response> {
    return this.request().get("/api/messages/unread");
  }

  /** Get a single message by ID */
  async getMessage(id: string): Promise<supertest.Response> {
    return this.request().get(`/api/messages/${id}`);
  }

  /** Mark a message as read */
  async markRead(id: string): Promise<supertest.Response> {
    return this.request().patch(`/api/messages/${id}/read`);
  }

  /** Mark all messages from an agent as read */
  async markAllRead(agentId: string): Promise<supertest.Response> {
    return this.request().patch(`/api/messages/read-all?agentId=${agentId}`);
  }

  /** Get threads */
  async getThreads(agentId?: string): Promise<supertest.Response> {
    const url = agentId ? `/api/messages/threads?agentId=${agentId}` : "/api/messages/threads";
    return this.request().get(url);
  }

  /** Insert a message directly via the store (bypassing REST API) */
  insertMessageDirect(opts: {
    agentId: string;
    role: "user" | "agent" | "system" | "announcement";
    body: string;
    recipient?: string;
    threadId?: string;
  }) {
    return this.messageStore.insertMessage(opts);
  }
}
