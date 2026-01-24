# Tasks: ElevenLabs Voice Integration

**Input**: Design documents from `/specs/004-elevenlabs-voice/`
**Prerequisites**: spec.md (required), existing adjutant infrastructure
**Reference**: [squadron-comms-plugin](https://github.com/1Shot-Labs/squadron-comms-plugin)

**Tests**: Per constitution principle II (Test-First Development), unit tests are included for services and hooks. Pure UI components are exempt.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/src/`
- **Frontend**: `frontend/src/`
- Backend tests: `backend/tests/unit/`
- Frontend tests: `frontend/tests/unit/`

---

## Phase 1: Setup (Voice Infrastructure)

**Purpose**: Core voice service setup and ElevenLabs API integration

- [ ] T001 Create voice-related TypeScript types in backend/src/types/voice.ts (VoiceConfig, AgentVoiceMapping, SynthesizeRequest, TranscribeResponse)
- [ ] T002 Create Zod validation schemas for voice API in backend/src/types/voice-schemas.ts
- [ ] T003 Add ELEVENLABS_API_KEY to backend/.env.example with documentation
- [ ] T004 Create voice configuration file with default agent voice mappings in backend/src/config/voice-config.ts
- [ ] T005 Create audio cache directory structure in backend/src/services/audio-cache.ts

---

## Phase 2: Foundational (ElevenLabs Client)

**Purpose**: Core ElevenLabs API client that all voice features depend on

**CRITICAL**: All user story work depends on this phase

- [ ] T006 Write unit tests for ElevenLabs client in backend/tests/unit/elevenlabs-client.test.ts
- [ ] T007 Implement ElevenLabs API client with TTS endpoint in backend/src/services/elevenlabs-client.ts
- [ ] T008 Add STT (speech-to-text) endpoint support to ElevenLabs client in backend/src/services/elevenlabs-client.ts
- [ ] T009 Implement audio file caching with hash-based filenames in backend/src/services/audio-cache.ts
- [ ] T010 Write unit tests for audio-cache service in backend/tests/unit/audio-cache.test.ts
- [ ] T011 Create file locking utility for concurrent playback safety in backend/src/utils/file-lock.ts
- [ ] T012 Write unit tests for file-lock utility in backend/tests/unit/file-lock.test.ts

**Checkpoint**: ElevenLabs client ready - voice features can now be implemented

---

## Phase 3: User Story 1 - Voice Message Playback (Priority: P1) - MVP

**Goal**: Play any message as audio using ElevenLabs TTS with agent-specific voices

**Independent Test**: Open a message, click play, hear it read aloud by the appropriate agent voice

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T013 [P] [US1] Write unit tests for voice-service synthesize in backend/tests/unit/voice-service.test.ts
- [ ] T014 [P] [US1] Write unit tests for useVoicePlayer hook in frontend/tests/unit/useVoicePlayer.test.ts

### Implementation for User Story 1

#### Backend (Voice Synthesis API)

- [ ] T015 [US1] Implement voice-service with synthesizeMessage, getVoiceForAgent in backend/src/services/voice-service.ts
- [ ] T016 [US1] Create voice routes (POST /api/voice/synthesize, GET /api/voice/audio/:filename) in backend/src/routes/voice.ts
- [ ] T017 [US1] Register voice routes in Express app in backend/src/index.ts
- [ ] T018 [US1] Add voice config endpoint (GET /api/voice/config) to voice routes in backend/src/routes/voice.ts

#### Frontend (Voice Playback UI)

- [ ] T019 [US1] Create frontend voice types in frontend/src/types/voice.ts
- [ ] T020 [US1] Add voice API methods to API client in frontend/src/services/api.ts
- [ ] T021 [US1] Implement useVoicePlayer hook with play/pause/stop in frontend/src/hooks/useVoicePlayer.ts
- [ ] T022 [US1] Create VoicePlayButton component with progress indicator in frontend/src/components/voice/VoicePlayButton.tsx
- [ ] T023 [US1] Create AudioProgressBar component in frontend/src/components/voice/AudioProgressBar.tsx
- [ ] T024 [US1] Integrate VoicePlayButton into MailDetail component in frontend/src/components/mail/MailDetail.tsx
- [ ] T025 [US1] Add Pip-Boy themed audio player styles in frontend/src/styles/voice.css

**Checkpoint**: Voice playback for messages is fully functional

---

## Phase 4: User Story 2 - Voice Input for Messages (Priority: P1) - MVP

**Goal**: Dictate message content using voice instead of typing

**Independent Test**: Click microphone, speak message, see transcribed text in compose field

### Tests for User Story 2

- [ ] T026 [P] [US2] Write unit tests for voice-service transcribe in backend/tests/unit/voice-service.test.ts
- [ ] T027 [P] [US2] Write unit tests for useVoiceInput hook in frontend/tests/unit/useVoiceInput.test.ts

### Implementation for User Story 2

#### Backend (Transcription API)

- [ ] T028 [US2] Add transcribeAudio method to voice-service in backend/src/services/voice-service.ts
- [ ] T029 [US2] Create transcription route (POST /api/voice/transcribe) in backend/src/routes/voice.ts
- [ ] T030 [US2] Add multer middleware for audio file uploads in backend/src/middleware/upload.ts

#### Frontend (Voice Input UI)

- [ ] T031 [US2] Implement useVoiceInput hook with recording state in frontend/src/hooks/useVoiceInput.ts
- [ ] T032 [US2] Create VoiceMicButton component with recording indicator in frontend/src/components/voice/VoiceMicButton.tsx
- [ ] T033 [US2] Integrate VoiceMicButton into ComposeMessage component in frontend/src/components/mail/ComposeMessage.tsx
- [ ] T034 [US2] Add Web Audio API recorder utility in frontend/src/utils/audio-recorder.ts
- [ ] T035 [US2] Add recording animation styles to voice.css in frontend/src/styles/voice.css

**Checkpoint**: Voice input for message composition is fully functional

---

## Phase 5: User Story 3 - Audio Notifications (Priority: P2)

**Goal**: Automatic audio announcements for incoming messages and events

**Independent Test**: Receive a high-priority message, hear announcement without clicking

### Tests for User Story 3

- [ ] T036 [P] [US3] Write unit tests for notification-queue service in backend/tests/unit/notification-queue.test.ts
- [ ] T037 [P] [US3] Write unit tests for useAudioNotifications hook in frontend/tests/unit/useAudioNotifications.test.ts

### Implementation for User Story 3

#### Backend (Notification Synthesis)

- [ ] T038 [US3] Implement notification-queue service with FIFO ordering in backend/src/services/notification-queue.ts
- [ ] T039 [US3] Add synthesizeNotification method for short announcements in backend/src/services/voice-service.ts
- [ ] T040 [US3] Create notification settings endpoint (GET/PUT /api/voice/settings) in backend/src/routes/voice.ts

#### Frontend (Notification Audio)

- [ ] T041 [US3] Implement useAudioNotifications hook with queue management in frontend/src/hooks/useAudioNotifications.ts
- [ ] T042 [US3] Create NotificationSettings component for audio preferences in frontend/src/components/voice/NotificationSettings.tsx
- [ ] T043 [US3] Create MasterMuteToggle component in frontend/src/components/voice/MasterMuteToggle.tsx
- [ ] T044 [US3] Integrate audio notification trigger into useMail hook in frontend/src/hooks/useMail.ts
- [ ] T045 [US3] Add MasterMuteToggle to PipBoyFrame header in frontend/src/components/shared/PipBoyFrame.tsx

**Checkpoint**: Audio notifications working for incoming messages

---

## Phase 6: User Story 4 - Agent Voice Configuration (Priority: P2)

**Goal**: Admin configuration of voice identities per agent/rig

**Independent Test**: Change agent voice config, hear different voice on next playback

### Tests for User Story 4

- [ ] T046 [P] [US4] Write unit tests for voice-config service in backend/tests/unit/voice-config.test.ts

### Implementation for User Story 4

#### Backend (Voice Config Management)

- [ ] T047 [US4] Implement voice-config service with CRUD operations in backend/src/services/voice-config.ts
- [ ] T048 [US4] Create voice config routes (GET/PUT /api/voice/config/:agentId) in backend/src/routes/voice.ts
- [ ] T049 [US4] Add voice config persistence (JSON file or .beads) in backend/src/services/voice-config.ts

#### Frontend (Voice Config UI) - Optional Admin UI

- [ ] T050 [US4] Create VoiceConfigPanel component for admin settings in frontend/src/components/voice/VoiceConfigPanel.tsx
- [ ] T051 [US4] Create VoicePreview component to test voice selection in frontend/src/components/voice/VoicePreview.tsx
- [ ] T052 [US4] Add voice settings route to App navigation in frontend/src/App.tsx

**Checkpoint**: Voice configuration fully manageable

---

## Phase 7: Polish & Integration

**Purpose**: Cross-cutting improvements and documentation

- [ ] T053 [P] Update backend .env.example with all voice-related config
- [ ] T054 [P] Create voice feature documentation in specs/004-elevenlabs-voice/quickstart.md
- [ ] T055 [P] Add voice API contracts documentation in specs/004-elevenlabs-voice/contracts/voice-api.md
- [ ] T056 Implement audio cache cleanup cron job in backend/src/services/audio-cache.ts
- [ ] T057 Add ElevenLabs rate limit handling and retry logic in backend/src/services/elevenlabs-client.ts
- [ ] T058 Performance audit: verify audio playback latency < 3 seconds
- [ ] T059 Add JSDoc comments to all voice-related public functions
- [ ] T060 Verify all success criteria (SC-001 through SC-005) pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 and US2 are MVP priority, can run in parallel
  - US3 and US4 are P2, can run in parallel after US1/US2 or concurrently
- **Polish (Phase 7)**: Depends on desired user stories being complete

### Within Each User Story

- Tests MUST be written and FAIL before implementation (per constitution)
- Backend services before routes
- Routes before frontend integration
- Hooks before components
- Components before integration

### Parallel Opportunities

- Phase 1 tasks T001-T005 can run in parallel
- Phase 2 backend tasks can proceed sequentially while frontend prep happens
- Once Foundational completes, US1 and US2 can start in parallel
- Within each story, backend and frontend can progress semi-parallel

---

## MVP Scope

For minimum viable voice integration:

1. **Phase 1**: Setup (5 tasks)
2. **Phase 2**: Foundational (7 tasks)
3. **Phase 3**: US1 Voice Playback (13 tasks)
4. **Phase 4**: US2 Voice Input (10 tasks)

**MVP Total**: 35 tasks

## Full Scope

All phases including notifications and configuration:

| Phase | Tasks | Priority |
|-------|-------|----------|
| Setup | 5 | 1 |
| Foundational | 7 | 1 |
| US1 Voice Playback (MVP) | 13 | 1 |
| US2 Voice Input (MVP) | 10 | 1 |
| US3 Audio Notifications | 10 | 2 |
| US4 Voice Configuration | 7 | 2 |
| Polish | 8 | 3 |
| **Total** | **60** | |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- ELEVENLABS_API_KEY must be set for any voice features to work
- Browser requires user interaction before audio can play (Web Audio API restriction)
- Cache audio aggressively to reduce API costs
- File locking prevents audio overlap issues
- Reference squadron-comms-plugin for proven patterns
