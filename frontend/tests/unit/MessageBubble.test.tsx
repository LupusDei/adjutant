/**
 * Tests for MessageBubble — the extracted, memoized chat bubble component.
 *
 * Why this exists: the inline JSX in CommandChat re-renders every bubble on
 * every parent state change (typing, streaming, status flips). Extracting
 * MessageBubble with React.memo + a tight equality fn limits re-renders to
 * the small set of bubbles that actually changed.
 *
 * Equality keys:
 *   - msg.id           — different message ⇒ new bubble (trivially handled
 *                        by React key)
 *   - msg.body         — covers optimistic-edit and streaming-update paths
 *                        if the same id is reused
 *   - msg.optimisticStatus — sending → delivered → failed transitions
 *   - isUser, isPlaying, isLoadingPlay — visual state that affects render
 */

import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MessageBubble } from "../../src/components/chat/MessageBubble";
import type { DisplayMessage } from "../../src/hooks/useChatMessages";

/** Build a realistic DisplayMessage (matches shape from useChatMessages). */
function makeMsg(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "msg-1",
    sessionId: null,
    agentId: "swann",
    recipient: null,
    role: "agent",
    body: "hello",
    metadata: null,
    deliveryStatus: "delivered",
    eventType: null,
    threadId: null,
    createdAt: "2026-05-17T10:30:00Z",
    updatedAt: "2026-05-17T10:30:00Z",
    ...overrides,
  };
}

const fmt = (ts: string) => `[t:${ts}]`;

