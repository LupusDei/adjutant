/**
 * ChatBadge — the unread-count badge that lives on the CHAT nav tab.
 *
 * Why this component exists
 * --------------------------
 * Previously `useUnreadCounts()` was called directly from `AppContent`.
 * Every incoming chat_message bumped the hook's internal state, which
 * forced AppContent to re-render — and that propagated to every tab
 * view (CommandChat, BeadsView, TimelineView, …) even though none of
 * those views care about the unread count. The result was hundreds of
 * unnecessary re-renders on every WS message.
 *
 * Extracting `<ChatBadge />` as the sole subscriber to
 * `useUnreadCounts()` scopes the re-render to this tiny component.
 * AppContent stays stable; only the badge re-paints.
 */

import React from "react";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";

/**
 * Render the chat unread-count badge. Returns `null` when there are no
 * unread messages, otherwise renders a small pill with the count (capped
 * at "99+" so the badge doesn't visually grow without bound).
 */
export const ChatBadge = React.memo(function ChatBadge() {
  const { totalUnread } = useUnreadCounts();
  if (totalUnread <= 0) return null;
  return (
    <span className="nav-tab-badge">
      {totalUnread > 99 ? "99+" : totalUnread}
    </span>
  );
});
