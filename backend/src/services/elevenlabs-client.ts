// ============================================================================
// ElevenLabs Client - T007, T008
// API client for ElevenLabs TTS and STT services
// ============================================================================

import {
  getElevenLabsApiKey,
  ELEVENLABS_API_BASE,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  MAX_TEXT_LENGTH,
} from "../config/voice-config.js";
import type { ElevenLabsModel, AudioOutputFormat } from "../types/voice.js";

// ============================================================================
// Rate Limiting & Retry Configuration (T057)
// ============================================================================

/** Default rate limit: requests per minute */
const DEFAULT_RATE_LIMIT_RPM = 100;

/** Default max retries for transient errors */
const DEFAULT_MAX_RETRIES = 3;

/** Initial retry delay in milliseconds */
const INITIAL_RETRY_DELAY_MS = 1000;

/** Maximum retry delay in milliseconds */
const MAX_RETRY_DELAY_MS = 30000;

/** HTTP status codes that indicate transient errors (worth retrying) */
const TRANSIENT_ERROR_CODES = [408, 429, 500, 502, 503, 504];

// ============================================================================
// Rate Limiter Implementation (T057)
// ============================================================================

/**
 * Simple sliding window rate limiter.
 */
class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(requestsPerMinute: number) {
    this.windowMs = 60 * 1000; // 1 minute window
    this.maxRequests = requestsPerMinute;
  }

  /**
   * Check if a request can be made without exceeding rate limit.
   */
  canRequest(): boolean {
    this.cleanupOldRequests();
    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Record a request timestamp.
   */
  recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Get the time until the next request can be made (0 if can request now).
   */
  getWaitTimeMs(): number {
    this.cleanupOldRequests();
    if (this.requestTimestamps.length < this.maxRequests) {
      return 0;
    }
    // Wait until the oldest request falls outside the window
    const oldest = this.requestTimestamps[0];
    if (oldest === undefined) return 0;
    const waitTime = oldest + this.windowMs - Date.now();
    return Math.max(0, waitTime);
  }

  /**
   * Wait until a request can be made.
   */
  async waitForCapacity(): Promise<void> {
    const waitTime = this.getWaitTimeMs();
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Remove timestamps outside the sliding window.
   */
  private cleanupOldRequests(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.requestTimestamps.length > 0 && (this.requestTimestamps[0] ?? 0) < cutoff) {
      this.requestTimestamps.shift();
    }
  }
}

// Global rate limiter instance
let rateLimiter: RateLimiter | null = null;

/**
 * Get the configured rate limiter.
 */
function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    const rpmEnv = process.env["ELEVENLABS_RATE_LIMIT_RPM"];
    const rpm = rpmEnv ? parseInt(rpmEnv, 10) : DEFAULT_RATE_LIMIT_RPM;
    rateLimiter = new RateLimiter(rpm);
  }
  return rateLimiter;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when ElevenLabs API returns an error.
 */
export class ElevenLabsError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    message: string
  ) {
    super(`ElevenLabs API error (${statusCode} ${statusText}): ${message}`);
    this.name = "ElevenLabsError";
  }

  /**
   * Check if this error is a rate limit error.
   */
  isRateLimitError(): boolean {
    return this.statusCode === 429;
  }

  /**
   * Check if this error is transient and worth retrying.
   */
  isTransientError(): boolean {
    return TRANSIENT_ERROR_CODES.includes(this.statusCode);
  }
}

/**
 * Error thrown when rate limit is exceeded after retries.
 */
