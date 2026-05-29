/**
 * Tests for CommandChat message grouping + bubble rendering (adj-164.2.2).
 *
 * Two behaviors, both regression-prone:
 *   1. Same-sender run grouping — consecutive messages from the same sender
 *      collapse: only the FIRST in a run shows the sender label, only the
 *      LAST shows the timestamp, and within-run spacing is tighter than
 *      between-run spacing. We test the pure `computeMessageGroups` helper
 *      (the load-bearing logic) directly.
 *   2. MessageBubble honors the grouping flags — hides the sender header and
 *      timestamp when told to.
 *
 * (Auto-scroll-only-when-at-bottom is covered behaviorally in
 * CommandChat.scroll.test.tsx, which counts scrollIntoView calls.)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { computeMessageGroups } from "../../src/components/chat/messageGrouping";
import { MessageBubble } from "../../src/components/chat/MessageBubble";
import type { DisplayMessage } from "../../src/hooks/useChatMessages";

function msg(
  id: string,
  sender: "user" | string,
  createdAt = "2026-05-17T10:30:00Z",
): DisplayMessage {
  const isUser = sender === "user";
  return {
    id,
    sessionId: null,
    agentId: isUser ? "user" : sender,
    recipient: isUser ? "raynor" : "user",
    role: isUser ? "user" : "agent",
    body: `body-${id}`,
    metadata: null,
    deliveryStatus: "delivered",
    eventType: null,
    threadId: null,
    conversationId: "dm_x",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("computeMessageGroups", () => {
  it("returns an empty map for no messages", () => {
    expect(computeMessageGroups([])).toEqual(new Map());
  });

  it("marks a lone message as both first and last in its group", () => {
    const groups = computeMessageGroups([msg("a", "raynor")]);
    expect(groups.get("a")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });

  it("groups a run of same-sender messages: first shows header, last shows time", () => {
    const groups = computeMessageGroups([
      msg("a1", "raynor"),
      msg("a2", "raynor"),
      msg("a3", "raynor"),
    ]);
    expect(groups.get("a1")).toEqual({ isFirstInGroup: true, isLastInGroup: false });
    expect(groups.get("a2")).toEqual({ isFirstInGroup: false, isLastInGroup: false });
    expect(groups.get("a3")).toEqual({ isFirstInGroup: false, isLastInGroup: true });
  });

  it("starts a new group when the sender changes", () => {
    const groups = computeMessageGroups([
      msg("a1", "raynor"),
      msg("u1", "user"),
      msg("a2", "raynor"),
    ]);
    expect(groups.get("a1")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
    expect(groups.get("u1")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
    expect(groups.get("a2")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });

  it("treats different agents as different senders even when both are agents", () => {
    const groups = computeMessageGroups([
      msg("a1", "raynor"),
      msg("k1", "kerrigan"),
    ]);
    expect(groups.get("a1")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
    expect(groups.get("k1")).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });
});

describe("MessageBubble grouping flags", () => {
  const noop = () => undefined;
  const fmt = (t: string) => t;

  it("shows the sender label when showSender is true", () => {
    const { container } = render(
      <MessageBubble
        msg={msg("a", "raynor")}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={noop}
        formatTimestamp={fmt}
        showSender={true}
        showTime={true}
      />,
    );
    expect(container.querySelector(".chat-bubble-sender")).not.toBeNull();
  });

  it("hides the sender label for a continued same-sender message", () => {
    const { container } = render(
      <MessageBubble
        msg={msg("a", "raynor")}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={noop}
        formatTimestamp={fmt}
        showSender={false}
        showTime={true}
      />,
    );
    expect(container.querySelector(".chat-bubble-sender")).toBeNull();
  });

  it("hides the timestamp for a non-final message in a run", () => {
    const { container } = render(
      <MessageBubble
        msg={msg("a", "raynor")}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={noop}
        formatTimestamp={fmt}
        showSender={true}
        showTime={false}
      />,
    );
    expect(container.querySelector(".chat-bubble-time")).toBeNull();
  });

  it("applies a grouped class to continued messages for tighter spacing", () => {
    const { container } = render(
      <MessageBubble
        msg={msg("a", "raynor")}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={noop}
        formatTimestamp={fmt}
        showSender={false}
        showTime={true}
      />,
    );
    expect(container.querySelector(".chat-bubble-grouped")).not.toBeNull();
  });
});
