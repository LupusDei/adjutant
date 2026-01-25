# Adjutant iOS App - API Contract Specification

## Overview

This document defines the complete API contract for the Adjutant backend. All endpoints use JSON for request/response bodies and follow RESTful conventions.

**Base URL:** `/api`

---

## Standard Response Envelope

All API responses follow this structure:

```typescript
interface ApiResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (present if success=true) */
  data?: T;
  /** Error information (present if success=false) */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  /** ISO 8601 response timestamp */
  timestamp: string;
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `NOT_FOUND` | 404 | Resource not found |
| `ALREADY_RUNNING` | 409 | Resource already in requested state |
| `ALREADY_STOPPED` | 409 | Resource already in requested state |
| `INTERNAL_ERROR` | 500 | Server error |
| `VOICE_NOT_AVAILABLE` | 503 | Voice service not configured |
| `TIMEOUT` | 408 | Request timed out |
| `NETWORK_ERROR` | N/A | Network connectivity issue |

---

## Data Types

### Enums

```typescript
/** Priority levels for messages. Lower number = higher priority. */
type MessagePriority = 0 | 1 | 2 | 3 | 4;

/** Message types indicating the purpose of the message. */
type MessageType = "notification" | "task" | "scavenge" | "reply";

/** Possible states for the gastown system. */
type PowerState = "stopped" | "starting" | "running" | "stopping";

/** Possible statuses for a crew member. */
type CrewMemberStatus = "idle" | "working" | "blocked" | "stuck" | "offline";

/** Agent types in gastown. */
type AgentType = "mayor" | "deacon" | "witness" | "refinery" | "crew" | "polecat";
```

### Core Models

#### Message

```typescript
interface Message {
  /** Unique identifier (beads issue ID format, e.g., "gb-53tj") */
  id: string;
  /** Sender address (e.g., "mayor/", "greenplace/Toast") */
  from: string;
  /** Recipient address */
  to: string;
  /** Message subject line */
  subject: string;
  /** Full message body content */
  body: string;
  /** ISO 8601 timestamp when message was sent */
  timestamp: string;
  /** Whether the message has been read */
  read: boolean;
  /** Priority level: 0=urgent, 1=high, 2=normal, 3=low, 4=lowest */
  priority: MessagePriority;
  /** Type indicating message purpose */
  type: MessageType;
  /** Thread ID for grouping related messages */
  threadId: string;
  /** ID of message being replied to (if type is 'reply') */
  replyTo?: string;
  /** If true, message won't be auto-archived */
  pinned: boolean;
  /** Additional recipient addresses */
  cc?: string[];
  /** True if this is an infrastructure/coordination message */
  isInfrastructure: boolean;
}
```

#### CrewMember

```typescript
interface CrewMember {
  /** Unique identifier (e.g., "greenplace/Toast") */
  id: string;
  /** Display name */
  name: string;
  /** Agent type for icon/styling */
  type: AgentType;
  /** Which rig this agent belongs to (null for town-level) */
  rig: string | null;
  /** Current operational status */
  status: CrewMemberStatus;
  /** Current task description (if working) */
  currentTask?: string;
  /** Number of unread messages */
  unreadMail: number;
  /** First unread message subject (for preview) */
  firstSubject?: string;
  /** Sender of first unread message (for preview) */
  firstFrom?: string;
  /** Current git branch (for polecats) */
  branch?: string;
}
```

#### GastownStatus

```typescript
interface AgentStatus {
  /** Agent identifier */
  name: string;
  /** Whether the agent is currently running */
  running: boolean;
  /** Work items pinned to this agent */
  pinnedWork?: string[];
  /** Number of unread messages */
  unreadMail: number;
  /** First unread message subject (for preview) */
  firstMessageSubject?: string;
  /** Special states like 'stuck' or 'awaiting-gate' */
  state?: "stuck" | "awaiting-gate" | "idle" | "working";
}

interface RigStatus {
  /** Rig name */
  name: string;
  /** Rig root path */
  path: string;
  /** Witness agent for this rig */
  witness: AgentStatus;
  /** Refinery agent for this rig */
  refinery: AgentStatus;
  /** Crew workers for this rig */
  crew: AgentStatus[];
  /** Active polecats (ephemeral workers) */
  polecats: AgentStatus[];
  /** Merge queue summary */
  mergeQueue: {
    pending: number;
    inFlight: number;
    blocked: number;
  };
}

