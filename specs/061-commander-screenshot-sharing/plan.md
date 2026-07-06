# Implementation Plan: Commander Screenshot Sharing (adj-203)

## Architecture Overview

One composition pipeline, four consumers. An image the Commander sends is (1) stored on
the host filesystem, (2) recorded as a `message_attachment` row, (3) rendered inline in
web + iOS chat via a serve endpoint, and (4) — for a DM to an online agent — injected into
that agent's tmux pane as an absolute path so the agent's Claude reads it.

```
Commander (web/iOS)
  │  POST /api/uploads (multipart image)  ── validate → write file → attachment row (unlinked)
  │  POST /api/messages { conversationId, body, attachmentIds }
  ▼
routes/uploads.ts ─┐            routes/messages.ts ─┐
                   ▼                                ▼
        upload-service.ts                   message-service (send path)
        (validate, store)                   link attachments → persist → WS broadcast
                   │                                │
                   ▼                                ▼ (DM → online agent, has images)
        attachment-store.ts                 attachment-delivery-service.ts
        (SQLite: message_attachments)        resolve session → InputRouter.sendInput(paths)
                   │
                   ▼
   ADJUTANT_UPLOAD_DIR/<uuid>.<ext>   ← absolute path the agent's Claude reads
```

## Key Decisions

1. **Upload-then-reference** (not inline multipart on `/api/messages`): `POST /api/uploads`
   returns an `attachmentId`; the message send passes `attachmentIds`. Decouples upload
   from send, enables client-side preview + progress, keeps the message JSON contract.
2. **Filesystem storage, absolute paths**: files live under `ADJUTANT_UPLOAD_DIR`
   (default `~/.adjutant/uploads`), server-generated name `<uuid>.<ext>`. Agents run in
   tmux on the SAME host, so an absolute path is directly `Read`-able by their Claude.
   The stored absolute path is what US2 injects.
3. **Reuse `InputRouter.sendInput`** for delivery — it already resolves the session,
   fails closed on offline, and uses the proven two-phase tmux paste (adj-53kf/adj-twhj).
   No new tmux primitive.
4. **Best-effort, post-persist delivery**: injection happens AFTER the message is stored
   and the HTTP response is sent (or in a non-blocking tail), so tmux latency/failure
   never breaks send. Offline/unknown → skip + log.
5. **Security is a first-class boundary**: MIME allowlist + magic-byte sniff, size + count
   caps, server-generated names, path-traversal-proof writes, authenticated serve.
6. **DM-only scoping (MVP)**: delivery triggers only when the conversation is a `dm` whose
   non-user member is an agent. Channels are explicitly skipped (future work).

## Phases

### Phase 1 — Foundational (adj-203.1)
Storage + schema + validation primitives shared by everything.
- Migration `037-message-attachments.sql`: `message_attachments(id TEXT PK, message_id TEXT
  NULL FK→messages, kind TEXT, storage_path TEXT, filename TEXT, mime_type TEXT,
  size_bytes INTEGER, created_at)`, index on `message_id`.
- `backend/src/services/upload-storage.ts`: resolve `ADJUTANT_UPLOAD_DIR`, ensure dir,
  generate safe `<uuid>.<ext>` names, validate MIME (allowlist + magic bytes) + size,
  write within the dir (traversal-proof), delete.
- `backend/src/services/attachment-store.ts`: `createAttachment`, `linkToMessage`,
  `getById`, `getByMessageId`, `deleteOlderThan`.

### Phase 2 — US1: Upload + serve + link API (adj-203.2)
- `backend/src/routes/uploads.ts`: `POST /api/uploads` (multipart, Zod-validated bounds),
  `GET /api/uploads/:id` (authenticated stream). Mounted in the app with a body-size cap.
- `backend/src/services/upload-service.ts`: orchestrate validate → store → row.
- Extend the `POST /api/messages` handler + message-service to accept `attachmentIds`,
  link them, and include attachments in the persisted + WS-broadcast message payload.
- Extend the WS `chat_message` payload + message types with `attachments`.

### Phase 3 — US2: TMUX image delivery (adj-203.3)
- `backend/src/services/attachment-delivery-service.ts`: given a persisted message +
  attachments + recipient, if DM→online agent and ≥1 image, build the injection prompt
  (`[Commander shared N screenshot(s) — please review]\n<abs path…>\n<body>`) and call
  `InputRouter.sendInput`. Offline/unknown/non-DM → no-op + log. Never throws into send.
- Wire it into the message-send path (post-persist, non-blocking).

