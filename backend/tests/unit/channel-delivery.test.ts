/**
 * Tests for channel → agent CLI delivery (channel tmux injection).
 *
 * A channel post must be injected into each AGENT member's tmux pane (like a
 * DM), excluding the sender and the human operator, and tagged so the agent
 * knows it is a channel message and how to reply (to the room via conversationId).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendInput = vi.fn().mockResolvedValue(true);
const findByName = vi.fn((name: string) => [{ id: `sess-${name}` }]);

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({ registry: { findByName }, sendInput }),
}));

import {
  deliverChannelPostToAgents,
  formatChannelInjection,
} from "../../src/services/channel-delivery.js";

interface Member { conversationId: string; memberId: string; memberKind: "user" | "agent"; role: string }

function fakeStore(members: Member[], title: string | null = "ops") {
  return {
    getMembers: (_id: string) => members,
    getConversation: (_id: string) => ({ id: _id, kind: "channel" as const, title, archived: false, createdAt: "", updatedAt: "" }),
  } as unknown as import("../../src/services/conversation-store.js").ConversationStore;
}

const mk = (memberId: string, memberKind: "user" | "agent"): Member => ({
  conversationId: "chan-1",
  memberId,
  memberKind,
  role: "member",
});

beforeEach(() => {
  sendInput.mockClear();
  findByName.mockClear();
});

describe("deliverChannelPostToAgents", () => {
  it("injects to every agent member except the sender and the operator", () => {
    const store = fakeStore([mk("user", "user"), mk("raynor", "agent"), mk("kerrigan", "agent")]);

    const delivered = deliverChannelPostToAgents(store, {
      channelId: "chan-1",
      senderId: "raynor",
      body: "rally point set",
    });

    // raynor (sender) and user (operator) excluded; only kerrigan gets it.
    expect(delivered).toEqual(["kerrigan"]);
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(findByName).toHaveBeenCalledWith("kerrigan");
  });

  it("tags the injected text as a CHANNEL message with conversationId reply guidance", () => {
    const store = fakeStore([mk("user", "user"), mk("raynor", "agent")]);

    deliverChannelPostToAgents(store, { channelId: "chan-1", senderId: "user", body: "standup now" });

    expect(sendInput).toHaveBeenCalledTimes(1);
    const injected = sendInput.mock.calls[0][1] as string;
    expect(injected).toContain("[CHANNEL #ops");
    expect(injected).toContain("from user");
    expect(injected).toContain("standup now");
    expect(injected).toContain('conversationId="chan-1"');
    expect(injected.toLowerCase()).toContain("not a dm");
  });

  it("delivers to all agent members when the operator posts", () => {
    const store = fakeStore([mk("user", "user"), mk("raynor", "agent"), mk("kerrigan", "agent")]);

    const delivered = deliverChannelPostToAgents(store, { channelId: "chan-1", senderId: "user", body: "hi" });

    expect(delivered.sort()).toEqual(["kerrigan", "raynor"]);
    expect(sendInput).toHaveBeenCalledTimes(2);
  });

  it("returns empty (no throw) when the channel has no members", () => {
    const store = fakeStore([]);
    expect(deliverChannelPostToAgents(store, { channelId: "chan-1", senderId: "user", body: "x" })).toEqual([]);
    expect(sendInput).not.toHaveBeenCalled();
  });
});

describe("formatChannelInjection", () => {
  it("includes channel title, sender, body, and room-reply instructions", () => {
    const text = formatChannelInjection({
      channelTitle: "ops",
      channelId: "chan-1",
      senderId: "raynor",
      body: "deploy done",
      memberIds: ["user", "raynor", "kerrigan"],
    });
    expect(text).toContain("#ops");
    expect(text).toContain("from raynor");
    expect(text).toContain("deploy done");
    expect(text).toContain('conversationId="chan-1"');
    expect(text).toContain("kerrigan");
  });
});
