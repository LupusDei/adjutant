# Feature Specification: ElevenLabs Voice Integration

**Feature ID**: 004-elevenlabs-voice
**Status**: Draft
**Created**: 2026-01-21

## Overview

Integrate ElevenLabs text-to-speech and speech-to-text capabilities into the Adjutant dashboard, enabling bidirectional voice communication with agents. Users can speak commands/messages to agents and receive audio updates when tasks complete or important events occur.

## Problem Statement

Currently, all agent communication happens through text-based interfaces. Users must actively monitor the dashboard or terminal for updates. There's no hands-free way to interact with agents or receive notifications while multitasking.

## Goals

1. Enable voice input for sending messages to agents
2. Provide audio narration of incoming messages and notifications
3. Assign distinct voice identities to different agents/rigs
4. Support background audio notifications for task completions
5. Maintain the retro Pip-Boy aesthetic in audio UI components

## Non-Goals

- Real-time voice conversation (streaming bi-directional audio)
- Voice commands for system control (power up/down)
- Multi-language support (English only for MVP)
- Custom voice training/cloning

## User Stories

### US1: Voice Message Playback (P1) - MVP

**As a** user viewing a message in the dashboard
**I want to** click a "play" button to hear the message read aloud
**So that** I can consume messages hands-free while working on other tasks

**Acceptance Criteria:**
- AC1.1: Each message in MailDetail has a voice playback button
- AC1.2: Audio is synthesized using ElevenLabs TTS API
- AC1.3: Different agents have distinct voice identities
- AC1.4: Audio player shows progress indicator
- AC1.5: Audio can be paused/stopped mid-playback
- AC1.6: Generated audio is cached to avoid re-synthesis

### US2: Voice Input for Messages (P1) - MVP

**As a** user composing a message
**I want to** dictate my message using voice input
**So that** I can compose messages without typing

**Acceptance Criteria:**
- AC2.1: ComposeMessage has a microphone button for voice input
- AC2.2: Speech is transcribed using ElevenLabs STT or Web Speech API
- AC2.3: Transcribed text appears in the message body field
- AC2.4: Visual indicator shows when recording is active
- AC2.5: User can edit transcribed text before sending

### US3: Audio Notifications (P2)

**As a** user with the dashboard open
**I want to** hear audio announcements when important events occur
**So that** I'm alerted without watching the screen

**Acceptance Criteria:**
- AC3.1: Incoming high-priority messages trigger voice announcement
- AC3.2: User can configure which events trigger audio
- AC3.3: Announcements include sender and subject
- AC3.4: Audio queue prevents overlapping announcements
- AC3.5: Master mute toggle disables all audio

### US4: Agent Voice Configuration (P2)

**As an** administrator
**I want to** assign specific ElevenLabs voices to agents
**So that** each agent has a recognizable audio identity

**Acceptance Criteria:**
- AC4.1: Voice configuration stored in backend config
- AC4.2: Mapping from agent/rig name to ElevenLabs voice ID
- AC4.3: Default voice for unmapped agents
- AC4.4: Configurable speech rate per voice
- AC4.5: API endpoint to retrieve voice configuration

## Technical Requirements

### TR1: ElevenLabs API Integration
- Secure API key management (environment variable)
- TTS endpoint: `/v1/text-to-speech/{voice_id}`
- STT endpoint: `/v1/speech-to-text`
- Rate limiting and error handling
- Response streaming for long messages

### TR2: Audio File Management
- Cache generated audio files locally
- File naming: `{message_id}_{voice_id}.mp3`
- Configurable cache directory
- Cache cleanup policy (age-based)

### TR3: Playback Coordination
- File locking to prevent overlapping audio
- Queue system for notifications
- Web Audio API for frontend playback
- Volume control integration

### TR4: Voice Configuration Schema
```typescript
interface VoiceConfig {
  voiceId: string;        // ElevenLabs voice ID
  name: string;           // Display name
  speed: number;          // 0.5-2.0, default 1.0
  stability?: number;     // 0-1, voice consistency
  similarityBoost?: number; // 0-1, voice clarity
}

interface AgentVoiceMapping {
  [agentOrRig: string]: VoiceConfig;
}
```

## API Contracts

### POST /api/voice/synthesize
Synthesize text to speech.

**Request:**
```json
{
  "text": "Message content to synthesize",
  "voiceId": "optional-voice-id",
  "agentId": "optional-agent-for-voice-lookup"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "audioUrl": "/api/voice/audio/abc123.mp3",
    "duration": 5.2,
    "cached": false
  }
}
```

### GET /api/voice/audio/:filename
Stream cached audio file.

### POST /api/voice/transcribe
Transcribe audio to text.

**Request:** `multipart/form-data` with audio file

**Response:**
```json
{
  "success": true,
  "data": {
    "text": "Transcribed message content",
    "confidence": 0.95
  }
}
```

### GET /api/voice/config
Get voice configuration for all agents.

## Dependencies

- ElevenLabs API account and API key
- PortAudio (optional, for backend playback)
- Web Audio API (frontend)
- ffmpeg (optional, for audio format conversion)

## Success Criteria

- SC-001: Voice playback works for any message within 3 seconds
- SC-002: Voice input transcription accuracy > 90% for English
- SC-003: Audio notifications don't overlap
- SC-004: Cache hit rate > 80% for repeated messages
- SC-005: No audio artifacts or glitches during playback

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ElevenLabs API costs | High volume = high cost | Aggressive caching, rate limiting |
| API rate limits | Service degradation | Queue system, graceful fallback |
| Browser audio restrictions | Playback fails | User interaction to enable audio |
| Voice quality variance | Poor UX | Curated voice selection, testing |

## Reference Implementation

Based on patterns from [squadron-comms-plugin](https://github.com/1Shot-Labs/squadron-comms-plugin):
- Hybrid architecture: ElevenLabs TTS + local playback
- File locking for concurrent broadcast safety
- Pre-configured voice profiles per agent
- Mission logging for audit trail