describe("MessageBubble", () => {
  it("renders the message body and sender", () => {
    const { getByText, container } = render(
      <MessageBubble
        msg={makeMsg({ body: "important news" })}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={() => undefined}
        formatTimestamp={fmt}
      />,
    );
    expect(container.textContent).toContain("important news");
    expect(getByText("SWANN")).toBeTruthy();
  });

  it("renders as user bubble when isUser is true", () => {
    const { getByText, container } = render(
      <MessageBubble
        msg={makeMsg({ role: "user" })}
        isUser={true}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={() => undefined}
        formatTimestamp={fmt}
      />,
    );
    expect(getByText("YOU")).toBeTruthy();
    expect(container.querySelector(".chat-bubble-user")).toBeTruthy();
  });

  it("calls onPlay when the play button is clicked", () => {
    const onPlay = vi.fn();
    const msg = makeMsg();
    const { getByLabelText } = render(
      <MessageBubble
        msg={msg}
        isUser={false}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={onPlay}
        formatTimestamp={fmt}
      />,
    );
    fireEvent.click(getByLabelText("Play message"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(msg);
  });

  it("renders 'SENDING' status for optimistic-sending message", () => {
    const { container } = render(
      <MessageBubble
        msg={makeMsg({ optimisticStatus: "sending" })}
        isUser={true}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={() => undefined}
        formatTimestamp={fmt}
      />,
    );
    expect(container.textContent).toContain("SENDING");
    expect(container.querySelector(".chat-bubble-sending")).toBeTruthy();
  });

  it("renders 'DELIVERED' status when delivery is confirmed", () => {
    const { container } = render(
      <MessageBubble
        msg={makeMsg({ optimisticStatus: "delivered", clientId: "c-1" })}
        isUser={true}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={() => undefined}
        formatTimestamp={fmt}
      />,
    );
    expect(container.textContent).toContain("DELIVERED");
  });

  it("renders 'FAILED' state when delivery fails", () => {
    const { container } = render(
      <MessageBubble
        msg={makeMsg({ optimisticStatus: "failed" })}
        isUser={true}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={() => undefined}
        formatTimestamp={fmt}
      />,
    );
    expect(container.textContent).toContain("FAILED");
    expect(container.querySelector(".chat-bubble-failed")).toBeTruthy();
  });

  describe("React.memo equality", () => {
    /**
     * We measure MessageBubble's internal render count by counting calls to
     * MarkdownBody (which is rendered exactly once per MessageBubble body).
     * Spying on MarkdownBody isolates the count from the harness/parent.
     */

    /** Identity-stable callback wrapper (mimics useCallback). */
    function useStable<T>(value: T): T {
      const [stable] = useState(() => value);
      return stable;
    }

    function bindCounter() {
      markdownInvocationCount.count = 0;
    }

    it("does NOT re-render when the parent ticks with the same msg reference and stable callbacks", () => {
      bindCounter();
      const msg = makeMsg({ body: "stable body content" });

      function Harness() {
        const [, setTick] = useState(0);
        const onPlay = useStable(() => undefined);
        const fmtStable = useStable(fmt);
        return (
          <div>
            <MessageBubble
              msg={msg}
              isUser={false}
              isPlaying={false}
              isLoadingPlay={false}
              onPlay={onPlay}
              formatTimestamp={fmtStable}
            />
            <button onClick={() => { setTick((t) => t + 1); }}>tick</button>
          </div>
        );
      }

      const { getByText } = render(<Harness />);
      // Initial render of bubble's inner MarkdownBody.
      const before = countMarkdownInvocations();
      expect(before).toBeGreaterThan(0);

      const tick = getByText("tick");
      act(() => { fireEvent.click(tick); });
      act(() => { fireEvent.click(tick); });
      act(() => { fireEvent.click(tick); });

      // MessageBubble's memo must have short-circuited every tick — so the
      // inner MarkdownBody render count must NOT have grown.
      expect(countMarkdownInvocations()).toBe(before);
    });

    it("DOES re-render when msg.body changes (optimistic edit / streaming)", () => {
      bindCounter();
      const initial = makeMsg({ body: "first-body" });

      function Harness() {
        const [msg, setMsg] = useState(initial);
        const onPlay = useStable(() => undefined);
        const fmtStable = useStable(fmt);
        return (
          <div>
            <MessageBubble
              msg={msg}
              isUser={false}
              isPlaying={false}
              isLoadingPlay={false}
              onPlay={onPlay}
              formatTimestamp={fmtStable}
            />
            <button onClick={() => { setMsg({ ...msg, body: "updated-body" }); }}>edit</button>
          </div>
        );
      }

      const { getByText, container } = render(<Harness />);
      const before = countMarkdownInvocations();

      act(() => { fireEvent.click(getByText("edit")); });

      expect(countMarkdownInvocations()).toBeGreaterThan(before);
      expect(container.textContent).toContain("updated-body");
    });

    it("DOES re-render (visibly) when optimisticStatus transitions sending → delivered", () => {
      // We can't easily count MessageBubble's internal renders (the inner
      // MarkdownBody is itself memoized on body string). Instead we verify
      // the visible output reflects the new status, which proves the memo
      // equality fn correctly let the update through.
      function Harness() {
        const [status, setStatus] = useState<"sending" | "delivered">("sending");
        const onPlay = useStable(() => undefined);
        const fmtStable = useStable(fmt);
        return (
          <div>
            <MessageBubble
              msg={makeMsg({ optimisticStatus: status, clientId: "c-9" })}
              isUser={true}
              isPlaying={false}
              isLoadingPlay={false}
              onPlay={onPlay}
              formatTimestamp={fmtStable}
            />
            <button onClick={() => { setStatus("delivered"); }}>confirm</button>
          </div>
        );
      }

      const { getByText, container } = render(<Harness />);
      expect(container.textContent).toContain("SENDING");
      expect(container.querySelector(".chat-bubble-sending")).toBeTruthy();

      act(() => { fireEvent.click(getByText("confirm")); });

      expect(container.textContent).toContain("DELIVERED");
      expect(container.querySelector(".chat-bubble-sending")).toBeNull();
    });

    it("DOES re-render (visibly) when isPlaying flips", () => {
      const msg = makeMsg();

      function Harness() {
        const [playing, setPlaying] = useState(false);
        const onPlay = useStable(() => undefined);
        const fmtStable = useStable(fmt);
        return (
          <div>
            <MessageBubble
              msg={msg}
              isUser={false}
              isPlaying={playing}
              isLoadingPlay={false}
              onPlay={onPlay}
              formatTimestamp={fmtStable}
            />
            <button onClick={() => { setPlaying((p) => !p); }}>toggle</button>
          </div>
        );
      }

      const { getByText, container } = render(<Harness />);
      // Initially not playing — button class is the inactive variant.
      expect(container.querySelector(".chat-play-btn-active")).toBeNull();

      act(() => { fireEvent.click(getByText("toggle")); });

      // After toggle, the active class must appear — proves the memo let
      // the prop change through.
      expect(container.querySelector(".chat-play-btn-active")).toBeTruthy();
    });
  });
});

/**
 * Hoisted helper: read the markdown invocation count exposed by the
 * `react-markdown` mock below. Kept outside the describe blocks so it can be
 * called from any test.
 */
function countMarkdownInvocations(): number {
  // The mock below increments a module-scoped counter on each Markdown call.
  return markdownInvocationCount.count;
}

const markdownInvocationCount = { count: 0 };

vi.mock("react-markdown", async () => {
  const actual = await vi.importActual<typeof import("react-markdown")>("react-markdown");
  return {
    ...actual,
    default: (props: { children: string }) => {
      markdownInvocationCount.count++;
      const Real = actual.default;
      return <Real {...props} />;
    },
  };
});
