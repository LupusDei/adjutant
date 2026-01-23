// ============================================================================
// Voice Configuration - T004
// Default agent voice mappings and settings
// ============================================================================

import type {
  VoiceConfig,
  VoiceConfiguration,
  VoiceNotificationSettings,
  ElevenLabsModel,
  AudioOutputFormat,
} from "../types/voice.js";

// ============================================================================
// ElevenLabs Voice IDs
// These are sample voice IDs - replace with actual ElevenLabs voice IDs
// See: https://elevenlabs.io/docs/api-reference/get-voices
// ============================================================================

export const ELEVENLABS_VOICES = {
  // Male voices
  ADAM: "pNInz6obpgDQGcFmaJgB", // Deep, authoritative
  ANTONI: "ErXwobaYiN019PkySvjV", // Warm, conversational
  ARNOLD: "VR6AewLTigWG4xSOukaG", // Strong, commanding
  CALLUM: "N2lVS1w4EtoT3dr4eOWO", // Clear, professional
  CHARLIE: "IKne3meq5aSn9XLyUdCD", // Friendly, approachable

  // Female voices
  DOMI: "AZnzlk1XvdvUeBnXmlld", // Confident, clear
  ELLI: "MF3mGyEYCl7XYWbV9V6O", // Soft, friendly
  EMILY: "LcfcDJNUP1GQjkzn1xUU", // Professional, warm
  RACHEL: "21m00Tcm4TlvDq8ikWAM", // Expressive, engaging

  // Character voices
  CLYDE: "2EiwWnXFnvU5JabPnv8n", // Gruff, weathered
  DAVE: "CYw3kZ02Hs0563khs1Fj", // Casual, laid-back
  FIN: "D38z5RcWu1voky8WS1ja", // Irish accent
  GLINDA: "z9fAnlkpzviPz146aGWa", // Theatrical, dramatic
  GRACE: "oWAxZDx7w5VEj9dCyTzz", // Elegant, refined
} as const;

// ============================================================================
// Default Voice Configuration
// ============================================================================

/**
 * Default voice used when no agent-specific mapping exists.
 * Using a neutral, professional voice.
 */
export const DEFAULT_VOICE: VoiceConfig = {
  voiceId: ELEVENLABS_VOICES.CALLUM,
  name: "Default (Callum)",
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
};

/**
 * Agent-specific voice mappings.
 * Maps agent identifiers to voice configurations.
 */
export const AGENT_VOICE_MAPPINGS: Record<string, VoiceConfig> = {
  // Town infrastructure
  "mayor/": {
    voiceId: ELEVENLABS_VOICES.ADAM,
    name: "Mayor (Adam)",
    speed: 0.95,
    stability: 0.7,
    similarityBoost: 0.8,
  },
  deacon: {
    voiceId: ELEVENLABS_VOICES.ARNOLD,
    name: "Deacon (Arnold)",
    speed: 1.0,
    stability: 0.6,
    similarityBoost: 0.75,
  },
  daemon: {
    voiceId: ELEVENLABS_VOICES.CLYDE,
    name: "Daemon (Clyde)",
    speed: 1.1,
    stability: 0.5,
    similarityBoost: 0.7,
  },

  // Rig agents (use prefixes for matching)
  witness: {
    voiceId: ELEVENLABS_VOICES.RACHEL,
    name: "Witness (Rachel)",
    speed: 1.0,
    stability: 0.6,
    similarityBoost: 0.75,
  },
  refinery: {
    voiceId: ELEVENLABS_VOICES.EMILY,
    name: "Refinery (Emily)",
    speed: 1.05,
    stability: 0.55,
    similarityBoost: 0.7,
  },

  // Generic crew voice
  crew: {
    voiceId: ELEVENLABS_VOICES.CHARLIE,
    name: "Crew (Charlie)",
    speed: 1.0,
    stability: 0.5,
    similarityBoost: 0.75,
  },

  // Polecats (ephemeral workers)
  polecat: {
    voiceId: ELEVENLABS_VOICES.DAVE,
    name: "Polecat (Dave)",
    speed: 1.1,
    stability: 0.45,
    similarityBoost: 0.65,
  },
};

/**
 * Complete default voice configuration.
 */
export const DEFAULT_VOICE_CONFIGURATION: VoiceConfiguration = {
  defaultVoice: DEFAULT_VOICE,
  agents: AGENT_VOICE_MAPPINGS,
  enabled: true,
};

// ============================================================================
// Notification Settings
// ============================================================================

/**
 * Default notification settings.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: VoiceNotificationSettings = {
  enabled: true,
  minPriority: 2, // Normal and above
  template: "New message from {{sender}}: {{subject}}",
  volume: 0.8,
};

// ============================================================================
// ElevenLabs API Configuration
// ============================================================================

/**
 * ElevenLabs API base URL.
 */
export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Default model for TTS.
 */
export const DEFAULT_ELEVENLABS_MODEL: ElevenLabsModel =
  (process.env["ELEVENLABS_MODEL"] as ElevenLabsModel) || "eleven_turbo_v2";

/**
 * Default output format.
 */
export const DEFAULT_OUTPUT_FORMAT: AudioOutputFormat =
  (process.env["ELEVENLABS_OUTPUT_FORMAT"] as AudioOutputFormat) ||
  "mp3_44100_128";

/**
 * Maximum text length for single synthesis request.
 */
export const MAX_TEXT_LENGTH = 5000;

/**
 * Rate limit: requests per minute.
 */
export const RATE_LIMIT_RPM = 100;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get voice configuration for an agent.
 * Checks exact match first, then prefix match, then falls back to default.
 */
export function getVoiceForAgent(
  agentId: string,
  config: VoiceConfiguration = DEFAULT_VOICE_CONFIGURATION
): VoiceConfig {
  // Exact match
  if (config.agents[agentId]) {
    return config.agents[agentId];
  }

  // Prefix match (e.g., "gastown/witness" matches "witness")
  const agentType = agentId.split("/").pop()?.toLowerCase();
  if (agentType && config.agents[agentType]) {
    return config.agents[agentType];
  }

  // Check for role-based match
  for (const [key, voice] of Object.entries(config.agents)) {
    if (agentId.toLowerCase().includes(key.toLowerCase())) {
      return voice;
    }
  }

  return config.defaultVoice;
}

/**
 * Get the ElevenLabs API key from environment.
 * Throws if not configured.
 */
export function getElevenLabsApiKey(): string {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY environment variable is not set. " +
        "Get your API key from https://elevenlabs.io/app/settings/api-keys"
    );
  }
  return apiKey;
}

/**
 * Check if voice features are available (API key is configured).
 */
export function isVoiceEnabled(): boolean {
  return !!process.env["ELEVENLABS_API_KEY"];
}
