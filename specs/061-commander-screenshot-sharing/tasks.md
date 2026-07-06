# Tasks: Commander Screenshot Sharing (adj-203)

Format: `T### [P] [USn] description in path`. `[P]` = parallelizable (different files, no
dep). Every non-exempt task is TDD-shaped (Shape A split or Shape B phased).

## Phase 1 — Foundational (adj-203.1)

- [ ] T001 [US1] [scaffold] Add migration `backend/src/services/migrations/037-message-attachments.sql`
      — `message_attachments(id TEXT PK, message_id TEXT NULL, kind TEXT, storage_path TEXT,
      filename TEXT, mime_type TEXT, size_bytes INTEGER, created_at TEXT)` + index on `message_id`.
- [ ] T002a [P] [US1] Write failing tests for attachment store in
      `backend/tests/unit/attachment-store.test.ts` — createAttachment, linkToMessage,
      getById, getByMessageId, deleteOlderThan (happy / error / edge: unknown id, empty).
      Confirm RED.
- [ ] T002b [US1] Implement `backend/src/services/attachment-store.ts` until T002a is GREEN.
- [ ] T003a [P] [US1] Write failing tests for upload storage in
      `backend/tests/unit/upload-storage.test.ts` — safe `<uuid>.<ext>` name gen, MIME
      allowlist + magic-byte sniff (reject mismatch), size cap, traversal-proof write
      (reject `../`), delete. Confirm RED.
- [ ] T003b [US1] Implement `backend/src/services/upload-storage.ts` until T003a is GREEN.

## Phase 2 — US1: Upload + serve + link API (adj-203.2)

- [ ] T004a [P] [US1] Write failing tests for `backend/tests/unit/upload-service.test.ts`
      — validate → store → attachment row; rejects bad MIME/oversized. Confirm RED.
- [ ] T004b [US1] Implement `backend/src/services/upload-service.ts` until GREEN.
- [ ] T005a [US1] Write failing tests for the uploads routes in
      `backend/tests/unit/uploads-routes.test.ts` — `POST /api/uploads` success + validation
      error; `GET /api/uploads/:id` streams stored image + 404 unknown + auth required.
      Confirm RED.
- [ ] T005b [US1] Implement `backend/src/routes/uploads.ts` (+ mount with body-size cap)
      until T005a is GREEN.
- [ ] T006a [US1] Write failing tests for attachment linking on message send in
      `backend/tests/unit/messages-attachments.test.ts` — `POST /api/messages` with
      `attachmentIds` links rows and returns/persists attachments; empty/omitted is a plain
      message. Confirm RED.
- [ ] T006b [US1] Implement `attachmentIds` support in `backend/src/routes/messages.ts` +
      `backend/src/services/message-store.ts` until T006a is GREEN.
- [ ] T007a [US1] Write failing tests in `backend/tests/unit/ws-attachments.test.ts` — the
      `chat_message` WS payload + message type include `attachments`. Confirm RED.
- [ ] T007b [US1] Extend the WS payload + message types in `backend/src/services/ws-server.ts`
      (and shared types) until T007a is GREEN.

## Phase 3 — US2: TMUX image delivery (adj-203.3)

- [ ] T008a [US2] Write failing tests for
      `backend/tests/unit/attachment-delivery-service.test.ts` (mock InputRouter +
      SessionRegistry) — DM→online agent with images injects a prompt listing absolute
      path(s); offline agent / unknown / non-DM / no-image → no-op; never throws. Confirm RED.
- [ ] T008b [US2] Implement `backend/src/services/attachment-delivery-service.ts`
      (reuse `InputRouter.sendInput`) until T008a is GREEN.
- [ ] T009a [US2] Write failing tests in
      `backend/tests/integration/screenshot-delivery.test.ts` — sending a DM with an image
      to an online agent triggers delivery post-persist and does NOT block/fail the send
      response; offline path still persists + skips. Confirm RED.
- [ ] T009b [US2] Wire delivery into the message-send path (post-persist, non-blocking)
      until T009a is GREEN.

