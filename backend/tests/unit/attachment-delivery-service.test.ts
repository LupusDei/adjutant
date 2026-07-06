/**
 * Tests for the attachment delivery service (adj-203.3.1 / T008).
 *
 * US2: when the Commander DMs an image to an ONLINE agent, the agent's Claude
 * receives the image's ABSOLUTE path injected into its tmux pane. This service is
 * the single decision + delivery point: DM → online agent + ≥1 image ⇒ resolve the
 * session via SessionRegistry and inject a prompt (absolute paths + body) through
 * InputRouter. Everything else (offline/unknown agent, non-DM, no image) is a no-op.
 * It MUST NEVER throw into its caller — delivery is best-effort, post-persist.
 *
 * Here we mock InputRouter + SessionRegistry and assert the decision matrix + the
 * exact injected prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { deliverImageAttachments } from "../../src/services/attachment-delivery-service.js";
import type { MessageAttachment } from "../../src/services/attachment-store.js";

// A "dm_"-prefixed id is what dmConversationId() always produces (conversation-store).
const DM_ID = "dm_abc123def456";

function image(storagePath: string, id = storagePath): MessageAttachment {
  return {
    id,
    messageId: "msg-1",
    kind: "image",
    storagePath,
    filename: "shot.png",
    mimeType: "image/png",
    sizeBytes: 100,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function message(overrides: Partial<{
  conversationId: string | null;
  body: string;
  recipient: string | null;
  attachments: MessageAttachment[];
}> = {}) {
  return {
    conversationId: overrides.conversationId !== undefined ? overrides.conversationId : DM_ID,
    body: overrides.body !== undefined ? overrides.body : "look at this bug",
    recipient: overrides.recipient !== undefined ? overrides.recipient : "kerrigan",
    attachments: overrides.attachments !== undefined ? overrides.attachments : [image("/home/u/.adjutant/uploads/a.png")],
  };
}

let sendInput: ReturnType<typeof vi.fn>;
let findByName: ReturnType<typeof vi.fn>;

function deps() {
  return {
    registry: { findByName },
    inputRouter: { sendInput },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendInput = vi.fn().mockResolvedValue(true);
  // Default: one ONLINE session for the recipient.
  findByName = vi.fn(() => [{ id: "sess-A", status: "idle" }]);
});

describe("deliverImageAttachments", () => {
  it("injects the absolute image path + body into an online agent's session (DM, 1 image)", async () => {
    const res = await deliverImageAttachments(deps(), {
      message: message({ attachments: [image("/uploads/one.png")], body: "see this" }),
      recipient: "kerrigan",
    });

    expect(findByName).toHaveBeenCalledWith("kerrigan");
    expect(sendInput).toHaveBeenCalledTimes(1);
    const [sessionId, text] = sendInput.mock.calls[0]!;
    expect(sessionId).toBe("sess-A");
    expect(text).toContain("/uploads/one.png");
    expect(text).toContain("see this");
    expect(text).toContain("[Commander shared 1 screenshot");
    expect(res.injected).toBe(true);
    expect(res.imageCount).toBe(1);
    expect(res.sessionsDelivered).toBe(1);
  });

  it("lists ALL absolute paths in one prompt for a multi-image message (pluralized header)", async () => {
    const res = await deliverImageAttachments(deps(), {
      message: message({
        attachments: [image("/uploads/a.png"), image("/uploads/b.png"), image("/uploads/c.png")],
        body: "three shots",
      }),
      recipient: "kerrigan",
    });

    expect(sendInput).toHaveBeenCalledTimes(1);
    const text = sendInput.mock.calls[0]![1] as string;
    expect(text).toContain("[Commander shared 3 screenshots");
    expect(text).toContain("/uploads/a.png");
    expect(text).toContain("/uploads/b.png");
    expect(text).toContain("/uploads/c.png");
    expect(text).toContain("three shots");
    // Header, three paths, body → 5 lines, order preserved.
    expect(text.split("\n")).toEqual([
      "[Commander shared 3 screenshots — please review]",
      "/uploads/a.png",
      "/uploads/b.png",
      "/uploads/c.png",
      "three shots",
    ]);
    expect(res.injected).toBe(true);
  });

  it("no-ops when the target agent is OFFLINE (session exists but offline)", async () => {
    findByName = vi.fn(() => [{ id: "sess-A", status: "offline" }]);
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "kerrigan" });

    expect(sendInput).not.toHaveBeenCalled();
    expect(res.injected).toBe(false);
    expect(res.reason).toBe("offline-or-unknown");
  });

  it("no-ops when the target agent is UNKNOWN (no session)", async () => {
    findByName = vi.fn(() => []);
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "ghost" });

    expect(sendInput).not.toHaveBeenCalled();
    expect(res.injected).toBe(false);
    expect(res.reason).toBe("offline-or-unknown");
  });

  it("no-ops for a NON-DM conversation (channel / no conversation id)", async () => {
    const chan = await deliverImageAttachments(deps(), {
      message: message({ conversationId: "channel-xyz" }),
      recipient: "kerrigan",
    });
    expect(chan.injected).toBe(false);
    expect(chan.reason).toBe("not-dm");

    const none = await deliverImageAttachments(deps(), {
      message: message({ conversationId: null }),
      recipient: "kerrigan",
    });
    expect(none.injected).toBe(false);
    expect(none.reason).toBe("not-dm");

    expect(sendInput).not.toHaveBeenCalled();
    expect(findByName).not.toHaveBeenCalled();
  });

  it("no-ops when there are NO image attachments (empty or non-image kind)", async () => {
    const empty = await deliverImageAttachments(deps(), {
      message: message({ attachments: [] }),
      recipient: "kerrigan",
    });
    expect(empty.injected).toBe(false);
    expect(empty.reason).toBe("no-image");

    const nonImage: MessageAttachment = { ...image("/uploads/doc.pdf"), kind: "file", mimeType: "application/pdf" };
    const notImg = await deliverImageAttachments(deps(), {
      message: message({ attachments: [nonImage] }),
      recipient: "kerrigan",
    });
    expect(notImg.injected).toBe(false);
    expect(notImg.reason).toBe("no-image");

    expect(sendInput).not.toHaveBeenCalled();
  });

  it("no-ops when the recipient is the user (agent→user direction)", async () => {
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "user" });
    expect(res.injected).toBe(false);
    expect(res.reason).toBe("no-agent-recipient");
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("falls back to message.recipient when no explicit recipient is given", async () => {
    await deliverImageAttachments(deps(), { message: message({ recipient: "kerrigan" }) });
    expect(findByName).toHaveBeenCalledWith("kerrigan");
    expect(sendInput).toHaveBeenCalledTimes(1);
  });

  it("omits the body line when the message body is empty/whitespace", async () => {
    await deliverImageAttachments(deps(), {
      message: message({ attachments: [image("/uploads/x.png")], body: "   " }),
      recipient: "kerrigan",
    });
    const text = sendInput.mock.calls[0]![1] as string;
    expect(text.split("\n")).toEqual([
      "[Commander shared 1 screenshot — please review]",
      "/uploads/x.png",
    ]);
  });

  it("NEVER throws — a registry failure is swallowed and reported as a no-op", async () => {
    findByName = vi.fn(() => {
      throw new Error("registry exploded");
    });
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "kerrigan" });
    expect(res.injected).toBe(false);
    expect(res.reason).toBe("error");
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("NEVER throws — an InputRouter rejection is swallowed and reported as a no-op", async () => {
    sendInput = vi.fn().mockRejectedValue(new Error("tmux gone"));
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "kerrigan" });
    expect(res.injected).toBe(false);
    expect(res.reason).toBe("error");
  });

  it("injects into EVERY online session for the agent, counting deliveries", async () => {
    findByName = vi.fn(() => [
      { id: "sess-A", status: "idle" },
      { id: "sess-B", status: "working" },
      { id: "sess-C", status: "offline" },
    ]);
    const res = await deliverImageAttachments(deps(), { message: message(), recipient: "kerrigan" });
    expect(sendInput).toHaveBeenCalledTimes(2);
    expect(sendInput).toHaveBeenCalledWith("sess-A", expect.any(String));
    expect(sendInput).toHaveBeenCalledWith("sess-B", expect.any(String));
    expect(res.sessionsTargeted).toBe(2);
    expect(res.sessionsDelivered).toBe(2);
    expect(res.injected).toBe(true);
  });
});
