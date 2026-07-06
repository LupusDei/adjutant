/**
 * End-to-end acceptance: Commander screenshot sharing (adj-203.6.4 / T019).
 *
 * The full pipeline over the HTTP surface + the real send path:
 *
 *   POST /api/uploads (multipart image)  → validated, stored, attachment row
 *   POST /api/messages { attachmentIds }  → persist + link + WS broadcast + tmux inject
 *   GET  /api/messages                     → history carries the attachment
 *
 * Asserts the two contracts that matter most:
 *   (A) CLIENT payloads (WS chat_message + REST) carry the PUBLIC attachment DTO and
 *       NEVER leak the absolute server storagePath (adj-203.2.5.1).
 *   (B) SERVER-SIDE tmux delivery injects the ABSOLUTE storagePath into the online
 *       agent's pane so its Claude can Read the screenshot (adj-203.3 / US2).
 *
 * Only the tmux boundary (session bridge / InputRouter) and WS fan-out are mocked;
 * everything else — upload validation, storage, DB, linking, hydration, serialization
 * — is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- module mocks (the only mocked seams: WS fan-out + the tmux session bridge) ---
const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

const mockGetSessionBridge = vi.fn();
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: (...args: unknown[]) => mockGetSessionBridge(...args),
}));

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createUploadStorage } from "../../src/services/upload-storage.js";
import { createUploadService } from "../../src/services/upload-service.js";
import { createUploadsRouter } from "../../src/routes/uploads.js";
import { createMessagesRouter } from "../../src/routes/messages.js";

// Minimal valid PNG (magic bytes + payload).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]);

let db: Database.Database;
let dir: string;
let attachmentStore: AttachmentStore;
let messageStore: MessageStore;
let app: Express;

/** A session bridge whose registry reports an ONLINE session for `agentName`. */
function bridgeWithOnlineAgent(agentName: string, inputRouterSend: ReturnType<typeof vi.fn>) {
  return {
    registry: {
      findByName: vi.fn((name: string) => (name === agentName ? [{ id: "sess-1", status: "idle" }] : [])),
    },
    inputRouter: { sendInput: inputRouterSend },
    sendInput: vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
  messageStore = createMessageStore(db, { attachmentStore });
  dir = mkdtempSync(join(tmpdir(), "adj-e2e-"));
  const uploadService = createUploadService({
    storage: createUploadStorage({ uploadDir: dir }),
    attachmentStore,
  });

  app = express();
  app.use(express.json());
  app.use("/api/uploads", createUploadsRouter(uploadService));
  app.use("/api/messages", createMessagesRouter(messageStore));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("screenshot sharing — end-to-end acceptance (adj-203.6.4)", () => {
  it("uploads → DMs an online agent → persists + serializes PUBLIC attachment + injects the ABSOLUTE path", async () => {
    const inputRouterSend = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWithOnlineAgent("kerrigan", inputRouterSend));

    // 1. Upload the screenshot.
    const up = await request(app)
      .post("/api/uploads")
      .attach("file", PNG, { filename: "bug.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const attachmentId = up.body.data.id as string;
    // Upload response is the public shape — no absolute path.
    expect(up.body.data).not.toHaveProperty("storagePath");

    // The real absolute path lives internally (this is what MUST be injected, and MUST NOT leak).
    const absolutePath = attachmentStore.getById(attachmentId)!.storagePath;
    expect(absolutePath.startsWith(dir)).toBe(true);

    // 2. Send a DM to the online agent carrying the attachment.
    const send = await request(app)
      .post("/api/messages")
      .send({ to: "kerrigan", body: "why is this red?", attachmentIds: [attachmentId] });
    expect(send.status).toBe(201);
    const messageId = send.body.data.messageId as string;

    // 3a. Persisted + linked (internal record still carries storagePath for delivery).
    const persisted = messageStore.getMessage(messageId);
    expect(persisted?.attachments?.[0]?.id).toBe(attachmentId);
    expect(persisted?.attachments?.[0]?.storagePath).toBe(absolutePath);

    // 3b. (A) WS chat_message payload carries the PUBLIC attachment — NO storagePath leak.
    const wsCall = mockWsBroadcast.mock.calls.find(
      ([m]) => (m as { type?: string }).type === "chat_message",
    );
    expect(wsCall).toBeDefined();
    const wsPayload = wsCall![0] as { attachments?: Record<string, unknown>[] };
    expect(wsPayload.attachments?.[0]).toMatchObject({
      id: attachmentId,
      filename: "bug.png",
      mimeType: "image/png",
    });
    expect(wsPayload.attachments?.[0]).not.toHaveProperty("storagePath");
    expect(JSON.stringify(wsPayload)).not.toContain(absolutePath);

    // 3c. (A) REST history carries the PUBLIC attachment — NO storagePath leak.
    const list = await request(app).get("/api/messages").query({ agentId: "kerrigan" });
    expect(list.status).toBe(200);
    const restMsg = (list.body.data.items as { id: string; attachments?: Record<string, unknown>[] }[]).find(
      (m) => m.id === messageId,
    );
    expect(restMsg?.attachments?.[0]).toMatchObject({ id: attachmentId, mimeType: "image/png" });
    expect(restMsg?.attachments?.[0]).not.toHaveProperty("storagePath");
    expect(JSON.stringify(list.body)).not.toContain(absolutePath);

    // 4. (B) Let the fire-and-forget injection settle, then assert the ABSOLUTE path
    //    was injected into the online agent's pane (server-side, internal use).
    await new Promise((r) => setImmediate(r));
    expect(inputRouterSend).toHaveBeenCalledTimes(1);
    const injected = inputRouterSend.mock.calls[0]![1] as string;
    expect(injected).toContain(absolutePath);
    expect(injected).toContain("why is this red?");
    expect(injected).toContain("[Commander shared 1 screenshot");
  });

  it("offline agent: still persists + serializes the attachment, but injects nothing", async () => {
    const inputRouterSend = vi.fn().mockResolvedValue(true);
    // Registry reports no online session for the recipient.
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => []) },
      inputRouter: { sendInput: inputRouterSend },
      sendInput: vi.fn().mockResolvedValue(true),
    });

    const up = await request(app)
      .post("/api/uploads")
      .attach("file", PNG, { filename: "shot.png", contentType: "image/png" });
    const attachmentId = up.body.data.id as string;

    const send = await request(app)
      .post("/api/messages")
      .send({ to: "ghost-agent", body: "", attachmentIds: [attachmentId] });
    expect(send.status).toBe(201); // image-only DM still accepted (adj-203.2.5.2)

    const messageId = send.body.data.messageId as string;
    expect(messageStore.getMessage(messageId)?.attachments?.[0]?.id).toBe(attachmentId);

    await new Promise((r) => setImmediate(r));
    expect(inputRouterSend).not.toHaveBeenCalled(); // offline → no injection
  });
});
