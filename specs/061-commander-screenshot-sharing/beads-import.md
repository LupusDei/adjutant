# Beads Import: Commander Screenshot Sharing (adj-203)

Root epic: **adj-203** (type=epic, P1). 6 sub-epics, 19 tasks — 26 beads total.

## Hierarchy

```
adj-203  Commander screenshot sharing into agent tmux panes (web + iOS)   [epic P1]
├── adj-203.1  Foundational: storage + attachment schema + validation     [epic P1]
│   ├── adj-203.1.1  T001  migration 037-message-attachments.sql          [task P1]
│   ├── adj-203.1.2  T002  attachment-store.ts (+tests)                    [task P1]
│   └── adj-203.1.3  T003  upload-storage.ts (safe name/MIME/size/traversal) [task P1]
├── adj-203.2  US1: Upload + serve + link API                             [epic P1]
│   ├── adj-203.2.1  T004  upload-service.ts (+tests)                      [task P1]
│   ├── adj-203.2.2  T005  routes/uploads.ts POST + GET (+tests)          [task P1]
│   ├── adj-203.2.3  T006  message send attachmentIds linking (+tests)    [task P1]
│   └── adj-203.2.4  T007  WS chat_message attachments payload (+tests)   [task P1]
├── adj-203.3  US2: TMUX image delivery                                   [epic P1]
│   ├── adj-203.3.1  T008  attachment-delivery-service.ts (+tests)        [task P1]
│   └── adj-203.3.2  T009  wire delivery into message-send (+tests)       [task P1]
├── adj-203.4  US3: Web composer                                         [epic P1]
│   ├── adj-203.4.1  T010  api.ts upload helpers (+tests)                 [task P1]
│   ├── adj-203.4.2  T011  composer attach/paste/drag/preview (+tests)    [task P1]
│   └── adj-203.4.3  T012  message attachment rendering (+tests)          [task P1]
├── adj-203.5  US4: iOS composer                                         [epic P1]
│   ├── adj-203.5.1  T013  APIClient upload (+tests)                      [task P1]
│   ├── adj-203.5.2  T014  iOS composer PhotosPicker/paste (+tests)       [task P1]
│   └── adj-203.5.3  T015  iOS attachment rendering (+tests)              [task P1]
└── adj-203.6  Polish: retention + security + docs + e2e                 [epic P2]
    ├── adj-203.6.1  T016  retention prune sweep (+tests)                 [task P2]
    ├── adj-203.6.2  T017  upload security hardening matrix (+tests)      [task P1]
    ├── adj-203.6.3  T018  docs/screenshot-sharing.md                     [task P2]
    └── adj-203.6.4  T019  end-to-end acceptance test                     [task P1]
```

## Dependency edges (`bd dep add <depends-on-later> <blocker-earlier>`)

- Hierarchy: root ← each sub-epic; each sub-epic ← its tasks.
- Ordering: `.2 ← .1`, `.3 ← .2`, `.4 ← .2`, `.5 ← .2`, `.6 ← {.2,.3,.4,.5}`.
- Intra-phase: `.1.2 ← .1.1`, `.2.2 ← .2.1`, `.3.2 ← .3.1`.

## Task ↔ T-ID map

| Bead | T-ID | Layer / file |
|---|---|---|
| adj-203.1.1 | T001 | migrations/037-message-attachments.sql |
| adj-203.1.2 | T002 | services/attachment-store.ts |
| adj-203.1.3 | T003 | services/upload-storage.ts |
| adj-203.2.1 | T004 | services/upload-service.ts |
| adj-203.2.2 | T005 | routes/uploads.ts |
| adj-203.2.3 | T006 | routes/messages.ts + message-store.ts |
| adj-203.2.4 | T007 | services/ws-server.ts + types |
| adj-203.3.1 | T008 | services/attachment-delivery-service.ts |
| adj-203.3.2 | T009 | message-send wiring |
| adj-203.4.1 | T010 | frontend/services/api.ts |
| adj-203.4.2 | T011 | frontend/components/chat composer |
| adj-203.4.3 | T012 | frontend message attachment render |
| adj-203.5.1 | T013 | iOS APIClient |
| adj-203.5.2 | T014 | iOS chat composer |
| adj-203.5.3 | T015 | iOS attachment render |
| adj-203.6.1 | T016 | upload retention sweep |
| adj-203.6.2 | T017 | upload security tests + hardening |
| adj-203.6.3 | T018 | docs/screenshot-sharing.md |
| adj-203.6.4 | T019 | e2e acceptance test |