export class RateLimitExceededError extends Error {
  constructor(message: string = "ElevenLabs rate limit exceeded after retries") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

// ============================================================================
// Types
// ============================================================================

export interface SynthesizeSpeechOptions {
  /** Text to synthesize (required) */
  text: string;
  /** ElevenLabs voice ID (required) */
  voiceId: string;
  /** Model to use for synthesis */
  model?: ElevenLabsModel;
  /** Output format */
  outputFormat?: AudioOutputFormat;
  /** Voice stability (0-1) */
  stability?: number;
  /** Similarity boost (0-1) */
  similarityBoost?: number;
  /** Speech rate/speed (0.7-1.2, ElevenLabs API constraint) */
  speed?: number;
}

export interface SynthesizeSpeechResult {
  /** Audio buffer containing the synthesized speech */
  audioBuffer: Buffer;
  /** Content type of the audio */
  contentType: string;
}

export interface TranscribeSpeechOptions {
  /** Audio buffer to transcribe */
  audio: Buffer;
  /** MIME type of the audio */
  mimeType: string;
  /** Language code (optional, for better accuracy) */
  language?: string;
}

export interface TranscribeSpeechResult {
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface VoiceInfo {
  voiceId: string;
  name: string;
  category: string;
  labels?: Record<string, string> | undefined;
}

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * Handle API response errors.
 */
async function handleApiError(response: Response): Promise<never> {
  let message = response.statusText;

  try {
    const errorBody = (await response.json()) as {
      detail?: { message?: string } | string;
    };
    if (typeof errorBody.detail === "object" && errorBody.detail?.message) {
      message = errorBody.detail.message;
    } else if (typeof errorBody.detail === "string") {
      message = errorBody.detail;
    }
  } catch {
    // Use status text if JSON parsing fails
  }

  throw new ElevenLabsError(response.status, response.statusText, message);
}

/**
 * Calculate exponential backoff delay with jitter.
 * @param attempt - Current attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
function calculateBackoffDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, ...
  const baseDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
  // Add jitter (up to 25% of base delay)
  const jitter = Math.random() * baseDelay * 0.25;
  // Cap at max delay
  return Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
}

/**
 * Execute an API request with rate limiting and retry logic.
 * T057: Rate limit handling and retry logic
 * @param requestFn - Function that performs the actual request
 * @param maxRetries - Maximum number of retry attempts
 */
async function executeWithRetry<T>(
  requestFn: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<T> {
  const limiter = getRateLimiter();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait for rate limit capacity
    await limiter.waitForCapacity();

    try {
      // Record the request before making it
      limiter.recordRequest();
      return await requestFn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if error is retryable
      if (err instanceof ElevenLabsError && err.isTransientError()) {
        // If this was a rate limit error, wait longer
        const delay = err.isRateLimitError()
          ? Math.max(calculateBackoffDelay(attempt), 5000) // At least 5s for rate limits
          : calculateBackoffDelay(attempt);

        if (attempt < maxRetries) {
          console.warn(
            `[ElevenLabs] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `retrying in ${Math.round(delay / 1000)}s: ${err.message}`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Non-retryable error or max retries exceeded
      throw err;
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error("Request failed after retries");
}

/**
 * Synthesize text to speech using ElevenLabs TTS API.
 * T007: Core TTS implementation
 * T057: With rate limiting and retry logic
 */
export async function synthesizeSpeech(
  options: SynthesizeSpeechOptions
): Promise<SynthesizeSpeechResult> {
  const {
    text,
    voiceId,
    model = DEFAULT_ELEVENLABS_MODEL,
    outputFormat = DEFAULT_OUTPUT_FORMAT,
    stability = 0.5,
    similarityBoost = 0.75,
    speed,
  } = options;

  // Validate text (outside of retry loop - validation errors shouldn't be retried)
  if (!text || text.trim().length === 0) {
    throw new Error("Text is required for speech synthesis");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
    );
  }

  const apiKey = getElevenLabsApiKey();
  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}?output_format=${outputFormat}`;

  const voiceSettings: { stability: number; similarity_boost: number; speed?: number } = {
    stability,
    similarity_boost: similarityBoost,
  };

  if (speed !== undefined) {
    voiceSettings.speed = speed;
  }

  const body = {
    text,
    model_id: model,
    voice_settings: voiceSettings,
  };

  // Execute with rate limiting and retry logic (T057)
  return executeWithRetry(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "audio/mpeg";

    return {
      audioBuffer: Buffer.from(arrayBuffer),
      contentType,
    };
  });
}

/**
 * Transcribe audio to text using ElevenLabs STT API.
 * T008: STT implementation
 * T057: With rate limiting and retry logic
 */
export async function transcribeSpeech(
  options: TranscribeSpeechOptions
): Promise<TranscribeSpeechResult> {
  const { audio, mimeType, language } = options;

  const apiKey = getElevenLabsApiKey();
  const url = `${ELEVENLABS_API_BASE}/speech-to-text`;

  // Create form data with audio file (need to recreate for each retry)
  const createFormData = (): FormData => {
    const formData = new FormData();
    const arrayBuffer = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: mimeType });
    formData.append("file", blob, "audio.webm");

    // model_id is required by ElevenLabs STT API
    formData.append("model_id", "scribe_v1");

    if (language) {
      formData.append("language_code", language);
    }
    return formData;
  };

  // Execute with rate limiting and retry logic (T057)
  return executeWithRetry(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: createFormData(),
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    const result = (await response.json()) as { text?: string; confidence?: number };

    return {
      text: result.text || "",
      confidence: result.confidence ?? 1.0,
    };
  });
}

/**
 * List all available voices.
 * T057: With rate limiting and retry logic
 */
export async function listVoices(): Promise<VoiceInfo[]> {
  const apiKey = getElevenLabsApiKey();
  const url = `${ELEVENLABS_API_BASE}/voices`;

  return executeWithRetry(async () => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    const result = (await response.json()) as {
      voices?: Array<{ voice_id: string; name: string; category: string; labels?: Record<string, string> }>;
    };

    return (result.voices || []).map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      labels: voice.labels,
    }));
  });
}

/**
 * Get details for a specific voice.
 * T057: With rate limiting and retry logic
 */
export async function getVoice(voiceId: string): Promise<VoiceInfo> {
  const apiKey = getElevenLabsApiKey();
  const url = `${ELEVENLABS_API_BASE}/voices/${voiceId}`;

  return executeWithRetry(async () => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    const voice = (await response.json()) as {
      voice_id: string;
      name: string;
      category: string;
      labels?: Record<string, string>;
    };

    return {
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category,
      labels: voice.labels,
    };
  });
}

/**
 * Check if voice features are available (API key is configured).
 */
export function isVoiceAvailable(): boolean {
  try {
    getElevenLabsApiKey();
    return true;
  } catch {
    return false;
  }
}