interface GastownStatus {
  /** Current power state */
  powerState: PowerState;
  /** Town metadata */
  town: {
    name: string;
    root: string;
  };
  /** Operator (human user) information */
  operator: {
    name: string;
    email: string;
    unreadMail: number;
  };
  /** Infrastructure agent statuses */
  infrastructure: {
    mayor: AgentStatus;
    deacon: AgentStatus;
    daemon: AgentStatus;
  };
  /** Per-rig agent information */
  rigs: RigStatus[];
  /** Timestamp of this status snapshot */
  fetchedAt: string;
}
```

#### Convoy

```typescript
interface TrackedIssue {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  issueType?: string;
  updatedAt?: string;
  priority?: number;
  description?: string;
}

interface Convoy {
  id: string;
  title: string;
  status: string;
  /** The rig this convoy is associated with, or null for town-level convoys */
  rig: string | null;
  progress: {
    completed: number;
    total: number;
  };
  trackedIssues: TrackedIssue[];
}
```

#### BeadInfo

```typescript
interface BeadInfo {
  /** Bead ID (e.g., "gb-53tj") */
  id: string;
  /** Bead title */
  title: string;
  /** Status (open, closed, etc.) */
  status: string;
  /** Priority (0-4, lower = higher priority) */
  priority: number;
  /** Issue type (feature, bug, task, etc.) */
  type: string;
  /** Assignee address or null */
  assignee: string | null;
  /** Rig name extracted from assignee or null for town-level */
  rig: string | null;
  /** Source database: "town" for hq-*, or rig name for rig-specific beads */
  source: string;
  /** Labels attached to the bead */
  labels: string[];
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string | null;
}
```

### Paginated Response

```typescript
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}
```

---

## Endpoints

### Status

#### GET /api/status

Get current Gastown system status.

**Response:** `ApiResponse<GastownStatus>`

**Example Response:**
```json
{
  "success": true,
  "data": {
    "powerState": "running",
    "town": {
      "name": "gastown",
      "root": "/Users/dev/gt"
    },
    "operator": {
      "name": "developer",
      "email": "dev@example.com",
      "unreadMail": 3
    },
    "infrastructure": {
      "mayor": { "name": "mayor", "running": true, "unreadMail": 0 },
      "deacon": { "name": "deacon", "running": true, "unreadMail": 0 },
      "daemon": { "name": "daemon", "running": true, "unreadMail": 0 }
    },
    "rigs": [...],
    "fetchedAt": "2024-01-15T10:30:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Power

#### GET /api/power/status

Get current power state (alias for status endpoint).

**Response:** `ApiResponse<GastownStatus>`

#### POST /api/power/up

Start Gastown.

**Request Body:** None

**Response:** `ApiResponse<{ previousState: PowerState; newState: PowerState }>`

**Error Codes:**
- `ALREADY_RUNNING` (409): Gastown is already running

#### POST /api/power/down

Stop Gastown.

**Request Body:** None

**Response:** `ApiResponse<{ previousState: PowerState; newState: PowerState }>`

**Error Codes:**
- `ALREADY_STOPPED` (409): Gastown is already stopped

---

### Mail

#### GET /api/mail

List all mail messages.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `filter` | `"user" \| "infrastructure"` | none | Filter by message category |
| `all` | `"true"` | false | Include all messages (override default filters) |

**Response:** `ApiResponse<PaginatedResponse<Message>>`

**Example Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "gb-53tj",
        "from": "mayor/",
        "to": "overseer",
        "subject": "Task completed",
        "body": "The requested task has been completed.",
        "timestamp": "2024-01-15T10:00:00.000Z",
        "read": false,
        "priority": 2,
        "type": "notification",
        "threadId": "thread-abc123",
        "pinned": false,
        "isInfrastructure": false
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### POST /api/mail

Send a new message.

**Request Body:**
```typescript
interface SendMessageRequest {
  /** Recipient address (default: "mayor/") */
  to?: string;
  /** Sender address (default: resolved from environment) */
  from?: string;
  /** Message subject (required) */
  subject: string;
  /** Message body (required) */
  body: string;
  /** Priority level (default: 2) */
  priority?: MessagePriority;
  /** Message type (default: 'task') */
  type?: MessageType;
  /** ID of message being replied to */
  replyTo?: string;
  /** If true, append reply instructions with message ID to body */
  includeReplyInstructions?: boolean;
}
```

**Response:** `ApiResponse<{ sent: true }>`

**Validation:**
- `subject`: Required, min length 1
- `body`: Required, min length 1

**Example Request:**
```json
{
  "to": "mayor/",
  "subject": "New feature request",
  "body": "Please implement the following feature...",
  "priority": 2,
  "type": "task"
}
```

#### GET /api/mail/identity

Get the current mail sender identity.

**Response:** `ApiResponse<{ identity: string }>`

#### GET /api/mail/:id

Get a single message by ID.

**Path Parameters:**
- `id`: Message ID (URL encoded)

**Response:** `ApiResponse<Message>`

**Error Codes:**
- `NOT_FOUND` (404): Message not found

#### POST /api/mail/:id/read

Mark a message as read. Idempotent.

**Path Parameters:**
- `id`: Message ID (URL encoded)

**Response:** `ApiResponse<{ read: true }>`

**Error Codes:**
- `NOT_FOUND` (404): Message not found

---

### Agents

#### GET /api/agents

Get all agents as CrewMember list.

**Response:** `ApiResponse<CrewMember[]>`

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "mayor/",
      "name": "mayor",
      "type": "mayor",
      "rig": null,
      "status": "working",
      "unreadMail": 0,
      "currentTask": "Processing task queue"
    },
    {
      "id": "greenplace/polecat-abc123",
      "name": "polecat-abc123",
      "type": "polecat",
      "rig": "greenplace",
      "status": "working",
      "unreadMail": 1,
      "firstSubject": "Task assigned",
      "branch": "polecat/feature-xyz"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### POST /api/agents/spawn-polecat

Request polecat spawn for a rig. Sends a task message to the mayor.

**Request Body:**
```typescript
interface SpawnPolecatRequest {
  /** Rig name (required) */
  rig: string;
}
```

**Response:** `ApiResponse<{ rig: string; requested: true }>`

**Validation:**
- `rig`: Required, min length 1

#### GET /api/agents/:rig/:polecat/terminal

Capture polecat terminal content (tmux session).

**Path Parameters:**
- `rig`: Rig name (URL encoded)
- `polecat`: Polecat name (URL encoded)

**Response:**
```typescript
ApiResponse<{
  /** Terminal content with ANSI escape codes */
  content: string;
  /** tmux session name (e.g., "gt-greenplace-polecat-abc123") */
  sessionName: string;
  /** ISO 8601 capture timestamp */
  timestamp: string;
}>
```

**Error Codes:**
- `NOT_FOUND` (404): Terminal session not found

---

### Convoys

#### GET /api/convoys

Get active convoys.

**Response:** `ApiResponse<Convoy[]>`

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "convoy-001",
      "title": "User Authentication Feature",
      "status": "in_progress",
      "rig": "greenplace",
      "progress": {
        "completed": 3,
        "total": 5
      },
      "trackedIssues": [
        {
          "id": "gb-auth1",
          "title": "Implement login form",
          "status": "closed",
          "priority": 1
        },
        {
          "id": "gb-auth2",
          "title": "Add session management",
          "status": "in_progress",
          "priority": 2
        }
      ]
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Beads

#### GET /api/beads

List beads with filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `rig` | string | none | Filter by rig (omit for all beads) |
| `status` | string | `"default"` | Status filter (see options below) |
| `type` | string | none | Filter by bead type |
| `limit` | number | 500 | Maximum results |
| `excludeTown` | `"true"` | false | Exclude hq- town beads |

**Status Options:**
- `"default"`: Shows open + in_progress + blocked (active work)
- `"open"`: Open issues only
- `"hooked"`: Hooked issues only
- `"in_progress"`: In progress only
- `"blocked"`: Blocked only
- `"deferred"`: Deferred only
- `"closed"`: Closed only
- `"all"`: All statuses
- Comma-separated list: e.g., `"open,in_progress,blocked"`

**Response:** `ApiResponse<BeadInfo[]>`

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "gb-53tj",
      "title": "Implement user dashboard",
      "status": "in_progress",
      "priority": 1,
      "type": "feature",
      "assignee": "greenplace/polecat-abc123",
      "rig": "greenplace",
      "source": "greenplace",
      "labels": ["frontend", "high-priority"],
      "createdAt": "2024-01-10T08:00:00.000Z",
      "updatedAt": "2024-01-15T09:30:00.000Z"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Tunnel

#### GET /api/tunnel/status

Get current ngrok tunnel status.

**Response:**
```typescript
ApiResponse<{
  state: "stopped" | "starting" | "running" | "error";
  publicUrl?: string;
  error?: string;
}>
```

#### POST /api/tunnel/start

Start the ngrok tunnel.

**Request Body:** None

**Response:**
```typescript
ApiResponse<{
  state: "running" | "starting";
  publicUrl?: string;
}>
```

**Error Codes:**
- `ALREADY_RUNNING` (409): Tunnel already running

#### POST /api/tunnel/stop

Stop the ngrok tunnel.

**Request Body:** None

**Response:**
```typescript
ApiResponse<{
  state: "stopped";
}>
```

**Error Codes:**
- `ALREADY_STOPPED` (409): Tunnel already stopped

---

### Voice

#### GET /api/voice/status

Check if voice service is available.

**Response:**
```typescript
ApiResponse<{
  available: boolean;
}>
```

#### GET /api/voice/config

Get global voice configuration.

**Response:**
```typescript
ApiResponse<{
  enabled: boolean;
  config: VoiceConfiguration;
}>

interface VoiceConfiguration {
  defaultVoice: VoiceConfig;
  agents: { [agentId: string]: VoiceConfig };
  enabled: boolean;
}

interface VoiceConfig {
  voiceId: string;
  name: string;
  speed: number;
  stability?: number;
  similarityBoost?: number;
}
```

#### POST /api/voice/synthesize

Synthesize text to speech.

**Request Body:**
```typescript
interface SynthesizeRequest {
  /** Text content to synthesize (required, max 5000 chars) */
  text: string;
  /** Optional specific voice ID (overrides agent lookup) */
  voiceId?: string;
  /** Optional agent ID for voice lookup */
  agentId?: string;
  /** Optional message ID for caching */
  messageId?: string;
}
```

**Response:**
```typescript
ApiResponse<{
  /** URL path to access the audio file (e.g., "/api/voice/audio/abc123.mp3") */
  audioUrl: string;
  /** Duration of audio in seconds */
  duration: number;
  /** Whether audio was served from cache */
  cached: boolean;
  /** Voice ID used for synthesis */
  voiceId: string;
}>
```

**Validation:**
- `text`: Required, min 1 char, max 5000 chars

**Error Codes:**
- `VOICE_NOT_AVAILABLE` (503): Voice service not configured
- `SYNTHESIS_ERROR` (500): Synthesis failed

#### GET /api/voice/audio/:filename

Serve cached audio file.

**Path Parameters:**
- `filename`: Audio file name (URL encoded, no path traversal)

**Response:**
- Content-Type: `audio/mpeg`
- Supports range requests for seeking
- Cache-Control: `public, max-age=86400`

**Error Codes:**
- `INVALID_FILENAME` (400): Invalid filename
- `NOT_FOUND` (404): Audio file not found

#### POST /api/voice/transcribe

Transcribe audio to text.

**Request:**
- Content-Type: `audio/*` or `application/octet-stream`
- Body: Raw audio data (max 10MB)

**Response:**
```typescript
ApiResponse<{
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
}>
```

**Error Codes:**
- `VOICE_NOT_AVAILABLE` (503): Voice service not configured
- `INVALID_AUDIO` (400): Audio data required
- `TRANSCRIPTION_ERROR` (500): Transcription failed

#### GET /api/voice/settings

Get notification settings.

**Response:**
```typescript
ApiResponse<{
  enabled: boolean;
  volume: number;
  priorities: {
    urgent: boolean;
    high: boolean;
    normal: boolean;
    low: boolean;
  };
  sources: {
    mail: boolean;
    system: boolean;
    agent: boolean;
  };
}>
```

#### PUT /api/voice/settings

Update notification settings.

**Request Body:**
```typescript
interface NotificationSettingsUpdate {
  enabled?: boolean;
  volume?: number;  // 0-1
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

**Response:** Same as GET /api/voice/settings

#### POST /api/voice/notification

Synthesize notification audio.

**Request Body:**
```typescript
interface NotificationRequest {
  /** Notification text (required) */
  text: string;
  /** Priority level */
  priority?: "urgent" | "high" | "normal" | "low";
  /** Notification source */
  source?: "mail" | "system" | "agent";
}
```

**Response:**
```typescript
// If processed:
ApiResponse<{
  audioUrl: string;
  duration: number;
  cached: boolean;
  voiceId: string;
}>

// If skipped due to settings:
ApiResponse<{
  skipped: true;
  reason: string;
}>
```

#### GET /api/voice/config/:agentId

Get agent's voice configuration.

**Path Parameters:**
- `agentId`: Agent identifier (URL encoded)

**Response:**
```typescript
ApiResponse<{
  agentId: string;
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}>
```

#### PUT /api/voice/config/:agentId

Set agent's voice configuration.

**Path Parameters:**
- `agentId`: Agent identifier (URL encoded)

**Request Body:**
```typescript
interface AgentVoiceConfigUpdate {
  /** Voice ID (required) */
  voiceId: string;
  /** Voice display name */
  voiceName?: string;
  /** Speed multiplier (0.5-2.0) */
  speed?: number;
  /** Stability (0-1) */
  stability?: number;
  /** Similarity boost (0-1) */
  similarityBoost?: number;
}
```

**Response:** Same as GET /api/voice/config/:agentId

#### DELETE /api/voice/config/:agentId

Delete agent's custom voice configuration.

**Path Parameters:**
- `agentId`: Agent identifier (URL encoded)

**Response:** `ApiResponse<{ deleted: true; agentId: string }>`

#### GET /api/voice/agents

List all agents with custom voice configurations.

**Response:** `ApiResponse<AgentVoiceConfig[]>`

#### GET /api/voice/defaults

Get default voice configuration.

**Response:**
```typescript
ApiResponse<{
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}>
```

#### PUT /api/voice/defaults

Set default voice configuration.

**Request Body:**
```typescript
interface DefaultVoiceConfigUpdate {
  /** Voice ID (required) */
  voiceId: string;
  /** Voice display name */
  voiceName?: string;
  /** Speed multiplier (0.5-2.0) */
  speed?: number;
  /** Stability (0-1) */
  stability?: number;
  /** Similarity boost (0-1) */
  similarityBoost?: number;
}
```

**Response:** Same as GET /api/voice/defaults

---

## Available ElevenLabs Voices

The following voices are available for configuration:

| Voice ID | Name |
|----------|------|
| `pNInz6obpgDQGcFmaJgB` | Adam |
| `ErXwobaYiN019PkySvjV` | Antoni |
| `VR6AewLTigWG4xSOukaG` | Arnold |
| `N2lVS1w4EtoT3dr4eOWO` | Callum |
| `IKne3meq5aSn9XLyUdCD` | Charlie |
| `AZnzlk1XvdvUeBnXmlld` | Domi |
| `MF3mGyEYCl7XYWbV9V6O` | Elli |
| `LcfcDJNUP1GQjkzn1xUU` | Emily |
| `21m00Tcm4TlvDq8ikWAM` | Rachel |
| `2EiwWnXFnvU5JabPnv8n` | Clyde |
| `CYw3kZ02Hs0563khs1Fj` | Dave |

---

## HTTP Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes (for POST/PUT) | `application/json` for JSON, `audio/*` for voice transcribe |

### Response Headers

All responses include:
- `Content-Type: application/json` (for JSON responses)
- `Content-Type: audio/mpeg` (for audio files)

Audio file responses also include:
- `Content-Length`
- `Accept-Ranges: bytes`
- `Cache-Control: public, max-age=86400`

---

## Polling Recommendations

| Resource | Recommended Interval | Notes |
|----------|---------------------|-------|
| Status | 60 seconds | Power state changes slowly |
| Mail | 30 seconds | When mail tab active |
| Agents | 60 seconds | Agent status is stable |
| Convoys | 30 seconds | Progress updates |
| Beads | 30 seconds | When beads tab active |
| Terminal | 2 seconds | Only when expanded |

---

## iOS Implementation Notes

### Network Configuration

1. **Base URL Configuration**
   - Development: `http://localhost:3001/api`
   - Production: Configure via environment or settings

2. **Timeout Handling**
   - Default timeout: 30 seconds
   - Terminal polling: 10 seconds
   - Voice synthesis: 60 seconds (longer audio)

3. **Error Recovery**
   - Implement exponential backoff for retries
   - Cache last successful responses for offline display
   - Show clear error states to user

### Audio Handling

1. **Voice Playback**
   - Support range requests for seeking
   - Handle audio interruptions (phone calls)
   - Respect silent mode settings

2. **Voice Recording**
   - Request microphone permission
   - Support WebM or WAV format
   - Handle recording interruptions

### Background Refresh

Consider implementing background refresh for:
- Unread message count (badge)
- Critical system status changes

### Caching Strategy

| Resource | Cache Strategy |
|----------|----------------|
| Status | Short-lived (30s) |
| Messages | Cache list, refresh on tab focus |
| Agents | Cache list, refresh on tab focus |
| Audio | Long-lived (24 hours), use URL as key |
| Voice config | Cache until changed |
