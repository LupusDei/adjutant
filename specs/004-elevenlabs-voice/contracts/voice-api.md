# Voice API Contracts

OpenAPI-style documentation for the Gastown-Boy Voice API.

**Base URL**: `/api/voice`

---

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/synthesize` | Convert text to speech |
| GET | `/audio/:filename` | Stream cached audio file |
| POST | `/transcribe` | Convert speech to text |
| GET | `/status` | Check voice service status |
| GET | `/config` | Get global voice configuration |
| GET | `/config/:agentId` | Get agent's voice config |
| PUT | `/config/:agentId` | Set agent's voice config |
| DELETE | `/config/:agentId` | Delete agent's voice config |
| GET | `/agents` | List agents with custom configs |
| GET | `/defaults` | Get default voice config |
| PUT | `/defaults` | Set default voice config |
| GET | `/settings` | Get notification settings |
| PUT | `/settings` | Update notification settings |
| POST | `/notification` | Synthesize notification audio |

---

## Text-to-Speech

### POST /synthesize

Synthesize text to speech using ElevenLabs TTS.

**Request Body:**

```typescript
{
  text: string;      // Required. 1-5000 characters
  voiceId?: string;  // Optional. Specific ElevenLabs voice ID
  agentId?: string;  // Optional. Look up voice from agent config
  messageId?: string; // Optional. Used for cache key generation
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "audioUrl": "/api/voice/audio/abc123_voice1.mp3",
    "duration": 5.2,
    "cached": false,
    "voiceId": "21m00Tcm4TlvDq8ikWAM"
  }
}
```

**Response (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Text is required"
  }
}
```

**Response (503 Service Unavailable):**

```json
{
  "success": false,
  "error": {
    "code": "VOICE_NOT_AVAILABLE",
    "message": "Voice service is not configured. Set ELEVENLABS_API_KEY environment variable."
  }
}
```

---

### GET /audio/:filename

Stream a cached audio file for playback.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| filename | string | Audio filename (no path traversal) |

**Response (200 OK):**

- Content-Type: `audio/mpeg`
- Supports range requests for seeking (206 Partial Content)
- Cache-Control: 1 day

**Response (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FILENAME",
    "message": "Invalid filename"
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Audio file not found"
  }
}
```

---

## Speech-to-Text

### POST /transcribe

Transcribe audio to text using ElevenLabs STT.

**Request:**

- Content-Type: `audio/webm` or `audio/wav`
- Body: Raw audio buffer

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "text": "Hello, this is the transcribed message.",
    "confidence": 0.95
  }
}
```

**Response (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_AUDIO",
    "message": "Audio data is required"
  }
}
```

---

## Service Status

### GET /status

Check if voice service is available.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "available": true
  }
}
```

---

## Voice Configuration

### GET /config

Get global voice configuration.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "config": {
      "defaultVoice": {
        "voiceId": "21m00Tcm4TlvDq8ikWAM",
        "name": "Rachel",
        "speed": 1.0
      },
      "agents": {}
    }
  }
}
```

---

### GET /config/:agentId

Get voice configuration for a specific agent.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| agentId | string | Agent identifier |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "agentId": "mayor",
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "voiceName": "Rachel",
    "speed": 1.0,
    "stability": 0.5,
    "similarityBoost": 0.75
  }
}
```

---

### PUT /config/:agentId

Set voice configuration for a specific agent.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| agentId | string | Agent identifier |

**Request Body:**

```typescript
{
  voiceId: string;          // Required. ElevenLabs voice ID
  voiceName?: string;       // Optional. Display name
  speed?: number;           // Optional. 0.5-2.0 (default 1.0)
  stability?: number;       // Optional. 0-1
  similarityBoost?: number; // Optional. 0-1
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "agentId": "mayor",
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "voiceName": "Rachel",
    "speed": 1.0,
    "stability": 0.5,
    "similarityBoost": 0.75
  }
}
```

---

### DELETE /config/:agentId

Delete an agent's custom voice configuration. The agent will use default voice.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| agentId | string | Agent identifier |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "agentId": "mayor"
  }
}
```

---

### GET /agents

List all agents with custom voice configurations.

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "agentId": "mayor",
      "voiceId": "21m00Tcm4TlvDq8ikWAM",
      "voiceName": "Rachel",
      "speed": 1.0
    },
    {
      "agentId": "deputy",
      "voiceId": "EXAVITQu4vr4xnSDxMaL",
      "voiceName": "Sam",
      "speed": 1.1
    }
  ]
}
```