## Phase 4 — US3: Web composer (adj-203.4)

- [ ] T010a [P] [US3] Write failing tests for `frontend/tests/unit/api-uploads.test.ts` —
      `uploadImage(file)` returns attachmentId; message send forwards `attachmentIds`;
      `uploadUrl(id)` builds the serve URL. Confirm RED.
- [ ] T010b [US3] Implement upload helpers in `frontend/src/services/api.ts` until GREEN.
- [ ] T011a [US3] Write failing tests for the composer in
      `frontend/tests/unit/chat-composer-attachments.test.tsx` — paste, drag-drop, and
      file-picker add an image; thumbnail preview + remove; upload-then-send; draft
      preserved on upload failure. Confirm RED.
- [ ] T011b [US3] Implement attach/preview in the chat composer
      (`frontend/src/components/chat/CommandChat.tsx` + `chat.css`) until T011a is GREEN.
- [ ] T012a [US3] Write failing tests for
      `frontend/tests/unit/message-attachments-render.test.tsx` — messages render image
      attachments as thumbnails; click opens full image. Confirm RED.
- [ ] T012b [US3] Implement attachment rendering in the message list until T012a is GREEN.

## Phase 5 — US4: iOS composer (adj-203.5)

- [ ] T013a [P] [US4] Write failing tests in
      `ios/AdjutantTests/Features/Chat/AttachmentUploadTests.swift` — `APIClient.uploadImage`
      returns attachmentId; message send forwards `attachmentIds`; `uploadURL(id)`. Confirm RED.
- [ ] T013b [US4] Implement upload in iOS `APIClient` (SPM-discovered path) until GREEN.
- [ ] T014a [US4] Write failing tests in
      `ios/AdjutantTests/Features/Chat/ChatComposerAttachmentTests.swift` — PhotosPicker/paste
      adds an image; thumbnail preview + remove; upload-then-send. Confirm RED.
- [ ] T014b [US4] Implement the iOS composer attach flow in
      `ios/Adjutant/Sources/Features/Chat/` until T014a is GREEN.
- [ ] T015a [US4] Write failing tests in
      `ios/AdjutantTests/Features/Chat/MessageAttachmentRenderTests.swift` — messages render
      image thumbnails; tap opens full screen. Confirm RED.
- [ ] T015b [US4] Implement iOS attachment rendering until T015a is GREEN.

## Phase 6 — Polish (adj-203.6)

- [ ] T016a [US6] Write failing tests in `backend/tests/unit/upload-retention.test.ts` —
      prune uploads + rows older than `ADJUTANT_UPLOAD_TTL_DAYS` (default 7); keeps recent;
      logs pruned count. Confirm RED.
- [ ] T016b [US6] Implement the retention sweep (uses `attachment-store.deleteOlderThan`)
      until T016a is GREEN.
- [ ] T017a [US6] Write failing adversarial tests in
      `backend/tests/integration/upload-security.test.ts` — path traversal, oversized,
      disallowed MIME, magic-byte mismatch, per-message count cap (>4), unauthenticated
      `GET /api/uploads/:id`. Confirm RED (each must be rejected/denied).
- [ ] T017b [US6] Harden upload-service/routes until T017a is GREEN.
- [ ] T018 [US6] [docs] Write `docs/screenshot-sharing.md` — contract, env vars
      (`ADJUTANT_UPLOAD_DIR`, `ADJUTANT_UPLOAD_TTL_DAYS`), security model, delivery behavior.
- [ ] T019a [US6] Write a failing end-to-end acceptance test
      `backend/tests/integration/screenshot-e2e.test.ts` — upload → send DM w/ attachment →
      persisted + WS payload carries attachment → online-agent delivery injects the absolute
      path. Confirm RED.
- [ ] T019b [US6] Close any gaps until T019a is GREEN.

## TDD audit

Run before considering complete:
```bash
npx --prefix backend tsx scripts/audit-tasks-md.ts --quiet
```
