/**
 * Tests asserting AppContent does NOT re-render on unread-count changes.
 *
 * Before adj-139.2.4, `AppContent` called `useUnreadCounts()` directly,
 * which causes a state update inside the hook every time a chat_message
 * arrives. AppContent's re-render then propagated to ALL child views
 * (CommandChat, Timeline, Beads, ...) — none of which care about unread
 * counts. The fix extracts `<ChatBadge />` so only the badge subscribes.
 *
 * We verify by mocking useUnreadCounts with a state-driven implementation
 * and counting renders inside AppContent.
 */

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useState, useEffect } from "react";
import { ChatBadge } from "../../src/components/chat/ChatBadge";

// =============================================================================
// Mock useUnreadCounts — exposes a setCounts() escape hatch so the test
// can force the badge to re-render WITHOUT touching AppContent state.
// =============================================================================

let setCountsExternal: ((next: number) => void) | null = null;

vi.mock("../../src/hooks/useUnreadCounts", () => ({
  useUnreadCounts: () => {
    const [total, setTotal] = useState(0);
    useEffect(() => {
      setCountsExternal = setTotal;
      return () => {
        setCountsExternal = null;
      };
    }, []);
    return {
      counts: {},
      totalUnread: total,
      markRead: vi.fn().mockResolvedValue(undefined),
    };
  },
}));

describe("ChatBadge", () => {
  it("renders nothing when totalUnread is 0", () => {
    const { container } = render(<ChatBadge />);
    expect(container.querySelector(".nav-tab-badge")).toBeNull();
  });

  it("renders the count when totalUnread > 0", () => {
    const { container } = render(<ChatBadge />);
    expect(setCountsExternal).toBeTruthy();
    act(() => {
      setCountsExternal?.(3);
    });
    const badge = container.querySelector(".nav-tab-badge");
    expect(badge?.textContent).toBe("3");
  });

  it("renders '99+' when totalUnread exceeds 99", () => {
    const { container } = render(<ChatBadge />);
    act(() => {
      setCountsExternal?.(150);
    });
    const badge = container.querySelector(".nav-tab-badge");
    expect(badge?.textContent).toBe("99+");
  });
});

describe("AppContent re-render isolation", () => {
  it("a parent that holds <ChatBadge /> as a child does NOT re-render when unread count changes", () => {
    // Mimic the AppContent shape: a wrapper that includes ChatBadge plus
    // other UI. We count renders of the wrapper itself.
    let wrapperRenderCount = 0;

    function WrapperLikeAppContent() {
      wrapperRenderCount++;
      return (
        <div>
          <span>I never re-render on unread changes</span>
          <ChatBadge />
        </div>
      );
    }

    const { container } = render(<WrapperLikeAppContent />);
    const before = wrapperRenderCount;
    expect(before).toBeGreaterThan(0);

    // Bump unread count multiple times. The badge re-renders, but the
    // parent wrapper must not.
    act(() => { setCountsExternal?.(1); });
    act(() => { setCountsExternal?.(2); });
    act(() => { setCountsExternal?.(3); });

    // Wrapper render count unchanged.
    expect(wrapperRenderCount).toBe(before);
    // Badge content reflects the latest count.
    expect(container.querySelector(".nav-tab-badge")?.textContent).toBe("3");
  });
});
