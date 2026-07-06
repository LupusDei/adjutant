/**
 * Attachment delivery service (adj-203.3.1 / T008 — US2).
 *
 * The single decision + delivery point for pushing Commander screenshots into a
 * target agent's live tmux pane. Given a persisted message (with its hydrated
 * attachments) and the recipient, it injects the image's ABSOLUTE path(s) — so the
 * agent's Claude can `Read` and "see" the screenshot — ONLY when ALL of:
 *
 *   1. the conversation is a DM (deterministic `dm_`-prefixed id, conversation-store),
 *   2. the non-user member (the recipient) is an agent (not the user), and
 *   3. the agent has ≥1 ONLINE session, and
 *   4. the message carries ≥1 image attachment.
 *
 * Anything else — non-DM, agent offline/unknown, no image — is a graceful no-op.
 *
 * Delivery is best-effort and post-persist: this function MUST NOT throw into its
 * caller (the send path). It reuses `InputRouter.sendInput` (the proven two-phase
 * tmux paste, adj-53kf/adj-twhj) — no new tmux primitive — and resolves the agent's
 * session(s) via `SessionRegistry`. Both are injected so the unit is fully mockable.
 */

import type { MessageAttachment } from "./attachment-store.js";
import type { Message } from "./message-store.js";
import type { SessionRegistry } from "./session-registry.js";
import type { InputRouter } from "./input-router.js";
import { logInfo, logWarn } from "../utils/index.js";

/** Deterministic DM conversation ids are prefixed `dm_` (see dmConversationId). */
const DM_ID_PREFIX = "dm_";

/** Legacy alias for the Commander/user in the DM peer space. */
const USER_ALIAS = "mayor/";

export interface AttachmentDeliveryDeps {
  registry: Pick<SessionRegistry, "findByName">;
  inputRouter: Pick<InputRouter, "sendInput">;
}

export interface AttachmentDeliveryInput {
  /** The persisted message — needs conversationId, body, recipient, and hydrated attachments. */
  message: Pick<Message, "conversationId" | "body" | "recipient" | "attachments">;
  /** Target agent name. Defaults to `message.recipient` when omitted. */
  recipient?: string | null | undefined;
}

export type AttachmentDeliverySkipReason =
  | "not-dm"
  | "no-agent-recipient"
  | "no-image"
  | "offline-or-unknown"
  | "error";

export interface AttachmentDeliveryResult {
  /** True iff at least one online session received the injected prompt. */
  injected: boolean;
  /** Why nothing was injected (absent on success). */
  reason?: AttachmentDeliverySkipReason;
  /** Number of image attachments considered. */
  imageCount: number;
  /** Number of online sessions we attempted to inject into. */
  sessionsTargeted: number;
  /** Number of sessions that accepted the injection. */
  sessionsDelivered: number;
}

/**
 * Build the tmux injection prompt. Format:
 *
 *   [Commander shared N screenshot(s) — please review]
 *   <abs path 1>
 *   <abs path 2>
 *   <body>
 *
 * The body line is appended only when the Commander included non-empty text.
 */
function buildInjectionPrompt(images: MessageAttachment[], body: string | null | undefined): string {
  const n = images.length;
  const header = `[Commander shared ${n} screenshot${n === 1 ? "" : "s"} — please review]`;
  const lines = [header, ...images.map((img) => img.storagePath)];
  const trimmed = (body ?? "").trim();
  if (trimmed.length > 0) lines.push(trimmed);
  return lines.join("\n");
}

function skip(
  reason: AttachmentDeliverySkipReason,
  imageCount = 0,
  sessionsTargeted = 0,
): AttachmentDeliveryResult {
  return { injected: false, reason, imageCount, sessionsTargeted, sessionsDelivered: 0 };
}

/**
 * Inject the Commander's screenshot(s) into the target agent's live session(s).
 * Best-effort, never throws — see file docstring for the full decision matrix.
 */
export async function deliverImageAttachments(
  deps: AttachmentDeliveryDeps,
  input: AttachmentDeliveryInput,
): Promise<AttachmentDeliveryResult> {
  try {
    const { message } = input;

    // (1) DM only — channels / broadcast fan-out are out of scope for this epic.
    if (!message.conversationId?.startsWith(DM_ID_PREFIX)) {
      return skip("not-dm");
    }

    // (2) The non-user member is the recipient agent. "mayor/" is the legacy user alias.
    const rawRecipient = input.recipient ?? message.recipient;
    const recipient = rawRecipient === USER_ALIAS ? "user" : rawRecipient;
    if (recipient === null || recipient === "user") {
      return skip("no-agent-recipient");
    }

    // (4) ≥1 image attachment (checked before session lookup — cheap short-circuit).
    const images = (message.attachments ?? []).filter((a) => a.kind === "image");
    if (images.length === 0) {
      return skip("no-image");
    }

    // (3) Resolve the agent's ONLINE session(s). Offline/unknown → skip.
    const online = deps.registry.findByName(recipient).filter((s) => s.status !== "offline");
    if (online.length === 0) {
      return skip("offline-or-unknown", images.length);
    }

    const prompt = buildInjectionPrompt(images, message.body);
    let delivered = 0;
    for (const session of online) {
      const ok = await deps.inputRouter.sendInput(session.id, prompt);
      if (ok) delivered++;
    }

    logInfo("screenshot attachments injected into agent pane", {
      agent: recipient,
      images: images.length,
      sessionsTargeted: online.length,
      sessionsDelivered: delivered,
    });

    return {
      injected: delivered > 0,
      imageCount: images.length,
      sessionsTargeted: online.length,
      sessionsDelivered: delivered,
    };
  } catch (err) {
    // Best-effort: a failure here must never break the message-send path.
    logWarn("attachment delivery failed (swallowed)", { error: String(err) });
    return skip("error");
  }
}
