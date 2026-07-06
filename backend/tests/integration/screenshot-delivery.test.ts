/**
 * Integration test for US2 screenshot delivery wired into the message-send path
 * (adj-203.3.2 / T009).
 *
 * Exercises the REAL persist → hydrate → prompt-build → inject chain: a real
 * in-memory SQLite MessageStore + AttachmentStore link a Commander image to a DM
 * message, and `deliverDirectMessage` (the single shared send path) hands the
 * hydrated message to the attachment delivery service, which injects the image's
 * ABSOLUTE path into the online agent's session via InputRouter.
 *
 * Only the tmux boundary (the session bridge / InputRouter) and WS fan-out are
 * mocked — everything else is real. Asserts:
 *   - DM + image + online agent ⇒ the absolute path is injected (not the plain body),
 *   - the send is NOT blocked on tmux I/O (result returns before injection resolves),
 *   - a plain (no-image) message keeps the existing plain-body injection,
 *   - an offline/unknown agent still persists the message but injects nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

const mockGetSessionBridge = vi.fn();
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: (...args: unknown[]) => mockGetSessionBridge(...args),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock("../../src/utils/index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logDebug: vi.fn() };
});

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { deliverDirectMessage } from "../../src/services/direct-message-delivery.js";

let db: Database.Database;
let attachmentStore: AttachmentStore;
let store: MessageStore;

const ABS_PATH = "/var/adjutant/uploads/1111-2222.png";

function makeImage(storagePath = ABS_PATH): string {
  return attachmentStore.createAttachment({
    kind: "image",
    storagePath,
    filename: "bug.png",
    mimeType: "image/png",
    sizeBytes: 4096,
  }).id;
}

/** A mock session bridge whose registry has an online session for `agentName`. */
function bridgeWithOnlineAgent(agentName: string, sendInput = vi.fn().mockResolvedValue(true), inputRouterSend = vi.fn().mockResolvedValue(true)) {
  return {
    registry: {
      findByName: vi.fn((name: string) => (name === agentName ? [{ id: "sess-1", status: "idle" }] : [])),
    },
    inputRouter: { sendInput: inputRouterSend },
    sendInput,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
  store = createMessageStore(db, { attachmentStore });
});

afterEach(() => {
  db.close();
});

describe("US2 screenshot delivery wired into the send path", () => {
  it("injects the absolute image path into the online agent's pane (not the plain body)", async () => {
    const inputRouterSend = vi.fn().mockResolvedValue(true);
    const plainSend = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWithOnlineAgent("kerrigan", plainSend, inputRouterSend));

    const attId = makeImage();
    const res = deliverDirectMessage(
      { store },
      { from: "user", to: "kerrigan", body: "why is this red?", role: "user", attachmentIds: [attId] },
    );

    // Message persisted with the linked attachment (real store).
    expect(store.getMessage(res.messageId)?.attachments?.[0]?.storagePath).toBe(ABS_PATH);

    // Let the fire-and-forget injection settle.
    await new Promise((r) => setImmediate(r));

    // The image prompt (absolute path) was injected via InputRouter…
    expect(inputRouterSend).toHaveBeenCalledTimes(1);
    const injected = inputRouterSend.mock.calls[0]![1] as string;
    expect(injected).toContain(ABS_PATH);
    expect(injected).toContain("why is this red?");
    expect(injected).toContain("[Commander shared 1 screenshot");

    // …and the plain-body path was NOT used (no double injection).
    expect(plainSend).not.toHaveBeenCalled();
  });

  it("does NOT block the send on tmux I/O (result returns before injection resolves)", async () => {
    let resolveInject!: (v: boolean) => void;
    const slowInject = vi.fn(() => new Promise<boolean>((r) => { resolveInject = r; }));
    mockGetSessionBridge.mockReturnValue(bridgeWithOnlineAgent("kerrigan", vi.fn(), slowInject));

    const attId = makeImage();
    // deliverDirectMessage is synchronous — it returns even though the inject promise is unresolved.
    const res = deliverDirectMessage(
      { store },
      { from: "user", to: "kerrigan", body: "look", role: "user", attachmentIds: [attId] },
    );
    expect(res.messageId).toBeTruthy();
    expect(slowInject).toHaveBeenCalledTimes(1); // fired…
    // …but still pending — the send did not await it.
    resolveInject(true);
    await new Promise((r) => setImmediate(r));
  });

  it("keeps the plain-body injection for a message with no image attachments", async () => {
    const inputRouterSend = vi.fn().mockResolvedValue(true);
    const plainSend = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWithOnlineAgent("kerrigan", plainSend, inputRouterSend));

    deliverDirectMessage({ store }, { from: "user", to: "kerrigan", body: "plain text", role: "user" });
    await new Promise((r) => setImmediate(r));

    expect(plainSend).toHaveBeenCalledWith("sess-1", "plain text");
    expect(inputRouterSend).not.toHaveBeenCalled();
  });

  it("persists the message but injects nothing when the target agent is offline", async () => {
    const inputRouterSend = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-1", status: "offline" }]) },
      inputRouter: { sendInput: inputRouterSend },
      sendInput: vi.fn(),
    });

    const attId = makeImage();
    const res = deliverDirectMessage(
      { store },
      { from: "user", to: "kerrigan", body: "offline case", role: "user", attachmentIds: [attId] },
    );
    await new Promise((r) => setImmediate(r));

    expect(store.getMessage(res.messageId)?.attachments?.[0]?.id).toBe(attId);
    expect(inputRouterSend).not.toHaveBeenCalled();
  });

  it("never throws into the caller even if the session bridge is uninitialized", () => {
    mockGetSessionBridge.mockImplementation(() => {
      throw new Error("bridge not ready");
    });
    const attId = makeImage();
    expect(() =>
      deliverDirectMessage(
        { store },
        { from: "user", to: "kerrigan", body: "x", role: "user", attachmentIds: [attId] },
      ),
    ).not.toThrow();
  });
});
