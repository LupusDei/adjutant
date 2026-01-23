# ElevenLabs Voice Integration - Beads

**Feature**: 004-elevenlabs-voice
**Generated**: 2026-01-21
**Source**: specs/004-elevenlabs-voice/tasks.md

## Root Epic

- **Title**: ElevenLabs Voice Integration for Gastown
- **Type**: epic
- **Priority**: 1
- **Description**: Bidirectional voice communication with agents via ElevenLabs TTS/STT - voice playback for messages, voice input for composition, and audio notifications

## Epics

### Setup: Voice Infrastructure
- **Type**: epic
- **Priority**: 1
- **Description**: Core voice service setup including types, schemas, and configuration
- **Tasks**: 5

### Foundational: ElevenLabs Client
- **Type**: epic
- **Priority**: 1
- **Description**: ElevenLabs API client and supporting utilities (caching, file locking)
- **Blocks**: US1, US2, US3, US4
- **Tasks**: 7

### US1: Voice Message Playback
- **Type**: epic
- **Priority**: 1
- **Description**: Play message audio using ElevenLabs TTS with agent-specific voices
- **MVP**: true
- **Tasks**: 13

### US2: Voice Input for Messages
- **Type**: epic
- **Priority**: 1
- **Description**: Dictate message content using voice transcription
- **MVP**: true
- **Tasks**: 10

### US3: Audio Notifications
- **Type**: epic
- **Priority**: 2
- **Description**: Automatic audio announcements for incoming messages and events
- **Depends**: US1
- **Tasks**: 10

### US4: Agent Voice Configuration
- **Type**: epic
- **Priority**: 2
- **Description**: Admin configuration of voice identities per agent/rig
- **Depends**: US1
- **Tasks**: 7

### Polish: Integration & Documentation
- **Type**: epic
- **Priority**: 3
- **Description**: Documentation, performance optimization, and cross-cutting concerns
- **Depends**: US1, US2, US3, US4
- **Tasks**: 8

## Tasks

### Setup

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T001 | Create voice-related TypeScript types | backend/src/types/voice.ts | Y |
| T002 | Create Zod validation schemas for voice API | backend/src/types/voice-schemas.ts | Y |
| T003 | Add ELEVENLABS_API_KEY to env example | backend/.env.example | Y |
| T004 | Create voice configuration with agent mappings | backend/src/config/voice-config.ts | Y |
| T005 | Create audio cache directory structure | backend/src/services/audio-cache.ts | Y |

### Foundational

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T006 | Write unit tests for ElevenLabs client | backend/tests/unit/elevenlabs-client.test.ts | |
| T007 | Implement ElevenLabs API client with TTS | backend/src/services/elevenlabs-client.ts | |
| T008 | Add STT endpoint support to ElevenLabs client | backend/src/services/elevenlabs-client.ts | |
| T009 | Implement audio file caching | backend/src/services/audio-cache.ts | |
| T010 | Write unit tests for audio-cache service | backend/tests/unit/audio-cache.test.ts | |
| T011 | Create file locking utility | backend/src/utils/file-lock.ts | Y |
| T012 | Write unit tests for file-lock utility | backend/tests/unit/file-lock.test.ts | |

### US1: Voice Message Playback

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T013 | Write unit tests for voice-service synthesize | backend/tests/unit/voice-service.test.ts | Y |
| T014 | Write unit tests for useVoicePlayer hook | frontend/tests/unit/useVoicePlayer.test.ts | Y |
| T015 | Implement voice-service with synthesizeMessage | backend/src/services/voice-service.ts | |
| T016 | Create voice routes (synthesize, audio streaming) | backend/src/routes/voice.ts | |
| T017 | Register voice routes in Express app | backend/src/index.ts | |
| T018 | Add voice config endpoint to voice routes | backend/src/routes/voice.ts | |
| T019 | Create frontend voice types | frontend/src/types/voice.ts | Y |
| T020 | Add voice API methods to API client | frontend/src/services/api.ts | |
| T021 | Implement useVoicePlayer hook | frontend/src/hooks/useVoicePlayer.ts | |
| T022 | Create VoicePlayButton component | frontend/src/components/voice/VoicePlayButton.tsx | |
| T023 | Create AudioProgressBar component | frontend/src/components/voice/AudioProgressBar.tsx | Y |
| T024 | Integrate VoicePlayButton into MailDetail | frontend/src/components/mail/MailDetail.tsx | |
| T025 | Add Pip-Boy themed audio player styles | frontend/src/styles/voice.css | Y |

### US2: Voice Input for Messages

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T026 | Write unit tests for voice-service transcribe | backend/tests/unit/voice-service.test.ts | Y |
| T027 | Write unit tests for useVoiceInput hook | frontend/tests/unit/useVoiceInput.test.ts | Y |
| T028 | Add transcribeAudio method to voice-service | backend/src/services/voice-service.ts | |
| T029 | Create transcription route | backend/src/routes/voice.ts | |
| T030 | Add multer middleware for audio uploads | backend/src/middleware/upload.ts | |
| T031 | Implement useVoiceInput hook | frontend/src/hooks/useVoiceInput.ts | |
| T032 | Create VoiceMicButton component | frontend/src/components/voice/VoiceMicButton.tsx | |
| T033 | Integrate VoiceMicButton into ComposeMessage | frontend/src/components/mail/ComposeMessage.tsx | |
| T034 | Add Web Audio API recorder utility | frontend/src/utils/audio-recorder.ts | Y |
| T035 | Add recording animation styles | frontend/src/styles/voice.css | |

