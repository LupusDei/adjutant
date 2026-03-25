/**
 * Integration tests for MCP tool handlers with real services.
 *
 * These tests exercise the real service layer (MessageStore, EventStore)
 * that MCP tools depend on, verifying cross-service interactions without
 * mocking. We test the services directly rather than going through MCP
 * transport, since the MCP transport layer requires session management
 * that is tested separately.
 *
 * What this catches: data round-trip bugs between message store writes
 * and reads, event store side effects, FTS indexing, and cursor pagination.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createEventStore, type EventStore } from "../../src/services/event-store.js";
import { createProposalStore } from "../../src/services/proposal-store.js";

describe("MCP Tool Service Integration", () => {
  let db: Database.Database;
  let messageStore: MessageStore;
  let eventStore: EventStore;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    messageStore = createMessageStore(db);
    eventStore = createEventStore(db);
  });

  afterAll(() => {
    db.close();
  });

  // =========================================================================
  // Messaging tools: send_message -> read_messages flow
  // =========================================================================

  describe("Messaging: send_message -> read_messages flow", () => {
    it("should persist a message and retrieve it by agentId", () => {
      // Simulates what MCP send_message does
      const msg = messageStore.insertMessage({
        agentId: "agent-alpha",
        recipient: "user",
        role: "agent",
        body: "Status update from alpha",
        threadId: "thread-001",
      });

      expect(msg.id).toBeDefined();
      expect(msg.agentId).toBe("agent-alpha");
      expect(msg.recipient).toBe("user");
      expect(msg.deliveryStatus).toBe("pending");

      // Simulates what MCP read_messages does
      const messages = messageStore.getMessages({ agentId: "agent-alpha", limit: 10 });
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const found = messages.find((m) => m.id === msg.id);
      expect(found).toBeDefined();
      expect(found!.body).toBe("Status update from alpha");
      expect(found!.threadId).toBe("thread-001");
    });

    it("should handle message metadata round-trip", () => {
      const metadata = {
        beadId: "adj-042",
        progress: 75,
        tags: ["urgent", "frontend"],
      };

      const msg = messageStore.insertMessage({
        agentId: "agent-bravo",
        recipient: "user",
        role: "agent",
        body: "Progress report",
        metadata,
      });

      const retrieved = messageStore.getMessage(msg.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.metadata).toEqual(metadata);
    });

    it("should support full-text search across messages", () => {
      messageStore.insertMessage({
        agentId: "agent-charlie",
        role: "agent",
        body: "Refactoring the authentication module for session tokens",
      });

      messageStore.insertMessage({
        agentId: "agent-delta",
        role: "agent",
        body: "Fixed the database connection pooling issue",
      });

      const results = messageStore.searchMessages("authentication");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((m) => m.body.includes("authentication"))).toBe(true);
      expect(results.every((m) => !m.body.includes("pooling"))).toBe(true);
    });

    it("should handle mark_read flow correctly", () => {
      const msg = messageStore.insertMessage({
        agentId: "agent-echo",
        role: "agent",
        body: "Read receipt test",
      });

      expect(msg.deliveryStatus).toBe("pending");

      // mark_read tool handler calls this
      messageStore.markRead(msg.id);

      const updated = messageStore.getMessage(msg.id);
      expect(updated!.deliveryStatus).toBe("read");
    });

    it("should list threads with correct aggregation", () => {
      const threadId = "integration-thread-99";
      messageStore.insertMessage({
        agentId: "agent-foxtrot",
        role: "agent",
        body: "First in thread",
        threadId,
      });
      messageStore.insertMessage({
        agentId: "agent-foxtrot",
        role: "agent",
        body: "Second in thread",
        threadId,
      });
      messageStore.insertMessage({
        agentId: "agent-foxtrot",
        role: "agent",
        body: "Third in thread",
        threadId,
      });

      const threads = messageStore.getThreads("agent-foxtrot");
      const thread = threads.find((t) => t.threadId === threadId);
      expect(thread).toBeDefined();
      expect(thread!.messageCount).toBe(3);
      expect(thread!.latestBody).toBe("Third in thread");
    });
  });

  // =========================================================================
  // Event store: timeline events from MCP tools
  // =========================================================================

  describe("EventStore: timeline events from tool calls", () => {
    it("should insert and retrieve events by agent", () => {
      // Simulates what MCP status tools emit
      const event = eventStore.insertEvent({
        eventType: "status_change",
        agentId: "agent-golf",
        action: "Status changed to working",
        detail: { status: "working", task: "Building auth module" },
      });

      expect(event.id).toBeDefined();
      expect(event.agentId).toBe("agent-golf");

      const events = eventStore.getEvents({ agentId: "agent-golf" });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const found = events.find((e) => e.id === event.id);
      expect(found).toBeDefined();
      expect(found!.action).toBe("Status changed to working");
    });

    it("should insert events with bead context", () => {
      const event = eventStore.insertEvent({
        eventType: "bead_update",
        agentId: "agent-hotel",
        action: "Bead closed",
        beadId: "adj-042",
        detail: { status: "done" },
      });

      expect(event.beadId).toBe("adj-042");

      const events = eventStore.getEvents({ agentId: "agent-hotel" });
      const found = events.find((e) => e.beadId === "adj-042");
      expect(found).toBeDefined();
    });

    it("should prune old events by age", () => {
      // Insert an event with a manually backdated timestamp
      const id = "prune-test-event";
      db.prepare(`
        INSERT INTO events (id, event_type, agent_id, action, detail, bead_id, message_id, created_at)
        VALUES (?, 'test_prune', 'agent-india', 'Old event', NULL, NULL, NULL, datetime('now', '-10 days'))
      `).run(id);

      // Pruning with 5 days should remove the 10-day-old event
      const pruned = eventStore.pruneOldEvents(5);
      expect(pruned).toBeGreaterThanOrEqual(1);

      // Recent events should still exist
      eventStore.insertEvent({
        eventType: "test_recent",
        agentId: "agent-india",
        action: "Recent event",
      });

      const recentEvents = eventStore.getEvents({ agentId: "agent-india", eventType: "test_recent" });
      expect(recentEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Cross-service: message + event correlation
  // =========================================================================

  describe("Cross-service: message and event correlation", () => {
    it("should link events to messages via messageId", () => {
      // Agent sends a message (messaging tool)
      const msg = messageStore.insertMessage({
        agentId: "agent-juliet",
        recipient: "user",
        role: "agent",
        body: "Completed the feature",
      });

      // Event is emitted referencing the message (status tool side-effect)
      const event = eventStore.insertEvent({
        eventType: "message_sent",
        agentId: "agent-juliet",
        action: "Message to user",
        messageId: msg.id,
      });

      // Verify correlation: event references the correct message
      const events = eventStore.getEvents({ agentId: "agent-juliet" });
      const linkedEvent = events.find((e) => e.id === event.id);
      expect(linkedEvent).toBeDefined();
      expect(linkedEvent!.messageId).toBe(msg.id);

      // And the message still exists
      const linkedMsg = messageStore.getMessage(msg.id);
      expect(linkedMsg).not.toBeNull();
      expect(linkedMsg!.body).toBe("Completed the feature");
    });
  });

  // =========================================================================
  // Proposal store integration
  // =========================================================================

  describe("ProposalStore: create and retrieve proposals", () => {
    let proposalStore: ReturnType<typeof createProposalStore>;

    beforeAll(() => {
      proposalStore = createProposalStore(db);
    });

    it("should create and retrieve a proposal", () => {
      const proposal = proposalStore.insertProposal({
        author: "agent-kilo",
        title: "Add caching layer",
        description: "Implement Redis caching for frequently accessed data",
        type: "engineering",
        project: "adjutant",
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe("pending");

      const retrieved = proposalStore.getProposal(proposal.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe("Add caching layer");
      expect(retrieved!.author).toBe("agent-kilo");
    });

    it("should list proposals with status filter", () => {
      proposalStore.insertProposal({
        author: "agent-lima",
        title: "Proposal to filter",
        description: "Test filtering",
        type: "product",
        project: "adjutant",
      });

      const pending = proposalStore.getProposals({ status: "pending" });
      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.every((p) => p.status === "pending")).toBe(true);
    });
  });
});
