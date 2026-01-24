// ============================================================================
// Voice Zod Schemas - T002
// Runtime validation for voice API requests/responses
// ============================================================================

import { z } from "zod";

// ============================================================================
// Voice Configuration Schemas
// ============================================================================

export const VoiceConfigSchema = z.object({
  voiceId: z.string().min(1, "Voice ID is required"),
  name: z.string().min(1, "Voice name is required"),
  speed: z.number().min(0.7).max(1.2).default(1.0),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

export const AgentVoiceMappingSchema = z.record(z.string(), VoiceConfigSchema);

export const VoiceConfigurationSchema = z.object({
  defaultVoice: VoiceConfigSchema,
  agents: AgentVoiceMappingSchema,
  enabled: z.boolean().default(true),
});

// ============================================================================
// Synthesis Schemas
// ============================================================================

export const SynthesizeRequestSchema = z.object({
  text: z
    .string()
    .min(1, "Text is required")
    .max(5000, "Text exceeds maximum length of 5000 characters"),
  voiceId: z.string().optional(),
  agentId: z.string().optional(),
  messageId: z.string().optional(),
});

export const SynthesizeResponseSchema = z.object({
  audioUrl: z.string(),
  duration: z.number(),
  cached: z.boolean(),
  voiceId: z.string(),
});

// ============================================================================
// Transcription Schemas
// ============================================================================

export const TranscribeResponseSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

// ============================================================================
// Cache Schemas
// ============================================================================

export const AudioCacheEntrySchema = z.object({
  key: z.string(),
  filePath: z.string(),
  voiceId: z.string(),
  duration: z.number(),
  size: z.number(),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
});

// ============================================================================
// ElevenLabs API Schemas
// ============================================================================

export const ElevenLabsModelSchema = z.enum([
  "eleven_monolingual_v1",
  "eleven_multilingual_v1",
  "eleven_multilingual_v2",
  "eleven_turbo_v2",
]);

export const AudioOutputFormatSchema = z.enum([
  "mp3_44100_128",
  "mp3_44100_64",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
]);

// ============================================================================
// Notification Settings Schemas
// ============================================================================

export const VoiceNotificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  minPriority: z.number().int().min(0).max(4).default(2),
  template: z
    .string()
    .default("New message from {{sender}}: {{subject}}"),
  volume: z.number().min(0).max(1).default(0.8),
});

// ============================================================================
// API Request/Response Schemas
// ============================================================================

export const VoiceConfigUpdateSchema = z.object({
  agentId: z.string(),
  config: VoiceConfigSchema,
});

export const VoiceSettingsUpdateSchema = z.object({
  settings: VoiceNotificationSettingsSchema.partial(),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type VoiceConfigSchemaType = z.infer<typeof VoiceConfigSchema>;
export type AgentVoiceMappingSchemaType = z.infer<typeof AgentVoiceMappingSchema>;
export type VoiceConfigurationSchemaType = z.infer<typeof VoiceConfigurationSchema>;
export type SynthesizeRequestSchemaType = z.infer<typeof SynthesizeRequestSchema>;
export type SynthesizeResponseSchemaType = z.infer<typeof SynthesizeResponseSchema>;
export type TranscribeResponseSchemaType = z.infer<typeof TranscribeResponseSchema>;
export type AudioCacheEntrySchemaType = z.infer<typeof AudioCacheEntrySchema>;
export type VoiceNotificationSettingsSchemaType = z.infer<typeof VoiceNotificationSettingsSchema>;
