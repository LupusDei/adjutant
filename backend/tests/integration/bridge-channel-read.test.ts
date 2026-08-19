/**
 * Integration: the Bridge reads multi-agent CHANNELS (adj-6fg1g).
 *
 * The Bridge speaks as the Layer-2 coordinator ("adjutant-coordinator") and is a NON-MEMBER
 * observer of the channels agents share. Before this, its read surface could only address an
 * agent's DM thread or fleet-wide traffic, so a channel shared by several agents was
 * unreachable — it had no way to NAME one.
 *
 * This exercises the real wiring end to end over a real SQLite DB — migrations →
 * conversation store → message store → the read-only bridge tool surface — with NO mocked
 * store, so it would catch a schema/shape drift that the unit tests' fakes cannot.
 *
 * "Live" for the Bridge means the next PULL: it holds no WebSocket (it is request/response
 * RPC only), so a message posted after an earlier read must appear on the next read.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createConversationStore, type ConversationStore } from "../../src/services/conversation-store.js";
import {
  createBridgeToolBridge,
  type BridgeToolBridge,
  type BridgeToolDeps,
} from "../../src/services/bridge-tool-bridge.js";

/** The Bridge's own identity — deliberately NOT a member of the channel under test. */
const BRIDGE_IDENTITY = "adjutant-coordinator";

/**
 * Stamp a message's created_at to a distinct second.
 *
 * insertMessage uses datetime('now') (SECOND granularity) and getMessages breaks ties on a
 * RANDOM uuid id, so a same-second burst has no deterministic order (adj-cax0y). Ordering is
 * a real contract of this read path, so the fixture gives each message its own second rather
 * than the assertions being weakened to hide the defect.
 */
function stampCreatedAt(messageId: string, isoSecond: string): void {
  db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(isoSecond, messageId);
}

let db: Database.Database;
let convStore: ConversationStore;
let msgStore: MessageStore;
let bridge: BridgeToolBridge;
let channelId: string;

/** Only the conversation/message stores matter here; the rest of the surface is unused. */
function unusedDeps(): Omit<BridgeToolDeps, "messageStore" | "conversationStore"> {
  return {
    proposalStore: { getProposals: () => [] } as unknown as BridgeToolDeps["proposalStore"],
    autoDevelopStore: undefined,
    questionService: { listQuestions: () => [] } as unknown as BridgeToolDeps["questionService"],
    memoryStore: {
      searchLearnings: () => [],
      queryLearnings: () => [],
    } as unknown as BridgeToolDeps["memoryStore"],
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  msgStore = createMessageStore(db);
  convStore = createConversationStore(db, msgStore);

  // A channel shared by TWO agents plus the Commander. The Bridge is not in it.
  const channel = convStore.createChannel({
    title: "fleet-ops",
    createdBy: "user",
    initialMembers: [
      { memberId: "fenix", memberKind: "agent" },
      { memberId: "kerrigan", memberKind: "agent" },
    ],
  });
  channelId = channel.id;

  const first = convStore.postToChannel({ channelId, senderId: "fenix", body: "Deploying the map view" });
  const second = convStore.postToChannel({ channelId, senderId: "kerrigan", body: "Race condition reproduced" });
  stampCreatedAt(first.id, "2026-08-18 01:00:00");
  stampCreatedAt(second.id, "2026-08-18 02:00:00");

  bridge = createBridgeToolBridge({
    ...unusedDeps(),
    messageStore: msgStore,
    conversationStore: convStore,
  });
});

afterEach(() => {
  db.close();
});

describe("Bridge ↔ multi-agent channels (adj-6fg1g)", () => {
  it("the Bridge is NOT a member of the channel it must observe (the premise of this bug)", () => {
    const members = convStore.getMembers(channelId).map((m) => m.memberId);
    expect(members).toContain("fenix");
    expect(members).toContain("kerrigan");
    expect(members).not.toContain(BRIDGE_IDENTITY);
  });

  it("discovers the channel by name via list_channels, with its agent members", async () => {
    const res = await bridge.executeTool({ tool: "list_channels", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { channels: { title: string; memberCount: number; members: string[] }[] };
      const ops = data.channels.find((c) => c.title === "fleet-ops");
      expect(ops).toBeDefined();
      expect(ops!.memberCount).toBe(3);
      expect(ops!.members.sort()).toEqual(["fenix", "kerrigan", "user"]);
    }
  });

  it("reads the multi-agent channel's HISTORY by name despite not being a member", async () => {
    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        channel: { id: string; title: string };
        messages: { from: string; to: string; text: string }[];
        count: number;
      };
      expect(data.channel.title).toBe("fleet-ops");
      expect(data.count).toBe(2);
      // Oldest → newest, attributed per sender, addressed to the channel.
      expect(data.messages).toEqual([
        { from: "fenix", to: "fleet-ops", text: "Deploying the map view" },
        { from: "kerrigan", to: "fleet-ops", text: "Race condition reproduced" },
      ]);
    }
  });

  it("sees a NEW channel message on the next pull (the Bridge's 'live' path is request/response)", async () => {
    const before = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });
    expect(before.ok).toBe(true);
    if (before.ok) expect((before.data as { count: number }).count).toBe(2);

    const posted = convStore.postToChannel({ channelId, senderId: "fenix", body: "Map view merged" });
    stampCreatedAt(posted.id, "2026-08-18 03:00:00");

    const after = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });
    expect(after.ok).toBe(true);
    if (after.ok) {
      const data = after.data as { messages: { from: string; text: string }[]; count: number };
      expect(data.count).toBe(3);
      expect(data.messages.at(-1)).toEqual({ from: "fenix", to: "fleet-ops", text: "Map view merged" });
    }
  });

  it("does NOT bleed other conversations into a channel read (strict conversation scoping)", async () => {
    // A DM that must never surface in the channel read.
    const dm = convStore.getOrCreateDm("user", "fenix");
    msgStore.insertMessage({
      agentId: "user",
      recipient: "fenix",
      role: "user",
      body: "PRIVATE: do not leak into the channel",
      conversationId: dm.id,
    });

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: { text: string }[] };
      expect(data.messages.every((m) => !m.text.includes("PRIVATE"))).toBe(true);
    }
  });

  it("refuses an unknown channel name and names the real ones instead of guessing", async () => {
    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "war-room" } });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("CHANNEL_NOT_FOUND");
      expect(res.error.message).toContain("fleet-ops");
    }
  });
});
