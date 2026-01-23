// ============================================================================
// Voice Types - T001
// ElevenLabs voice integration type definitions
// ============================================================================

/**
 * Configuration for an ElevenLabs voice.
 */
export interface VoiceConfig {
  /** ElevenLabs voice ID */
  voiceId: string;
  /** Display name for the voice */
  name: string;
  /** Speech rate multiplier (0.5-2.0, default 1.0) */
  speed: number;
  /** Voice consistency/stability (0-1) */
  stability?: number;
  /** Voice clarity/similarity boost (0-1) */
  similarityBoost?: number;
}

/**
 * Mapping from agent/rig identifiers to voice configurations.
 */
export interface AgentVoiceMapping {
  [agentOrRig: string]: VoiceConfig;
}

/**
 * Complete voice configuration including default and agent mappings.
 */
export interface VoiceConfiguration {
  /** Default voice for unmapped agents */
  defaultVoice: VoiceConfig;
  /** Agent-specific voice mappings */
  agents: AgentVoiceMapping;
  /** Whether voice features are enabled */
  enabled: boolean;
}

/**
 * Request to synthesize text to speech.
 */
export interface SynthesizeRequest {
  /** Text content to synthesize */
  text: string;
  /** Optional specific voice ID (overrides agent lookup) */
  voiceId?: string;
  /** Optional agent ID for voice lookup */
  agentId?: string;
  /** Optional message ID for caching */
  messageId?: string;
}

/**
 * Response from synthesis operation.
 */
export interface SynthesizeResponse {
  /** URL to access the audio file */
  audioUrl: string;
  /** Duration of audio in seconds */
  duration: number;
  /** Whether audio was served from cache */
  cached: boolean;
  /** Voice ID used for synthesis */
  voiceId: string;
}

/**
 * Request to transcribe audio to text.
 */
export interface TranscribeRequest {
  /** Audio file buffer */
  audio: Buffer;
  /** Audio format (e.g., 'audio/webm', 'audio/wav') */
  mimeType: string;
}

/**
 * Response from transcription operation.
 */
export interface TranscribeResponse {
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Audio cache entry metadata.
 */
export interface AudioCacheEntry {
  /** Cache key (hash of text + voiceId) */
  key: string;
  /** Path to cached audio file */
  filePath: string;
  /** Voice ID used for synthesis */
  voiceId: string;
  /** Duration in seconds */
  duration: number;
  /** Size in bytes */
  size: number;
  /** ISO timestamp when cached */
  createdAt: string;
  /** ISO timestamp of last access */
  lastAccessedAt: string;
}

/**
 * ElevenLabs TTS model options.
 */
export type ElevenLabsModel =
  | "eleven_monolingual_v1"
  | "eleven_multilingual_v1"
  | "eleven_multilingual_v2"
  | "eleven_turbo_v2";

/**
 * ElevenLabs output format options.
 */
export type AudioOutputFormat =
  | "mp3_44100_128"
  | "mp3_44100_64"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_44100";

/**
 * Voice notification settings.
 */
export interface VoiceNotificationSettings {
  /** Enable audio notifications */
  enabled: boolean;
  /** Minimum priority level to announce (0=all, higher=fewer) */
  minPriority: number;
  /** Announcement template (supports {{sender}}, {{subject}}) */
  template: string;
  /** Master volume (0-1) */
  volume: number;
}