### US3: Audio Notifications

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T036 | Write unit tests for notification-queue | backend/tests/unit/notification-queue.test.ts | Y |
| T037 | Write unit tests for useAudioNotifications | frontend/tests/unit/useAudioNotifications.test.ts | Y |
| T038 | Implement notification-queue service | backend/src/services/notification-queue.ts | |
| T039 | Add synthesizeNotification method | backend/src/services/voice-service.ts | |
| T040 | Create notification settings endpoint | backend/src/routes/voice.ts | |
| T041 | Implement useAudioNotifications hook | frontend/src/hooks/useAudioNotifications.ts | |
| T042 | Create NotificationSettings component | frontend/src/components/voice/NotificationSettings.tsx | |
| T043 | Create MasterMuteToggle component | frontend/src/components/voice/MasterMuteToggle.tsx | Y |
| T044 | Integrate audio notifications into useMail | frontend/src/hooks/useMail.ts | |
| T045 | Add MasterMuteToggle to PipBoyFrame | frontend/src/components/shared/PipBoyFrame.tsx | |

### US4: Agent Voice Configuration

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T046 | Write unit tests for voice-config service | backend/tests/unit/voice-config.test.ts | |
| T047 | Implement voice-config service with CRUD | backend/src/services/voice-config.ts | |
| T048 | Create voice config routes | backend/src/routes/voice.ts | |
| T049 | Add voice config persistence | backend/src/services/voice-config.ts | |
| T050 | Create VoiceConfigPanel component | frontend/src/components/voice/VoiceConfigPanel.tsx | |
| T051 | Create VoicePreview component | frontend/src/components/voice/VoicePreview.tsx | Y |
| T052 | Add voice settings route to App | frontend/src/App.tsx | |

### Polish

| ID | Title | Path | Parallel |
|----|-------|------|----------|
| T053 | Update .env.example with voice config | backend/.env.example | Y |
| T054 | Create voice feature documentation | specs/004-elevenlabs-voice/quickstart.md | Y |
| T055 | Add voice API contracts documentation | specs/004-elevenlabs-voice/contracts/voice-api.md | Y |
| T056 | Implement audio cache cleanup | backend/src/services/audio-cache.ts | |
| T057 | Add rate limit handling to ElevenLabs client | backend/src/services/elevenlabs-client.ts | |
| T058 | Performance audit for audio latency | - | |
| T059 | Add JSDoc comments to voice functions | - | |
| T060 | Verify all success criteria pass | - | |

## Summary

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

## MVP Scope

- Setup: 5 tasks
- Foundational: 7 tasks
- US1 Voice Playback: 13 tasks
- US2 Voice Input: 10 tasks
- **MVP Total**: 35 tasks

## Beads Import Command

To import this epic hierarchy into Gastown:

```bash
cd ~/gt
bd create --file specs/004-elevenlabs-voice/beads-import.md
```

Or manually create the root epic:

```bash
bd create -t "ElevenLabs Voice Integration" \
  -d "Bidirectional voice communication with agents via ElevenLabs TTS/STT" \
  -l epic -l priority:1 -l feature:004-elevenlabs-voice
```

## Agent Assignments (Suggested)

| Epic | Suggested Agent | Rationale |
|------|-----------------|-----------|
| Setup | gastown_boy | Local config/types |
| Foundational | gastown_boy | Core services |
| US1 Playback | gastown_boy | Full-stack feature |
| US2 Voice Input | gastown_boy | Full-stack feature |
| US3 Notifications | gastown_boy | Frontend-heavy |
| US4 Configuration | gastown_boy | Admin UI |
| Polish | gastown_boy | Cross-cutting |

## Voice Profile Defaults

Suggested ElevenLabs voice assignments for agents:

| Agent/Rig | Voice Name | Voice ID | Notes |
|-----------|------------|----------|-------|
| mayor | Bill | pqHfZKP75CvOlQylNhV4 | Command authority |
| gastown | Daniel | onwK4e9ZLuTAKqWW03F9 | Technical precision |
| gastown_boy | Joseph | Zlb1dXrM653N07WRdFW3 | Friendly assistant |
| overseer | Jeremy | bVMeCyTHy58xNoL34h3p | Calm observer |
| polecat-* | Matilda | XrExE9yKIg1WjnnlVkGX | Scout energy |

## Notes

- TDD required: Write tests before implementation
- Cache audio aggressively to reduce ElevenLabs API costs
- File locking prevents overlapping audio playback
- Browser requires user gesture before audio can play
- MVP delivers voice playback + voice input (35 tasks)
- Full feature set adds notifications + config (60 tasks total)
