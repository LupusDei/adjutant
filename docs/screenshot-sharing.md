# Commander Screenshot Sharing (adj-203)

Let the Commander attach one or more screenshots/images to an Adjutant message. When the
message is a **DM addressed to an online squad-leader agent**, the screenshot is
**auto-injected into that agent's Claude Code tmux pane** — the injected prompt references
the image's **absolute file path**, so the agent's Claude can `Read` and "see" the
screenshot for live issue-sharing and debugging. The image is also persisted as a
first-class message attachment and rendered inline in web + iOS chat, exactly like any
other message.

Spec: `specs/061-commander-screenshot-sharing/`.

---

## Contract (upload-then-reference)

Upload is decoupled from message send — a two-step flow that enables client-side preview
and keeps the message JSON contract clean:

1. **`POST /api/uploads`** — multipart, single field `file`. Validates + stores the image
   under the uploads dir with a server-generated name, inserts an **unlinked** attachment
   row, and returns the **public** metadata:

   ```jsonc
   // 201 Created
   { "success": true, "data": { "id": "<uuid>", "filename": "bug.png",
                                "mimeType": "image/png", "sizeBytes": 20344 } }
   ```

   A malformed / oversized / disallowed-type / magic-byte-spoofed upload returns a
   structured `400` and writes **nothing** outside the uploads dir.

2. **`POST /api/messages`** — accepts an optional `attachmentIds: string[]` (max **4**):

   ```jsonc
   { "to": "kerrigan", "body": "why is this red?", "attachmentIds": ["<uuid>"] }
   ```

   On send the server links those attachment rows to the created message, broadcasts the
   message (with public attachments) over WebSocket, and — for a DM to an online agent —
   injects the absolute path(s) into that agent's pane. **`body` is optional when at least
   one attachment is present** (image-only DMs); a message with neither a non-empty body
   nor an attachment is rejected `400`.

3. **`GET /api/uploads/:id`** — streams the stored image (behind `apiKeyAuth`) for UI
   display. Unknown / missing → `404` (indistinguishable — no existence leak). Web + iOS
   build this URL from the attachment `id`; they never need the server path.

Message history (`GET /api/messages`, `GET /api/conversations/:id/messages`) and the
real-time `chat_message` WS payload both carry the **public attachment DTO** on each
message so clients render thumbnails inline.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ADJUTANT_UPLOAD_DIR` | `~/.adjutant/uploads` | Directory the images are written to. Agents run in tmux on the **same host**, so the absolute path under this dir is directly `Read`-able by their Claude. |
| `ADJUTANT_UPLOAD_TTL_DAYS` | `7` | Retention window. The sweep prunes files + rows older than this. Non-numeric / non-positive values fall back to the default. |

---

## Security model

The upload path is served to unauthenticated-adjacent surfaces (the tmux-injection path and
the authenticated `GET /api/uploads/:id`), so validation is a **first-class boundary**
(`backend/src/services/upload-storage.ts`):

- **MIME allowlist + magic-byte sniff** — only `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`. The type is decided by the **file's magic bytes**, never the client-declared
  `Content-Type`; a declared type that disagrees with the sniffed bytes is rejected
  (anti-spoofing). GIF requires the full `GIF87a`/`GIF89a` header.
- **Size cap** — hard **10 MB** per file, enforced both by the multipart parser (multer)
  and the service.
- **Per-message count cap** — at most **4** attachments per message (Zod, at the route).
- **Server-generated filenames** — every stored file is named `<uuid>.<ext>`; the client
  filename is display-only and sanitized to a basename. A path-traversal filename
  (`../../etc/passwd.png`) cannot escape the uploads dir.
- **Traversal-proof I/O** — all writes/reads/deletes are confined to `ADJUTANT_UPLOAD_DIR`;
  any path resolving outside it is refused.
- **Authenticated serve** — `GET /api/uploads/:id` sits behind `apiKeyAuth`; no key → `401`.
- **Public DTO — no `storagePath` leak** — the absolute server path is an **internal**
  field. Client-facing serializers (the WS `chat_message` payload and every REST message
  response) emit `PublicMessageAttachment` = `{ id, kind, filename, mimeType, sizeBytes }`
  only. The absolute `storagePath` is used **server-side only** (tmux injection).

The adversarial matrix in `backend/tests/integration/upload-security.test.ts` exercises each
of these at the HTTP boundary.

---

## DM → online-agent tmux delivery

Delivery (`backend/src/services/attachment-delivery-service.ts`) is best-effort and
**post-persist** — tmux latency or failure never blocks or fails the message-send response.
It injects only when **all** of:

1. the conversation is a **DM** (deterministic `dm_`-prefixed id),
2. the non-user member (the recipient) is an **agent** (not the user),
3. that agent has **≥1 online session**, and
4. the message carries **≥1 image** attachment.

The injected prompt lists the **absolute path(s)** so the agent's Claude can read them:

```
[Commander shared 1 screenshot — please review]
/Users/.../.adjutant/uploads/1a2b3c…-….png
why is this red?
```

Multiple images inject all paths in one prompt. The Commander's text is appended only when
non-empty. Anything that fails the matrix — non-DM, agent **offline/unknown**, no image — is
a **graceful no-op**: the message + attachment still persist and render in chat, the skip is
logged, and **no error is surfaced** to the Commander. Delivery reuses the proven two-phase
tmux paste (`InputRouter.sendInput`) — no new tmux primitive.

**Out of scope (MVP):** channel / broadcast-to-many fan-out, non-image attachments,
agent → Commander image replies.

---

## Retention sweep

`backend/src/services/upload-retention.ts` prunes stored files **and** their attachment rows
older than `ADJUTANT_UPLOAD_TTL_DAYS`. It reuses `attachment-store.deleteOlderThan` (rows,
returned so their files can be unlinked) and `upload-storage.delete` (files). The file leg is
best-effort (a missing file never blocks pruning the row). Every sweep **logs the pruned
count** — no silent truncation. `startUploadRetentionScheduler` runs one sweep at server boot
and then every 6 hours (the interval is `unref`'d so it never holds the process open).

---

## Code map

| Concern | File |
|---|---|
| Schema (migration 037) | `backend/src/services/migrations/037-message-attachments.sql` |
| Storage + validation (allowlist, magic bytes, traversal-proof) | `backend/src/services/upload-storage.ts` |
| Attachment data layer (+ `PublicMessageAttachment` DTO) | `backend/src/services/attachment-store.ts` |
| Upload orchestration (validate → store → row) | `backend/src/services/upload-service.ts` |
| Upload + serve routes | `backend/src/routes/uploads.ts` |
| Message linking + hydration + client serialization | `backend/src/services/message-store.ts` |
| Send path (persist + WS broadcast + delivery) | `backend/src/services/direct-message-delivery.ts` |
| tmux delivery decision + injection | `backend/src/services/attachment-delivery-service.ts` |
| Retention sweep | `backend/src/services/upload-retention.ts` |
