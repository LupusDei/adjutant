/**
 * MessageBubble — a single chat message rendered as an SMS-style bubble.
 *
 * Extracted from CommandChat so the bubble can be wrapped in `React.memo`
 * with a tight equality function. Without this extraction, every keystroke
 * in the input box (which lives in CommandChat) forced React to re-render
 * the entire message list — hundreds of bubbles, hundreds of markdown
 * re-parses, every keystroke. That was the dominant cause of the 30s+
 * keystroke latency reported in adj-139.
 *
 * Equality keys:
 *   - msg.id, msg.body, msg.optimisticStatus  (message-level changes)
 *   - isUser, isPlaying, isLoadingPlay        (visual state)
 *   - onPlay, formatTimestamp                 (stable refs expected)
 *
 * If the caller passes inline lambdas for onPlay or a non-stable formatter,
 * the memo will still fire — keep callbacks behind useCallback / module
 * constants in the parent.
 */

import React from "react";
import { MarkdownBody } from "./MarkdownBody";
import { MessageAttachments } from "./MessageAttachments";
import type { DisplayMessage } from "../../hooks/useChatMessages";

/** Stable join of attachment ids, for memo equality. */
function attachmentKey(msg: DisplayMessage): string {
  return (msg.attachments ?? []).map((a) => a.id).join(",");
}

export interface MessageBubbleProps {
  /** The message to render. */
  msg: DisplayMessage;
  /** Whether the sender is the local user (controls bubble alignment + label). */
  isUser: boolean;
  /** Whether voice playback is active for this specific message. */
  isPlaying: boolean;
  /** Whether voice playback for this message is currently loading. */
  isLoadingPlay: boolean;
  /** Called when the user clicks the play/stop button. */
  onPlay: (msg: DisplayMessage) => void;
  /** Format an ISO timestamp string for display. Should be a stable reference. */
  formatTimestamp: (timestamp: string) => string;
  /**
   * Whether to render the sender callsign header. False for a continued
   * message in a same-sender run (adj-164.2.2 grouping). Defaults to true.
   */
  showSender?: boolean;
  /**
   * Whether to render the timestamp / delivery status footer. False for a
   * non-final message in a run. Defaults to true.
   */
  showTime?: boolean;
}

function MessageBubbleImpl({
  msg,
  isUser,
  isPlaying,
  isLoadingPlay,
  onPlay,
  formatTimestamp,
  showSender = true,
  showTime = true,
}: MessageBubbleProps) {
  const isSending = msg.optimisticStatus === "sending";
  const isDelivered = msg.optimisticStatus === "delivered";
  const isFailed = msg.optimisticStatus === "failed";

  // A continued message in a same-sender run (no header) draws closer to the
  // bubble above it. The play button still needs a home when the header is
  // hidden, so it floats top-right via the grouped variant.
  const isGrouped = !showSender;

  return (
    <div
      className={
        `chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-command"}` +
        (isGrouped ? " chat-bubble-grouped" : "") +
        (showTime ? "" : " chat-bubble-run") +
        (isSending ? " chat-bubble-sending" : "") +
        (isFailed ? " chat-bubble-failed" : "")
      }
    >
      {showSender ? (
        <div className="chat-bubble-header">
          <span className="chat-bubble-sender">
            {isUser ? "YOU" : msg.agentId.toUpperCase()}
          </span>
          <button
            type="button"
            className={`chat-play-btn ${isPlaying ? "chat-play-btn-active" : ""}`}
            onClick={() => { onPlay(msg); }}
            disabled={isLoadingPlay}
            aria-label={isPlaying ? "Stop" : "Play message"}
            title={isPlaying ? "Stop" : "Play message"}
          >
            {isLoadingPlay ? "?" : isPlaying ? "||" : ">"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`chat-play-btn chat-play-btn-float ${isPlaying ? "chat-play-btn-active" : ""}`}
          onClick={() => { onPlay(msg); }}
          disabled={isLoadingPlay}
          aria-label={isPlaying ? "Stop" : "Play message"}
          title={isPlaying ? "Stop" : "Play message"}
        >
          {isLoadingPlay ? "?" : isPlaying ? "||" : ">"}
        </button>
      )}
      <div className="chat-bubble-content">
        <MarkdownBody>{msg.body}</MarkdownBody>
      </div>
      <MessageAttachments attachments={msg.attachments} />
      {showTime && (
        <div className="chat-bubble-time">
          {isSending && <span className="chat-delivery-status">SENDING </span>}
          {isDelivered && msg.clientId && (
            <span className="chat-delivery-status chat-delivery-confirmed">DELIVERED </span>
          )}
          {isFailed && (
            <span className="chat-delivery-status chat-delivery-failed">FAILED </span>
          )}
          {formatTimestamp(msg.createdAt)}
        </div>
      )}
    </div>
  );
}

/**
 * Custom equality for `React.memo`. Returns true when the two prop sets are
 * functionally equivalent, allowing React to skip the re-render entirely.
 */
function arePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (prev.msg === next.msg) {
    // Same message reference — only need to check visual / callback props.
  } else {
    // Different reference — compare the message fields that affect render.
    if (prev.msg.id !== next.msg.id) return false;
    if (prev.msg.body !== next.msg.body) return false;
    if (prev.msg.optimisticStatus !== next.msg.optimisticStatus) return false;
    if (prev.msg.clientId !== next.msg.clientId) return false;
    if (prev.msg.agentId !== next.msg.agentId) return false;
    if (prev.msg.createdAt !== next.msg.createdAt) return false;
    if (attachmentKey(prev.msg) !== attachmentKey(next.msg)) return false;
  }
  return (
    prev.isUser === next.isUser &&
    prev.isPlaying === next.isPlaying &&
    prev.isLoadingPlay === next.isLoadingPlay &&
    prev.showSender === next.showSender &&
    prev.showTime === next.showTime &&
    prev.onPlay === next.onPlay &&
    prev.formatTimestamp === next.formatTimestamp
  );
}

export const MessageBubble = React.memo(MessageBubbleImpl, arePropsEqual);
