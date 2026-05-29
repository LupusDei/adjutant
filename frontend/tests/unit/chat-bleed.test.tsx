/**
 * Wrong-thread message-bleed regression (adj-164.2.3).
 *
 * Bug: the old chat data layer reconstructed a 1:1 conversation by widening on
 * `agentId` (REST `api.messages.list({agentId})` + a WS filter keyed on the
 * sender/recipient agent name). Messages leaked across what the user perceived
 * as separate conversations.
 *
 * Root-cause fix: scope strictly by `conversationId`. These tests are the guard
 * rail — they FAIL if anyone reintroduces agent-widening, and they assert the
 * stale REST path (`api.messages.list`) is never called by the chat layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useChatMessages } from "../../src/hooks/useChatMessages";
import type { ChatMessage, Conversation, PaginatedResponse } from "../../src/types";

// The mock api intentionally OMITS messages.list — if the hook ever reaches for
// the stale agent-widened path, the call throws and the test fails loudly.
const { mockGetDm, mockListMessages, mockSend, mockMarkRead } = vi.hoisted(() => ({
  mockGetDm: vi.fn(),
  mockListMessages: vi.fn(),
  mockSend: vi.fn(),
  mockMarkRead: vi.fn(),
}));

vi.mock("../../src/services/api", () => {
  const apiObj = {
    conversations: { getDm: mockGetDm, listMessages: mockListMessages },
    messages: {
      send: mockSend,
      markRead: mockMarkRead,
      // Deliberately a tripwire: the chat layer must NOT use this anymore.
      list: vi.fn(() => {
        throw new Error("BLEED: chat layer used the stale agent-widened messages.list");
      }),
    },
  };
  return { api: apiObj, default: apiObj };
});

let subscriber: ((msg: unknown) => void) | undefined;
vi.mock("../../src/contexts/CommunicationContext", () => ({
  useCommunicationActions: () => ({
    subscribe: vi.fn((cb: unknown) => {
      subscriber = cb as (msg: unknown) => void;
      return vi.fn();
    }),
  }),
}));

import { api } from "../../src/services/api";

const DM: Record<string, string> = { raynor: "dm_raynor", kerrigan: "dm_kerrigan" };

function dm(agentId: string): Conversation {
  return {
    id: DM[agentId]!,
    kind: "dm",
    title: null,
    archived: false,
    createdAt: "2026-05-17T09:00:00Z",
    updatedAt: "2026-05-17T09:00:00Z",
  };
}

function msg(id: string, agentId: string, body: string, conversationId: string): ChatMessage {
  return {
    id,
    sessionId: null,
    agentId,
    recipient: "user",
    role: "agent",
    body,
    metadata: null,
    deliveryStatus: "delivered",
    eventType: null,
    threadId: null,
    conversationId,
    createdAt: "2026-05-17T10:00:00Z",
    updatedAt: "2026-05-17T10:00:00Z",
  };
}

const RAYNOR = [msg("r1", "raynor", "raynor only", "dm_raynor")];
const KERRIGAN = [msg("k1", "kerrigan", "kerrigan only", "dm_kerrigan")];

beforeEach(() => {
  vi.clearAllMocks();
  subscriber = undefined;
  mockGetDm.mockImplementation((a: string) => Promise.resolve(dm(a)));
  mockListMessages.mockImplementation((id: string) =>
    Promise.resolve<PaginatedResponse<ChatMessage>>({
      items: id === "dm_raynor" ? RAYNOR : KERRIGAN,
      total: 1,
      hasMore: false,
    }),
  );
});

describe("chat bleed regression", () => {
  it("never carries one agent's messages into another when switching", async () => {
    const { result, rerender } = renderHook(
      ({ agentId }: { agentId: string }) => useChatMessages(agentId),
      { initialProps: { agentId: "raynor" } },
    );

    await waitFor(() => {
      expect(result.current.messages.map((m) => m.body)).toEqual(["raynor only"]);
    });

    act(() => { rerender({ agentId: "kerrigan" }); });

    await waitFor(() => {
      expect(result.current.messages.map((m) => m.body)).toEqual(["kerrigan only"]);
    });
    expect(result.current.messages.map((m) => m.body)).not.toContain("raynor only");
  });

  it("drops a real-time message addressed to a different conversation", async () => {
    const { result } = renderHook(() => useChatMessages("raynor"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // A live message for kerrigan's conversation must never appear in raynor's.
    act(() => {
      subscriber?.({
        id: "k-live",
        from: "kerrigan",
        to: "user",
        body: "kerrigan live",
        timestamp: "2026-05-17T10:05:00Z",
        conversationId: "dm_kerrigan",
      });
    });

    expect(result.current.messages.map((m) => m.body)).not.toContain("kerrigan live");
    expect(result.current.messages).toHaveLength(1);
  });

  it("accepts a real-time message for the open conversation", async () => {
    const { result } = renderHook(() => useChatMessages("raynor"));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    act(() => {
      subscriber?.({
        id: "r-live",
        from: "raynor",
        to: "user",
        body: "raynor live",
        timestamp: "2026-05-17T10:05:00Z",
        conversationId: "dm_raynor",
      });
    });

    expect(result.current.messages.map((m) => m.body)).toContain("raynor live");
  });

  it("never calls the stale agent-widened messages.list path", async () => {
    const { rerender } = renderHook(
      ({ agentId }: { agentId: string }) => useChatMessages(agentId),
      { initialProps: { agentId: "raynor" } },
    );
    await waitFor(() => { expect(mockGetDm).toHaveBeenCalledWith("raynor"); });

    act(() => { rerender({ agentId: "kerrigan" }); });
    await waitFor(() => { expect(mockGetDm).toHaveBeenCalledWith("kerrigan"); });

    expect(api.messages.list).not.toHaveBeenCalled();
  });
});