### Phase 4 — US3: Web composer (adj-203.4)
- `frontend/src/services/api.ts`: `uploadImage(file)` → attachmentId; message send accepts
  attachmentIds; `uploadUrl(id)` helper.
- `frontend/src/components/chat/` (CommandChat/ChatView composer): paste + drag-drop +
  file-picker, thumbnail preview with remove, upload-then-send, draft-preserve on failure.
- Attachment rendering in message bubbles (thumbnail → full image), `chat.css`.

### Phase 5 — US4: iOS composer (adj-203.5)
- iOS `APIClient`: `uploadImage`, message send with `attachmentIds`, `uploadURL(id)`.
- `ios/Adjutant/Sources/Features/Chat/` composer: PhotosPicker + paste, thumbnail preview,
  upload-then-send; attachment rendering (thumbnail → full screen). SPM only.

### Phase 6 — Polish (adj-203.6)
- Retention: prune uploads + rows older than `ADJUTANT_UPLOAD_TTL_DAYS` (default 7) via a
  scheduled sweep; log what was pruned (no silent truncation).
- Security hardening test matrix: traversal, oversized, disallowed MIME, magic-byte
  mismatch, count cap, unauthenticated serve.
- Docs: `docs/screenshot-sharing.md` (contract, env vars, security model).
- End-to-end acceptance test covering the full pipeline.

## Parallelization

- Phase 1 blocks all.
- After Phase 2: Phase 3 (delivery), Phase 4 (web), Phase 5 (iOS) are mutually independent
  and run in parallel (different files / layers).
- Phase 6 depends on 2–5.

## Files (by phase)

- **P1**: `backend/src/services/migrations/037-message-attachments.sql`,
  `backend/src/services/upload-storage.ts`, `backend/src/services/attachment-store.ts`
- **P2**: `backend/src/routes/uploads.ts`, `backend/src/services/upload-service.ts`,
  `backend/src/routes/messages.ts`, `backend/src/services/message-store.ts`,
  `backend/src/services/ws-server.ts`, `backend/src/types/*`
- **P3**: `backend/src/services/attachment-delivery-service.ts`,
  `backend/src/services/input-router.ts` (consumer only)
- **P4**: `frontend/src/services/api.ts`, `frontend/src/components/chat/*`, `chat.css`
- **P5**: `ios/Adjutant/Sources/Features/Chat/*`, iOS `APIClient`
- **P6**: retention sweep, `docs/screenshot-sharing.md`, e2e test

## Bead Map

- `adj-203` — Root epic: Commander screenshot sharing into agent tmux panes (web + iOS) [P1]
  - `adj-203.1` — Foundational: storage + attachment schema + validation
    - `adj-203.1.1` — T001 migration 037-message-attachments.sql
    - `adj-203.1.2` — T002 attachment-store.ts
    - `adj-203.1.3` — T003 upload-storage.ts
  - `adj-203.2` — US1: Upload + serve + link API
    - `adj-203.2.1` — T004 upload-service.ts
    - `adj-203.2.2` — T005 routes/uploads.ts (POST + GET)
    - `adj-203.2.3` — T006 message attachmentIds linking
    - `adj-203.2.4` — T007 WS chat_message attachments payload
  - `adj-203.3` — US2: TMUX image delivery
    - `adj-203.3.1` — T008 attachment-delivery-service.ts
    - `adj-203.3.2` — T009 wire delivery into message-send
  - `adj-203.4` — US3: Web composer
    - `adj-203.4.1` — T010 api.ts upload helpers
    - `adj-203.4.2` — T011 composer attach/paste/drag/preview
    - `adj-203.4.3` — T012 message attachment rendering
  - `adj-203.5` — US4: iOS composer
    - `adj-203.5.1` — T013 APIClient upload
    - `adj-203.5.2` — T014 iOS composer PhotosPicker/paste
    - `adj-203.5.3` — T015 iOS attachment rendering
  - `adj-203.6` — Polish: retention + security + docs + e2e [P2]
    - `adj-203.6.1` — T016 retention prune sweep
    - `adj-203.6.2` — T017 upload security hardening matrix
    - `adj-203.6.3` — T018 docs/screenshot-sharing.md
    - `adj-203.6.4` — T019 end-to-end acceptance test

**Execution order** (from `bd ready`): start with `adj-203.1.1` + `adj-203.1.3` (foundation,
no deps). Then `adj-203.1.2` → the US1 API (`adj-203.2.*`) unblocks, which in turn opens the
three parallel tracks: US2 delivery (`.3`), web (`.4`), iOS (`.5`). Polish (`.6`) is last.
