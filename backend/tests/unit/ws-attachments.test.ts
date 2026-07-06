/**
 * Tests for attachments on the WS chat_message payload (adj-203.2.4).
 *
 * The `chat_message` WsServerMessage must be able to carry `attachments` so web
 * + iOS render Commander screenshots inline in real time. This is a type-surface
 * + broadcast test: sending a DM with attachmentIds must broadcast a chat_message
 * whose `attachments` array carries the linked rows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore } from "../../src/services/message-store.js";
import type { WsServerMessage } from "../../src/services/ws-server.js";
import * as wsServer from "../../src/services/ws-server.js";
import { deliverDirectMessage } from "../../src/services/direct-message-delivery.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("WS chat_message attachments payload", () => {
  it("should type-allow PUBLIC attachments on a chat_message payload (no storagePath)", () => {
    // Compile-time contract: attachments is the PUBLIC DTO — id/kind/filename/
    // mimeType/sizeBytes only. storagePath is NOT part of the client payload.
    const msg: WsServerMessage = {
      type: "chat_message",
      id: "m-1",
      from: "user",
      to: "raynor",
      body: "look",
      attachments: [
        {
          id: "att-1",
          kind: "image",
          filename: "a.png",
          mimeType: "image/png",
          sizeBytes: 10,
        },
      ],
    };
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments?.[0]?.mimeType).toBe("image/png");
    expect(msg.attachments?.[0]).not.toHaveProperty("storagePath");
  });

  it("should broadcast a chat_message carrying the linked attachments on send (adj-203.2.5.1)", () => {
    const attachmentStore = createAttachmentStore(db);
    const store = createMessageStore(db, { attachmentStore });
    const att = attachmentStore.createAttachment({
      kind: "image",
      storagePath: "/uploads/x.png",
      filename: "x.png",
      mimeType: "image/png",
      sizeBytes: 20,
    });

    const spy = vi.spyOn(wsServer, "wsBroadcast").mockImplementation(() => {});

    deliverDirectMessage({ store }, { from: "user", to: "raynor", body: "screenshot", role: "user", attachmentIds: [att.id] });

    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0]![0];
    expect(payload.type).toBe("chat_message");
    expect(payload.attachments).toBeDefined();
    expect(payload.attachments![0]!.id).toBe(att.id);
    // adj-203.2.5.1: the absolute server path MUST NOT leak to web/iOS clients.
    expect(payload.attachments![0]).not.toHaveProperty("storagePath");
    expect(payload.attachments![0]!.filename).toBe("x.png");
    expect(payload.attachments![0]!.mimeType).toBe("image/png");
    expect(payload.attachments![0]!.sizeBytes).toBe(20);
    expect(JSON.stringify(payload)).not.toContain("/uploads/x.png");
  });

  it("should omit attachments for a plain message (no attachmentIds)", () => {
    const attachmentStore = createAttachmentStore(db);
    const store = createMessageStore(db, { attachmentStore });
    const spy = vi.spyOn(wsServer, "wsBroadcast").mockImplementation(() => {});

    deliverDirectMessage({ store }, { from: "user", to: "raynor", body: "plain", role: "user" });

    const payload = spy.mock.calls[0]![0];
    expect(payload.attachments).toBeUndefined();
  });
});
