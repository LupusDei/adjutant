/**
 * Tests for CommandChat scroll-to-bottom behavior.
 *
 * The old effect dependency list was [messages, streamingMessages,
 * scrollToBottom] — but `streamingMessages` is a Map (new reference every
 * render), and CommandChat re-renders on every input keystroke. That
 * caused `scrollToBottom` to fire on every keystroke even when no message
 * arrived.
 *
 * After the fix:
 *   - Effect deps narrow to [messages.length, streamingMessages.size] so
 *     reference churn no longer triggers it.
 *   - Multiple firings within a 100ms window collapse to one
 *     scrollIntoView call via requestAnimationFrame batching.
 *
 * We assert behavior by mocking useChatMessages and counting calls to
 * Element.prototype.scrollIntoView.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { CommandChat } from "../../src/components/chat/CommandChat";
import type { DisplayMessage } from "../../src/hooks/useChatMessages";

// =============================================================================
// Mocks — keep CommandChat in isolation. We control the messages array and
// the websocket/voice surface area so the scroll effect is the only thing
// under test.
// =============================================================================

let mockMessages: DisplayMessage[] = [];
const setMockMessages = (next: DisplayMessage[]) => {
  mockMessages = next;
};

let mockMessagesVersion = 0;
function bumpMessagesVersion() {
  mockMessagesVersion++;
}

vi.mock("../../src/hooks/useChatMessages", async () => {
  const actual = await vi.importActual<typeof import("../../src/hooks/useChatMessages")>(
    "../../src/hooks/useChatMessages",
  );
  return {
    ...actual,
    useChatMessages: () => ({
      messages: mockMessages,
      isLoading: false,
      error: null,
      hasMore: false,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      addOptimistic: vi.fn(),
      confirmDelivery: vi.fn(),
      markFailed: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      // version field is read in derived state — bumping causes re-renders
      __version: mockMessagesVersion,
    }),
  };
});

vi.mock("../../src/hooks/useUnreadCounts", () => ({
  useUnreadCounts: () => ({
    counts: {},
    totalUnread: 0,
    markRead: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../src/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isRecording: false,
    isProcessing: false,
    transcript: "",
    error: null,
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn(),
    clearTranscript: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useVoicePlayer", () => ({
  useVoicePlayer: () => ({
    isPlaying: false,
    isLoading: false,
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useChatWebSocket", () => ({
  useChatWebSocket: () => ({
    connected: false,
    connectionStatus: "polling",
    sendTyping: vi.fn(),
  }),
}));

vi.mock("../../src/contexts/CommunicationContext", async () => {
  const actual = await vi.importActual<typeof import("../../src/contexts/CommunicationContext")>(
    "../../src/contexts/CommunicationContext",
  );
  return {
    ...actual,
    useCommunication: () => ({
      priority: "polling-only",
      setPriority: vi.fn(),
      connectionStatus: "polling",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => undefined),
      subscribeTimeline: vi.fn(() => () => undefined),
    }),
  };
});

// =============================================================================
// Tooling
// =============================================================================

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockMessages = [];
  mockMessagesVersion = 0;
  // jsdom doesn't implement scrollIntoView. Define it so CommandChat's
  // messagesEndRef.current?.scrollIntoView() doesn't throw, AND replace it
  // with a spy on every test so we can count calls.
  scrollSpy = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollSpy,
  });
});

afterEach(() => {
  // Remove our shim so it doesn't leak across files.
  // (Element.prototype.scrollIntoView is undefined by default in jsdom.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  delete (Element.prototype as any).scrollIntoView;
  vi.useRealTimers();
});

function makeMsg(id: string, body = `body-${id}`): DisplayMessage {
  return {
    id,
    sessionId: null,
    agentId: "swann",
    recipient: null,
    role: "agent",
    body,
    metadata: null,
    deliveryStatus: "delivered",
    eventType: null,
    threadId: null,
    createdAt: "2026-05-17T10:30:00Z",
    updatedAt: "2026-05-17T10:30:00Z",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("CommandChat scroll-to-bottom", () => {
  it("does NOT trigger scrollIntoView when the user types in the input", async () => {
    setMockMessages([makeMsg("m1"), makeMsg("m2")]);

    const { container } = render(<CommandChat isActive={true} />);

    // Wait for any initial scroll calls to settle (initial render fires one).
    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    const baseline = scrollSpy.mock.calls.length;

    // Type 10 characters.
    const input = container.querySelector<HTMLInputElement>("input.chat-input");
    expect(input).toBeTruthy();
    if (!input) throw new Error("input not found");

    for (let i = 0; i < 10; i++) {
      act(() => {
        fireEvent.change(input, { target: { value: "a".repeat(i + 1) } });
      });
    }

    // Flush any pending RAF/timeouts.
    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    // No new scroll calls — typing must not fire the scroll effect.
    expect(scrollSpy.mock.calls.length).toBe(baseline);
  });

  it("DOES trigger scrollIntoView when a new message is appended", async () => {
    setMockMessages([makeMsg("m1")]);

    const { rerender } = render(<CommandChat isActive={true} />);

    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    const baseline = scrollSpy.mock.calls.length;

    // Append a new message and re-render.
    setMockMessages([makeMsg("m1"), makeMsg("m2")]);
    bumpMessagesVersion();
    rerender(<CommandChat isActive={true} />);

    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    expect(scrollSpy.mock.calls.length).toBeGreaterThan(baseline);
  });

  it("collapses bursts of message arrivals into a single scroll call per RAF batch", async () => {
    setMockMessages([makeMsg("m1")]);

    const { rerender } = render(<CommandChat isActive={true} />);

    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    const baseline = scrollSpy.mock.calls.length;

    // Burst: append 5 messages synchronously (each rerender within same
    // RAF tick). The debounced scroll should fire once per RAF, not 5x.
    act(() => {
      setMockMessages([makeMsg("m1"), makeMsg("m2")]);
      bumpMessagesVersion();
      rerender(<CommandChat isActive={true} />);

      setMockMessages([makeMsg("m1"), makeMsg("m2"), makeMsg("m3")]);
      bumpMessagesVersion();
      rerender(<CommandChat isActive={true} />);

      setMockMessages([makeMsg("m1"), makeMsg("m2"), makeMsg("m3"), makeMsg("m4")]);
      bumpMessagesVersion();
      rerender(<CommandChat isActive={true} />);

      setMockMessages([
        makeMsg("m1"),
        makeMsg("m2"),
        makeMsg("m3"),
        makeMsg("m4"),
        makeMsg("m5"),
      ]);
      bumpMessagesVersion();
      rerender(<CommandChat isActive={true} />);

      setMockMessages([
        makeMsg("m1"),
        makeMsg("m2"),
        makeMsg("m3"),
        makeMsg("m4"),
        makeMsg("m5"),
        makeMsg("m6"),
      ]);
      bumpMessagesVersion();
      rerender(<CommandChat isActive={true} />);
    });

    await act(async () => {
      await new Promise<void>((r) => { requestAnimationFrame(() => { r(); }); });
    });

    // With RAF batching, at most a handful of scrollIntoView calls should
    // have fired (typically 1 or 2 — React batches updates per RAF tick).
    // The OLD code (without RAF batching) would fire 5+ times.
    const newCalls = scrollSpy.mock.calls.length - baseline;
    expect(newCalls).toBeLessThanOrEqual(2);
  });
});
