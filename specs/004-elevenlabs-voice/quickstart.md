# ElevenLabs Voice Integration - Quickstart Guide

This guide walks you through setting up and using the voice features in Gastown-Boy.

## Prerequisites

1. **ElevenLabs Account**: Sign up at [elevenlabs.io](https://elevenlabs.io)
2. **API Key**: Get your API key from [Settings > API Keys](https://elevenlabs.io/app/settings/api-keys)
3. **Running Gastown-Boy**: Backend and frontend must be running

## Setup

### 1. Configure Environment

Add your ElevenLabs API key to the backend `.env` file:

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set:

```env
# Required
ELEVENLABS_API_KEY=your_api_key_here

# Optional (defaults shown)
AUDIO_CACHE_DIR=.audio-cache
AUDIO_CACHE_MAX_AGE_HOURS=168
ELEVENLABS_MODEL=eleven_turbo_v2
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_RATE_LIMIT_RPM=100
ELEVENLABS_MAX_TEXT_LENGTH=5000
```

### 2. Start the Services

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

### 3. Verify Setup

Open the dashboard and check the Settings page. The Voice Settings section should show "Connected" status if your API key is valid.

## Features

### Voice Playback (US1)

Listen to messages read aloud by AI voices.

**How to use:**
1. Open any message in Mail Detail view
2. Click the **▶ Play** button next to the message body
3. Audio will synthesize and play automatically
4. Use the progress bar to seek or pause

**Tips:**
- First playback may take 1-2 seconds for synthesis
- Subsequent plays use cached audio (instant)
- Different agents have different voice identities

### Voice Input (US2)

Dictate messages using your microphone.

**How to use:**
1. Open the Compose Message panel
2. Click the **🎤 Mic** button next to the message body
3. Grant microphone permission when prompted
4. Speak your message clearly
5. Click again to stop recording
6. Transcribed text appears in the message body
7. Edit as needed before sending

**Tips:**
- Speak clearly and at a normal pace
- Short pauses are okay
- Edit the transcription before sending

### Audio Notifications (US3)

Receive voice announcements for important events.

**How to configure:**
1. Go to Settings > Voice Settings > Notification Settings
2. Enable "Audio Notifications"
3. Choose notification triggers:
   - New high-priority messages
   - Task completions
   - System alerts
4. Set volume level
5. Test with the "Test Notification" button

**Master Mute:**
Click the speaker icon in the header to mute/unmute all audio.

### Voice Configuration (US4)

Assign custom voices to agents.

**How to configure:**
1. Go to Settings > Voice Settings > Voice Configuration
2. Select an agent from the list
3. Choose a voice from ElevenLabs voice library
4. Adjust settings:
   - **Speed**: 0.5 (slow) to 2.0 (fast)
   - **Stability**: Higher = more consistent
   - **Similarity Boost**: Higher = clearer
5. Click "Preview" to test the voice
6. Save configuration

**Default Voice:**
Set a fallback voice for agents without custom configuration.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/synthesize` | POST | Convert text to speech |
| `/api/voice/audio/:filename` | GET | Stream cached audio |
| `/api/voice/transcribe` | POST | Convert speech to text |
| `/api/voice/config/:agentId` | GET | Get agent voice config |
| `/api/voice/config/:agentId` | PUT | Set agent voice config |
| `/api/voice/defaults` | GET | Get default voice config |
| `/api/voice/defaults` | PUT | Set default voice config |
| `/api/voice/settings` | GET | Get notification settings |
| `/api/voice/settings` | PUT | Update notification settings |

## Troubleshooting

### "API key not configured"

- Ensure `ELEVENLABS_API_KEY` is set in backend `.env`
- Restart the backend after changing `.env`

### "Audio playback failed"

- Check browser console for errors
- Ensure you've interacted with the page (browser audio policy)
- Try refreshing the page

### "Microphone access denied"

- Click the lock icon in the browser address bar
- Enable microphone permission for the site
- Reload the page

### "Synthesis timeout"

- Check your internet connection
- Verify ElevenLabs API status at [status.elevenlabs.io](https://status.elevenlabs.io)
- Long messages may take longer to synthesize

### Audio cache issues

- Cache files are in `backend/.audio-cache/`
- Delete the directory to clear cache
- Cache auto-cleans files older than 168 hours (configurable)

## Cost Management

ElevenLabs charges per character synthesized. To minimize costs:

1. **Enable caching** (enabled by default)
2. **Set reasonable text limits** via `ELEVENLABS_MAX_TEXT_LENGTH`
3. **Use eleven_turbo_v2** model (faster, cheaper)
4. **Avoid re-synthesizing** the same content

Monitor usage in your [ElevenLabs dashboard](https://elevenlabs.io/app/usage).

## Security Notes

- Keep your API key secret - never commit it to version control
- The backend proxies all ElevenLabs requests - keys never reach the frontend
- Audio files are stored locally and served via authenticated endpoints

## Next Steps

- [Voice API Contracts](./contracts/voice-api.md) - Full API documentation
- [Feature Specification](./spec.md) - Detailed requirements
- [Task Breakdown](./tasks.md) - Implementation tasks
