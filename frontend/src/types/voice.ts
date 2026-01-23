// ============================================================================
// Voice Types - T019
// Frontend types for voice integration
// ============================================================================

/**
 * Voice configuration for an agent.
 */
export interface VoiceConfig {
  voiceId: string;
  name: string;
  speed: number;
  stability?: number;
  similarityBoost?: number;
}

/**
 * Agent voice mapping.
 */
export interface AgentVoiceMapping {
  [agentOrRig: string]: VoiceConfig;
}

/**
 * Complete voice configuration.
 */
export interface VoiceConfiguration {
  defaultVoice: VoiceConfig;
  agents: AgentVoiceMapping;
  enabled: boolean;
}

/**
 * Request to synthesize text.
 */
export interface SynthesizeRequest {
  text: string;
  voiceId?: string;
  agentId?: string;
  messageId?: string;
}

/**
 * Response from synthesis.
 */
export interface SynthesizeResponse {
  audioUrl: string;
  duration: number;
  cached: boolean;
  voiceId: string;
}

/**
 * Voice player state.
 */
export type VoicePlayerState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'error';

/**
 * Voice transcription response.
 */
export interface TranscribeResponse {
  text: string;
  confidence: number;
}

/**
 * Voice service status.
 */
export interface VoiceStatus {
  available: boolean;
}

/**
 * Voice config response from API.
 */
export interface VoiceConfigResponse {
  enabled: boolean;
  config: VoiceConfiguration;
}