---

### GET /defaults

Get default voice configuration used when no agent-specific config exists.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "voiceName": "Rachel",
    "speed": 1.0,
    "stability": 0.5,
    "similarityBoost": 0.75
  }
}
```

---

### PUT /defaults

Set default voice configuration.

**Request Body:**

```typescript
{
  voiceId: string;          // Required. ElevenLabs voice ID
  voiceName?: string;       // Optional. Display name
  speed?: number;           // Optional. 0.5-2.0 (default 1.0)
  stability?: number;       // Optional. 0-1
  similarityBoost?: number; // Optional. 0-1
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "voiceName": "Rachel",
    "speed": 1.0,
    "stability": 0.5,
    "similarityBoost": 0.75
  }
}
```

---

## Notification Settings

### GET /settings

Get audio notification settings.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "volume": 0.8,
    "priorities": {
      "urgent": true,
      "high": true,
      "normal": true,
      "low": false
    },
    "sources": {
      "mail": true,
      "system": true,
      "agent": true
    }
  }
}
```

---

### PUT /settings

Update audio notification settings.

**Request Body:**

```typescript
{
  enabled?: boolean;    // Enable/disable all notifications
  volume?: number;      // 0-1 (default 0.8)
  priorities?: {
    urgent?: boolean;
    high?: boolean;
    normal?: boolean;
    low?: boolean;
  };
  sources?: {
    mail?: boolean;
    system?: boolean;
    agent?: boolean;
  };
}
```

**Response (200 OK):**

Returns the updated settings object.

---

### POST /notification

Synthesize notification audio with filtering based on settings.

**Request Body:**

```typescript
{
  text: string;                                    // Required. Notification text
  priority?: 'urgent' | 'high' | 'normal' | 'low'; // Optional (default: 'normal')
  source?: 'mail' | 'system' | 'agent';            // Optional (default: 'system')
}
```

**Response (200 OK) - Success:**

```json
{
  "success": true,
  "data": {
    "audioUrl": "/api/voice/audio/notif_abc123.mp3",
    "duration": 2.1,
    "cached": false,
    "voiceId": "21m00Tcm4TlvDq8ikWAM"
  }
}
```

**Response (200 OK) - Skipped:**

```json
{
  "success": true,
  "data": {
    "skipped": true,
    "reason": "low priority notifications are disabled"
  }
}
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body or parameters |
| `INVALID_FILENAME` | 400 | Invalid audio filename |
| `INVALID_AUDIO` | 400 | Invalid audio data |
| `NOT_FOUND` | 404 | Resource not found |
| `SYNTHESIS_ERROR` | 500 | TTS synthesis failed |
| `TRANSCRIPTION_ERROR` | 500 | STT transcription failed |
| `CONFIG_ERROR` | 500 | Configuration operation failed |
| `SETTINGS_ERROR` | 500 | Settings operation failed |
| `NOTIFICATION_ERROR` | 500 | Notification synthesis failed |
| `AUDIO_ERROR` | 500 | Audio file operation failed |
| `VOICE_NOT_AVAILABLE` | 503 | Voice service not configured |

---

## Zod Validation Schemas

Located in `backend/src/types/voice-schemas.ts`:

```typescript
// Synthesis request
SynthesizeRequestSchema = {
  text: string (1-5000 chars, required),
  voiceId?: string,
  agentId?: string,
  messageId?: string
}

// Synthesis response
SynthesizeResponseSchema = {
  audioUrl: string,
  duration: number,
  cached: boolean,
  voiceId: string
}

// Transcription response
TranscribeResponseSchema = {
  text: string,
  confidence: number (0-1)
}

// Voice configuration
VoiceConfigSchema = {
  voiceId: string (required),
  name: string (required),
  speed: number (0.5-2.0, default 1.0),
  stability?: number (0-1),
  similarityBoost?: number (0-1)
}
```

---

## Rate Limits

- ElevenLabs API: Configurable via `ELEVENLABS_RATE_LIMIT_RPM` (default: 100/min)
- Text length: Configurable via `ELEVENLABS_MAX_TEXT_LENGTH` (default: 5000 chars)

---

## Caching

Audio files are cached in `AUDIO_CACHE_DIR` (default: `backend/.audio-cache/`).

- Cache key: Based on text hash + voice ID
- Cleanup: Files older than `AUDIO_CACHE_MAX_AGE_HOURS` (default: 168h/7 days)
- Response header indicates if result was cached
