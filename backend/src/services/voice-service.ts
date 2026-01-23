// ============================================================================
// Voice Service - T015
// High-level voice synthesis and transcription service
// ============================================================================

import {
  synthesizeSpeech,
  transcribeSpeech,
} from "./elevenlabs-client.js";
import {
  isCached,
  getCachedAudio,
  cacheAudio,
  getCacheFilePath,
  generateCacheKey,
} from "./audio-cache.js";
import {
  isVoiceEnabled,
} from "../config/voice-config.js";
import { getVoiceConfigService } from "./voice-config-service.js";
import type {
  TranscribeRequest,
  TranscribeResponse,
  VoiceConfiguration,
} from "../types/voice.js";

// ============================================================================
// Types
// ============================================================================

export interface SynthesizeMessageOptions {
  /** Text to synthesize */
  text: string;
  /** Agent ID for voice lookup */
  agentId?: string;
  /** Direct voice ID (overrides agent lookup) */
  voiceId?: string;
  /** Message ID for cache keying */
  messageId?: string;
}

export interface SynthesizeMessageResult {
  /** URL to access the audio file */
  audioUrl: string;
  /** Duration in seconds */
  duration: number;
  /** Whether served from cache */
  cached: boolean;
  /** Voice ID used */
  voiceId: string;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Synthesize a message to speech.
 * Uses caching to avoid re-synthesis of identical text.
 */
export async function synthesizeMessage(
  options: SynthesizeMessageOptions
): Promise<SynthesizeMessageResult> {
  const { text, agentId, voiceId: explicitVoiceId } = options;

  // Validate text
  if (!text || text.trim().length === 0) {
    throw new Error("Text is required for synthesis");
  }

  // Get saved default settings from voice-config-service
  const configService = getVoiceConfigService();
  const savedDefaults = await configService.getDefaultConfig();

  // Determine voice to use - always apply saved speed/stability/similarityBoost settings
  let voiceConfig: { voiceId: string; speed?: number; stability?: number; similarityBoost?: number };
  if (explicitVoiceId) {
    // Use explicit voiceId but with saved settings for speed/stability/similarityBoost
    voiceConfig = {
      voiceId: explicitVoiceId,
      speed: savedDefaults.speed ?? 1.0,
      stability: savedDefaults.stability ?? 0.5,
      similarityBoost: savedDefaults.similarityBoost ?? 0.75,
    };
  } else if (agentId) {
    // Check for agent-specific config first
    const agentConfig = await configService.getAgentConfig(agentId);
    voiceConfig = {
      voiceId: agentConfig.voiceId,
      speed: agentConfig.speed ?? savedDefaults.speed ?? 1.0,
      stability: agentConfig.stability ?? savedDefaults.stability ?? 0.5,
      similarityBoost: agentConfig.similarityBoost ?? savedDefaults.similarityBoost ?? 0.75,
    };
  } else {
    // Use saved defaults
    voiceConfig = {
      voiceId: savedDefaults.voiceId,
      speed: savedDefaults.speed ?? 1.0,
      stability: savedDefaults.stability ?? 0.5,
      similarityBoost: savedDefaults.similarityBoost ?? 0.75,
    };
  }

  const voiceId = voiceConfig.voiceId;

  // Check cache first
  const cacheKey = generateCacheKey(text, voiceId);
  const cached = await isCached(text, voiceId);

  if (cached) {
    const cachedResult = await getCachedAudio(text, voiceId);
    if (cachedResult) {
      return {
        audioUrl: `/api/voice/audio/${cacheKey}.mp3`,
        duration: cachedResult.entry.duration,
        cached: true,
        voiceId,
      };
    }
  }

  // Synthesize new audio
  const result = await synthesizeSpeech({
    text,
    voiceId,
    stability: voiceConfig.stability ?? 0.5,
    similarityBoost: voiceConfig.similarityBoost ?? 0.75,
    speed: voiceConfig.speed ?? 1.0,
  });

  // Estimate duration (rough estimate: ~150 words per minute)
  const wordCount = text.split(/\s+/).length;
  const estimatedDuration = (wordCount / 150) * 60;

  // Cache the result
  await cacheAudio(
    text,
    voiceId,
    result.audioBuffer,
    estimatedDuration
  );

  return {
    audioUrl: `/api/voice/audio/${cacheKey}.mp3`,
    duration: estimatedDuration,
    cached: false,
    voiceId,
  };
}

/**
 * Transcribe audio to text.
 * T028: Transcription support for US2
 */
export async function transcribeAudio(
  options: TranscribeRequest
): Promise<TranscribeResponse> {
  const result = await transcribeSpeech(options);

  return {
    text: result.text,
    confidence: result.confidence,
  };
}

/**
 * Get voice configuration.
 */
export async function getVoiceConfig(): Promise<VoiceConfiguration> {
  const configService = getVoiceConfigService();
  const savedDefaults = await configService.getDefaultConfig();
  const agentConfigs = await configService.listAgentConfigs();

  // Build agent mappings from saved configs
  const agents: Record<string, { voiceId: string; name: string; speed: number; stability?: number; similarityBoost?: number }> = {};
  for (const config of agentConfigs) {
    const agentVoice: { voiceId: string; name: string; speed: number; stability?: number; similarityBoost?: number } = {
      voiceId: config.voiceId,
      name: config.voiceName ?? config.agentId,
      speed: config.speed ?? 1.0,
    };
    if (config.stability !== undefined) agentVoice.stability = config.stability;
    if (config.similarityBoost !== undefined) agentVoice.similarityBoost = config.similarityBoost;
    agents[config.agentId] = agentVoice;
  }

  const defaultVoice: { voiceId: string; name: string; speed: number; stability?: number; similarityBoost?: number } = {
    voiceId: savedDefaults.voiceId,
    name: savedDefaults.voiceName ?? 'Default',
    speed: savedDefaults.speed ?? 1.0,
  };
  if (savedDefaults.stability !== undefined) defaultVoice.stability = savedDefaults.stability;
  if (savedDefaults.similarityBoost !== undefined) defaultVoice.similarityBoost = savedDefaults.similarityBoost;

  return {
    defaultVoice,
    agents,
    enabled: isVoiceEnabled(),
  };
}

/**
 * Check if voice service is available.
 */
export function isVoiceServiceAvailable(): boolean {
  return isVoiceEnabled();
}

// ============================================================================
// Notification Synthesis - T039 [US3]
// ============================================================================

export interface SynthesizeNotificationOptions {
  /** Notification text to synthesize */
  text: string;
  /** Notification priority affects voice urgency */
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  /** Source identifier for logging */
  source?: string;
}

export interface SynthesizeNotificationResult {
  /** URL to access the audio file */
  audioUrl: string;
  /** Duration in seconds */
  duration: number;
  /** Whether served from cache */
  cached: boolean;
}

/**
 * Synthesize a short notification announcement.
 * Uses the system notification voice with priority-based speed adjustments.
 */
export async function synthesizeNotification(
  options: SynthesizeNotificationOptions
): Promise<SynthesizeNotificationResult> {
  const { text, priority = 'normal' } = options;

  // Validate text
  if (!text || text.trim().length === 0) {
    throw new Error("Notification text is required");
  }

  // Limit notification length
  const maxLength = 200;
  const truncatedText = text.length > maxLength
    ? text.slice(0, maxLength - 3) + '...'
    : text;

  // Get saved default settings from voice-config-service
  const configService = getVoiceConfigService();
  const savedDefaults = await configService.getDefaultConfig();

  // Use saved defaults for notifications
  const voiceConfig = {
    voiceId: savedDefaults.voiceId,
    speed: savedDefaults.speed ?? 1.0,
    stability: savedDefaults.stability ?? 0.5,
    similarityBoost: savedDefaults.similarityBoost ?? 0.75,
  };

  // Adjust speed based on priority (urgent = faster)
  const speedMultiplier: Record<string, number> = {
    urgent: 1.15,
    high: 1.1,
    normal: 1.0,
    low: 0.95,
  };
  const speed = (voiceConfig.speed ?? 1.0) * (speedMultiplier[priority] ?? 1.0);

  const voiceId = voiceConfig.voiceId;

  // Check cache first (include priority in cache key for different speeds)
  const cacheKey = generateCacheKey(`notif:${priority}:${truncatedText}`, voiceId);
  const cached = await isCached(`notif:${priority}:${truncatedText}`, voiceId);

  if (cached) {
    const cachedResult = await getCachedAudio(`notif:${priority}:${truncatedText}`, voiceId);
    if (cachedResult) {
      return {
        audioUrl: `/api/voice/audio/${cacheKey}.mp3`,
        duration: cachedResult.entry.duration,
        cached: true,
      };
    }
  }

  // Synthesize new audio
  const result = await synthesizeSpeech({
    text: truncatedText,
    voiceId,
    stability: voiceConfig.stability ?? 0.6, // Slightly more stable for notifications
    similarityBoost: voiceConfig.similarityBoost ?? 0.75,
    speed,
  });

  // Estimate duration (notifications are short, so ~180 wpm)
  const wordCount = truncatedText.split(/\s+/).length;
  const estimatedDuration = (wordCount / 180) * 60 / speed;

  // Cache the result
  await cacheAudio(
    `notif:${priority}:${truncatedText}`,
    voiceId,
    result.audioBuffer,
    estimatedDuration
  );

  return {
    audioUrl: `/api/voice/audio/${cacheKey}.mp3`,
    duration: estimatedDuration,
    cached: false,
  };
}

/**
 * Get cached audio file path.
 */
export function getAudioFilePath(filename: string): string {
  // Strip .mp3 extension if present to get the cache key
  const cacheKey = filename.replace(/\.mp3$/, "");
  return getCacheFilePath(cacheKey);
}
