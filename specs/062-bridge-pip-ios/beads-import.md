# Beads Import: Bridge Window-in-Window / PiP on iOS (adj-207)

Root epic: **adj-207** (type=epic, P0). 6 sub-epics, 19 tasks — 26 beads.

## Hierarchy

```
adj-207  The Bridge as window-in-window (PiP) on iOS — in-app floating + system PiP   [epic P0]
├── adj-207.1  Foundational: persistent app-root Bridge session/host                  [epic P0]
│   ├── adj-207.1.1  T001  BridgeSession state machine (+ single-session guard)        [task P0]
│   ├── adj-207.1.2  T002  BridgeHostContainer (root ZStack above nav)                 [task P0]
│   └── adj-207.1.3  T003  session-owned reusable AvatarWebView surface                [task P0]
├── adj-207.2  US1 (Phase A): In-app floating window                                   [epic P0]
│   ├── adj-207.2.1  T004  BridgeWindowState (drag/resize/snap geometry)               [task P0]
│   └── adj-207.2.2  T005  BridgeFloatingWindowView (drag/resize/minimize-to-pill)     [task P0]
├── adj-207.3  US2 (Phase A): iOS background audio (full duplex)                       [epic P0]
│   ├── adj-207.3.1  T006  BridgeAudioSession (AVAudioSession + interruptions)         [task P0]
│   └── adj-207.3.2  T007  background-entry hook + WKWebView audio keep-alive          [task P0]
├── adj-207.4  US3 (Phase B): Native LiveKit avatar + system PiP                       [epic P0]
│   ├── adj-207.4.1  T008  add LiveKit Swift SDK (SPM)                                 [task P0]
│   ├── adj-207.4.2  T009  NativeAvatarClient (join SAME room via broker token)        [task P0]
│   ├── adj-207.4.3  T010  AvatarSampleBufferView (track → AVSampleBufferDisplayLayer) [task P0]
│   ├── adj-207.4.4  T011  BridgePiPController (AVPictureInPictureController)           [task P0]
│   └── adj-207.4.5  T012  backend native-consumer token in avatar.ts                  [task P0]
├── adj-207.5  US4 (Phase B): PiP hand-off UX                                          [epic P0]
│   ├── adj-207.5.1  T013  auto-enter PiP on background + manual pop-out               [task P0]
│   └── adj-207.5.2  T014  PiP→floating restore + audio/mic continuity                 [task P0]
└── adj-207.6  Polish: interruptions + lifecycle + docs + e2e + ship                   [epic P1]
    ├── adj-207.6.1  T015  interruption/edge-case matrix                               [task P1]
    ├── adj-207.6.2  T016  single-session/credit-meter lifecycle correctness           [task P0]
    ├── adj-207.6.3  T017  docs/bridge-pip-ios.md                                      [task P2]
    ├── adj-207.6.4  T018  end-to-end acceptance test                                  [task P0]
    └── adj-207.6.5  T019  version bump + shippable build                              [task P0]
```

## Dependency edges (`bd dep add <depends-on-later> <blocker-earlier>`)

- Hierarchy: root ← each sub-epic (epic↔epic); tasks belong to sub-epics by dotted ID.
- Phase ordering (epic↔epic): `.2←.1`, `.3←.1`, `.4←.1,.2,.3`, `.5←.4`, `.6←.2,.3,.4,.5`.
- Intra-phase task order: `.1.3←.1.1`, `.1.2←.1.3`, `.2.2←.2.1`, `.3.2←.3.1`,
  `.4.2←.4.1`, `.4.2←.4.5`, `.4.3←.4.2`, `.4.4←.4.3`, `.5.2←.5.1`, `.6.4←.6.1`,
  `.6.4←.6.2`, `.6.5←.6.4`.
- Cross-phase task gates (keep `bd ready` honest): `.2.1←.1.1`, `.3.1←.1.1`,
  `.4.2←.2.2`, `.4.2←.3.2` (Phase B meaningful work follows Phase A).

## Task ↔ T-ID map

| Bead | T-ID | Layer / file |
|---|---|---|
| adj-207.1.1 | T001 | ios .../Bridge/BridgeSession.swift |
| adj-207.1.2 | T002 | ios .../Bridge/BridgeHostContainer.swift + AdjutantApp |
| adj-207.1.3 | T003 | ios Features/Avatar/AvatarOverlayView.swift refactor |
| adj-207.2.1 | T004 | ios .../Bridge/BridgeWindowState.swift |
| adj-207.2.2 | T005 | ios .../Bridge/BridgeFloatingWindowView.swift |
| adj-207.3.1 | T006 | ios .../Bridge/BridgeAudioSession.swift |
| adj-207.3.2 | T007 | ios BridgeSession background hook |
| adj-207.4.1 | T008 | LiveKit Swift SDK (SPM) |
| adj-207.4.2 | T009 | ios .../Bridge/NativeAvatarClient.swift |
| adj-207.4.3 | T010 | ios .../Bridge/AvatarSampleBufferView.swift |
| adj-207.4.4 | T011 | ios .../Bridge/BridgePiPController.swift |
| adj-207.4.5 | T012 | backend/src/routes/avatar.ts (native token) |
| adj-207.5.1 | T013 | ios PiP entry (auto + manual) |
| adj-207.5.2 | T014 | ios PiP restore + continuity |
| adj-207.6.1 | T015 | ios interruption matrix tests |
| adj-207.6.2 | T016 | ios session lifecycle / meter |
| adj-207.6.3 | T017 | docs/bridge-pip-ios.md |
| adj-207.6.4 | T018 | ios e2e acceptance |
| adj-207.6.5 | T019 | version bump (pbxproj) |
