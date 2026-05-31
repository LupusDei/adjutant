/**
 * messageRow — alignment-row classification for the chat timeline (adj-mw7lc).
 *
 * Each message in the virtualized timeline must be wrapped in a flex-column
 * "row" so the bubble's alignment resolves. react-virtuoso wraps every item in
 * a plain (non-flex) div, which means a bubble's own `align-self: flex-end`
 * (user) / `flex-start` (agent) never takes effect — leaving user and agent
 * messages both left-aligned, distinguished only by colour. Wrapping each item
 * in `.chat-msg-row` (a flex column whose `align-items` is driven by the
 * `-user` / `-agent` / `-system` modifier) restores SMS-style alignment:
 * the operator's own messages sit on the right, everyone else on the left.
 *
 * Pure and dependency-free so it is trivially unit-testable and can be called
 * from inside Virtuoso's render callback without dragging in component state.
 */

import type { DisplayMessage } from "../../hooks/useChatMessages";

/** Which side of the timeline a message renders on. */
export type MessageRowKind = "user" | "agent" | "system";

/**
 * Classify a message into its alignment row kind.
 *
 * System and announcement rows are centred (they are not attributed bubbles);
 * the operator's own messages are right-aligned; every agent is left-aligned.
 */
export function messageRowKind(msg: DisplayMessage): MessageRowKind {
  if (msg.role === "system" || msg.role === "announcement") return "system";
  if (msg.role === "user") return "user";
  return "agent";
}

/**
 * The full className for a message's alignment row wrapper, e.g.
 * `"chat-msg-row chat-msg-row-user"`.
 */
export function messageRowClass(msg: DisplayMessage): string {
  return `chat-msg-row chat-msg-row-${messageRowKind(msg)}`;
}
