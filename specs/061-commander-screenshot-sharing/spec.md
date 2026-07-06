# Feature Spec: Commander Screenshot Sharing into Agent TMUX Panes

**Feature ID**: 061-commander-screenshot-sharing
**Root epic**: adj-203
**Priority**: P1
**Platforms**: Backend, Web dashboard, iOS

## Summary

Let the Commander attach one or more screenshots/images to an Adjutant message. When
the message is a **DM addressed to an agent** (a squad leader) and that agent is
**online**, the screenshot is **auto-injected into the agent's Claude Code tmux pane**
immediately — the injected prompt references the image's absolute file path, so the
agent's Claude reads and "sees" the screenshot for live issue-sharing and debugging.
The image is also persisted as a first-class message attachment and rendered inline in
both the web and iOS chat, exactly like any other message.

## Clarified Decisions

- **Delivery**: auto-inject immediately into the target agent's pane on send.
- **Targets (MVP)**: DM → one squad leader only. Channels / broadcast-to-many are
  **out of scope** for this epic (tracked as a future extension).
- **Priority**: P1.
- **Offline target**: if the agent is offline/unknown, the image is still persisted and
  shown in chat; injection is skipped (no error to the Commander) and the outcome logged.

## User Stories

### US1 — Backend upload + attachment persistence (Priority: P1)
*As the system, I persist Commander-uploaded images as validated, first-class message
attachments reachable by both the UI (for display) and agents (as an absolute file path).*

**Acceptance criteria**
- `POST /api/uploads` accepts a single image (multipart), validates MIME
  (png/jpeg/gif/webp), size (≤ 10 MB), writes it under the configured uploads dir with a
  server-generated collision-safe name, and returns `{ id, filename, mimeType, sizeBytes }`.
- A malformed / oversized / disallowed-type / traversal-attempt upload returns a
  structured 4xx error and writes nothing outside the uploads dir.
- `POST /api/messages` accepts optional `attachmentIds: string[]`; on send it links those
  attachments to the created message and returns the message with its attachments; the
  message + attachments are broadcast over WebSocket.
- `GET /api/uploads/:id` streams the stored image (authenticated) for UI display; unknown
  id → 404.
- Attachments persist across restart (SQLite `message_attachments` table).

### US2 — TMUX image delivery to the target agent (Priority: P1)
*As the Commander, when I DM a screenshot to an online squad leader, their Claude
receives the image path immediately so it can read the screenshot.*

**Acceptance criteria**
- On a DM message carrying ≥1 image attachment addressed to an **online** agent, the
  system resolves that agent's tmux session/pane and injects a prompt that lists the
  **absolute path(s)** of the image(s) (+ the Commander's optional text), using the
  existing two-phase tmux delivery (`InputRouter.sendInput`).
- The agent's Claude can `Read` the injected path and view the screenshot.
- If the target agent is **offline/unknown**, injection is skipped gracefully — the
  message + attachment still persist and render in chat; the skip is logged, no error is
  surfaced to the Commander.
- Injection never blocks or fails the message-send response (delivery is best-effort,
  post-persist).
- Multiple images in one message inject all paths in one prompt.

### US3 — Web composer: attach & preview screenshots (Priority: P1)
*As the Commander on the web dashboard, I attach screenshots via paste, drag-drop, or a
file picker, preview them, and send.*

**Acceptance criteria**
- The chat composer accepts an image via (a) clipboard paste, (b) drag-and-drop, and
  (c) a file-picker button; shows a thumbnail preview with a remove control before send.
- On send, each image uploads (`POST /api/uploads`) then the message posts with the
  resulting `attachmentIds`.
- Sent/received messages render image attachments as inline thumbnails (served via
  `GET /api/uploads/:id`); clicking opens the full image.
- Upload failure preserves the draft and shows a clear error (draft-preserve rule).

### US4 — iOS composer: attach & preview screenshots (Priority: P1)
*As the Commander on iOS, I attach screenshots from the photo library / paste and send.*

**Acceptance criteria**
- The iOS chat composer offers an image attach affordance (PhotosPicker + paste), shows a
  thumbnail preview with remove, uploads, and sends with `attachmentIds`.
- Messages render image attachments as inline thumbnails (via `GET /api/uploads/:id`);
  tap opens full screen.
- New files live under SPM-discovered paths (no `.pbxproj` edits under `Adjutant/`).

## Non-Functional Requirements

- **Security**: MIME allowlist + magic-byte sniff, hard size cap (≤10 MB) and per-message
  count cap (≤4), server-generated filenames, writes confined to the uploads dir (no path
  traversal), `GET /api/uploads/:id` behind `apiKeyAuth`.
- **Layered architecture**: routes → services → stores; no fs/db access from routes.
- **Testing**: TDD at every layer; ≥3 tests per service method, ≥2 per endpoint/tool.
- **Performance**: injection is post-persist and best-effort; the send response is not
  blocked on tmux I/O.

## Out of Scope

- Channel / broadcast-to-many screenshot fan-out (future).
- Non-image attachments (PDF, video), image editing/annotation, OCR.
- Agent → Commander image replies.

## Success Criteria

The Commander attaches a screenshot in **both** web and iOS, sends it to an online squad
leader, and that squad leader's tmux Claude receives the absolute path and reads the
image — end-to-end, with the attachment also persisted and rendered in chat.
