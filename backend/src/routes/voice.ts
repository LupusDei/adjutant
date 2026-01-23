// ============================================================================
// Voice Routes - T016, T017, T018
// API endpoints for voice synthesis, audio serving, and configuration
// ============================================================================

import express, { Router, Request, Response } from "express";
import { existsSync, createReadStream, statSync } from "fs";
import {
  synthesizeMessage,
  synthesizeNotification,
  getVoiceConfig,
  isVoiceServiceAvailable,
  getAudioFilePath,
  transcribeAudio,
} from "../services/voice-service.js";
import { SynthesizeRequestSchema } from "../types/voice-schemas.js";
import { success, error as apiError } from "../utils/responses.js";

export const voiceRouter = Router();

// ============================================================================
// T016: POST /api/voice/synthesize - Synthesize text to speech
// ============================================================================

voiceRouter.post("/synthesize", async (req: Request, res: Response) => {
  try {
    // Check if voice service is available
    if (!isVoiceServiceAvailable()) {
      return res
        .status(503)
        .json(
          apiError(
            "VOICE_NOT_AVAILABLE",
            "Voice service is not configured. Set ELEVENLABS_API_KEY environment variable."
          )
        );
    }

    // Validate request
    const parseResult = SynthesizeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json(
          apiError(
            "VALIDATION_ERROR",
            parseResult.error.issues[0]?.message || "Invalid request"
          )
        );
    }

    const { text, voiceId, agentId, messageId } = parseResult.data;

    // Synthesize - filter out undefined values
    const result = await synthesizeMessage({
      text,
      ...(voiceId && { voiceId }),
      ...(agentId && { agentId }),
      ...(messageId && { messageId }),
    });

    return res.json(success(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Synthesis failed";
    return res.status(500).json(apiError("SYNTHESIS_ERROR", message));
  }
});

// ============================================================================
// T016: GET /api/voice/audio/:filename - Serve cached audio file
// ============================================================================

voiceRouter.get("/audio/:filename", async (req: Request, res: Response) => {
  try {
    const filenameParam = req.params["filename"];
    const filename = typeof filenameParam === "string" ? filenameParam : filenameParam?.[0];

    // Validate filename (prevent path traversal)
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return res.status(400).json(apiError("INVALID_FILENAME", "Invalid filename"));
    }

    // Get the file path
    const filePath = getAudioFilePath(filename);

    if (!existsSync(filePath)) {
      return res.status(404).json(apiError("NOT_FOUND", "Audio file not found"));
    }

    // Get file stats for Content-Length
    const stats = statSync(filePath);

    // Set headers for audio streaming
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day

    // Handle range requests for seeking
    const rangeHeader = req.headers.range;
    const range = typeof rangeHeader === "string" ? rangeHeader : undefined;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const startPart = parts[0];
      const endPart = parts[1];
      const start = startPart ? parseInt(startPart, 10) : 0;
      const end = endPart ? parseInt(endPart, 10) : stats.size - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      res.setHeader("Content-Length", chunkSize);

      const stream = createReadStream(filePath, { start, end });
      stream.pipe(res);
      return;
    }

    // Stream the entire file
    const stream = createReadStream(filePath);
    stream.pipe(res);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to serve audio";
    return res.status(500).json(apiError("AUDIO_ERROR", message));
  }
});

// ============================================================================
// T018: GET /api/voice/config - Get voice configuration
// ============================================================================

voiceRouter.get("/config", async (_req: Request, res: Response) => {
  try {
    const config = await getVoiceConfig();

    return res.json(
      success({
        enabled: isVoiceServiceAvailable(),
        config,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

// ============================================================================
// T029: POST /api/voice/transcribe - Transcribe audio to text (US2)
// ============================================================================

// Raw body parser middleware for audio data
const rawBodyParser = express.raw({
  type: ['audio/*', 'application/octet-stream'],
  limit: '10mb',
});

voiceRouter.post("/transcribe", rawBodyParser, async (req: Request, res: Response) => {
  try {
    // Check if voice service is available
    if (!isVoiceServiceAvailable()) {
      return res
        .status(503)
        .json(
          apiError(
            "VOICE_NOT_AVAILABLE",
            "Voice service is not configured"
          )
        );
    }

    // Check for raw audio buffer in request body
    if (!req.body || req.body.length === 0) {
      return res
        .status(400)
        .json(apiError("INVALID_AUDIO", "Audio data is required"));
    }

    // Convert to Buffer if needed (body could be Buffer or Uint8Array)
    const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);

    const contentType = req.headers["content-type"];
    const mimeType = typeof contentType === "string" ? contentType : "audio/webm";

    const result = await transcribeAudio({
      audio: audioBuffer,
      mimeType,
    });

    return res.json(success(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return res.status(500).json(apiError("TRANSCRIPTION_ERROR", message));
  }
});

// ============================================================================
// GET /api/voice/status - Check voice service status
// ============================================================================

voiceRouter.get("/status", async (_req: Request, res: Response) => {
  return res.json(
    success({
      available: isVoiceServiceAvailable(),
    })
  );
});

// ============================================================================
// T040 [US3]: Notification Settings Endpoints
// ============================================================================

// In-memory notification settings (could be persisted to file/db later)
interface NotificationSettings {
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
}

let notificationSettings: NotificationSettings = {
  enabled: true,
  volume: 0.8,
  priorities: {
    urgent: true,
    high: true,
    normal: true,
    low: false,
  },
  sources: {
    mail: true,
    system: true,
    agent: true,
  },
};

/**
 * GET /api/voice/settings - Get notification settings
 */
voiceRouter.get("/settings", async (_req: Request, res: Response) => {
  return res.json(success(notificationSettings));
});

/**
 * PUT /api/voice/settings - Update notification settings
 */
voiceRouter.put("/settings", async (req: Request, res: Response) => {
  try {
    const updates = req.body as Partial<NotificationSettings>;

    // Validate and merge settings
    if (updates.enabled !== undefined) {
      notificationSettings.enabled = Boolean(updates.enabled);
    }

    if (updates.volume !== undefined) {
      const volume = Number(updates.volume);
      if (!isNaN(volume)) {
        notificationSettings.volume = Math.max(0, Math.min(1, volume));
      }
    }

    if (updates.priorities !== undefined && typeof updates.priorities === 'object') {
      const priorities = updates.priorities as Partial<NotificationSettings['priorities']>;
      if (priorities.urgent !== undefined) notificationSettings.priorities.urgent = Boolean(priorities.urgent);
      if (priorities.high !== undefined) notificationSettings.priorities.high = Boolean(priorities.high);
      if (priorities.normal !== undefined) notificationSettings.priorities.normal = Boolean(priorities.normal);
      if (priorities.low !== undefined) notificationSettings.priorities.low = Boolean(priorities.low);
    }

    if (updates.sources !== undefined && typeof updates.sources === 'object') {
      const sources = updates.sources as Partial<NotificationSettings['sources']>;
      if (sources.mail !== undefined) notificationSettings.sources.mail = Boolean(sources.mail);
      if (sources.system !== undefined) notificationSettings.sources.system = Boolean(sources.system);
      if (sources.agent !== undefined) notificationSettings.sources.agent = Boolean(sources.agent);
    }

    return res.json(success(notificationSettings));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update settings";
    return res.status(500).json(apiError("SETTINGS_ERROR", message));
  }
});

// ============================================================================
// T039 [US3]: POST /api/voice/notification - Synthesize notification
// ============================================================================

voiceRouter.post("/notification", async (req: Request, res: Response) => {
  try {
    // Check if voice service is available
    if (!isVoiceServiceAvailable()) {
      return res
        .status(503)
        .json(
          apiError(
            "VOICE_NOT_AVAILABLE",
            "Voice service is not configured"
          )
        );
    }

    // Check if notifications are enabled
    if (!notificationSettings.enabled) {
      return res
        .status(200)
        .json(
          success({
            skipped: true,
            reason: "Notifications are disabled",
          })
        );
    }

    const { text, priority = 'normal', source = 'system' } = req.body as {
      text?: string;
      priority?: 'urgent' | 'high' | 'normal' | 'low';
      source?: 'mail' | 'system' | 'agent';
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", "Notification text is required"));
    }

    // Check priority settings
    if (!notificationSettings.priorities[priority]) {
      return res
        .status(200)
        .json(
          success({
            skipped: true,
            reason: `${priority} priority notifications are disabled`,
          })
        );
    }

    // Check source settings
    if (!notificationSettings.sources[source]) {
      return res
        .status(200)
        .json(
          success({
            skipped: true,
            reason: `${source} notifications are disabled`,
          })
        );
    }

    const result = await synthesizeNotification({
      text,
      priority,
      source,
    });

    return res.json(success(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Notification synthesis failed";
    return res.status(500).json(apiError("NOTIFICATION_ERROR", message));
  }
});

// ============================================================================
// T048 [US4]: Agent Voice Configuration Routes
// ============================================================================

import { getVoiceConfigService } from "../services/voice-config-service.js";

/**
 * GET /api/voice/config/:agentId - Get agent's voice configuration
 */
voiceRouter.get("/config/:agentId", async (req: Request, res: Response) => {
  try {
    const agentIdParam = req.params["agentId"];
    const agentId = typeof agentIdParam === "string" ? agentIdParam : agentIdParam?.[0];

    if (!agentId) {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Agent ID is required"));
    }

    const configService = getVoiceConfigService();
    const config = await configService.getAgentConfig(agentId);

    return res.json(success(config));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get agent config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

/**
 * PUT /api/voice/config/:agentId - Set agent's voice configuration
 */
voiceRouter.put("/config/:agentId", async (req: Request, res: Response) => {
  try {
    const agentIdParam = req.params["agentId"];
    const agentId = typeof agentIdParam === "string" ? agentIdParam : agentIdParam?.[0];

    if (!agentId) {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Agent ID is required"));
    }

    const { voiceId, voiceName, speed, stability, similarityBoost } = req.body as {
      voiceId?: string;
      voiceName?: string;
      speed?: number;
      stability?: number;
      similarityBoost?: number;
    };

    if (!voiceId || typeof voiceId !== 'string' || voiceId.trim() === '') {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Voice ID is required"));
    }

    const configService = getVoiceConfigService();
    const agentConfig: Parameters<typeof configService.setAgentConfig>[1] = {
      agentId,
      voiceId,
    };
    if (voiceName !== undefined) agentConfig.voiceName = voiceName;
    if (speed !== undefined) agentConfig.speed = speed;
    if (stability !== undefined) agentConfig.stability = stability;
    if (similarityBoost !== undefined) agentConfig.similarityBoost = similarityBoost;
    await configService.setAgentConfig(agentId, agentConfig);

    const updatedConfig = await configService.getAgentConfig(agentId);
    return res.json(success(updatedConfig));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set agent config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

/**
 * DELETE /api/voice/config/:agentId - Delete agent's custom voice configuration
 */
voiceRouter.delete("/config/:agentId", async (req: Request, res: Response) => {
  try {
    const agentIdParam = req.params["agentId"];
    const agentId = typeof agentIdParam === "string" ? agentIdParam : agentIdParam?.[0];

    if (!agentId) {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Agent ID is required"));
    }

    const configService = getVoiceConfigService();
    await configService.deleteAgentConfig(agentId);

    return res.json(success({ deleted: true, agentId }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete agent config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

/**
 * GET /api/voice/agents - List all agents with custom voice configurations
 */
voiceRouter.get("/agents", async (_req: Request, res: Response) => {
  try {
    const configService = getVoiceConfigService();
    const configs = await configService.listAgentConfigs();

    return res.json(success(configs));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list agent configs";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

/**
 * GET /api/voice/defaults - Get default voice configuration
 */
voiceRouter.get("/defaults", async (_req: Request, res: Response) => {
  try {
    const configService = getVoiceConfigService();
    const defaultConfig = await configService.getDefaultConfig();

    return res.json(success(defaultConfig));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get default config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});

/**
 * PUT /api/voice/defaults - Set default voice configuration
 */
voiceRouter.put("/defaults", async (req: Request, res: Response) => {
  try {
    const { voiceId, voiceName, speed, stability, similarityBoost } = req.body as {
      voiceId?: string;
      voiceName?: string;
      speed?: number;
      stability?: number;
      similarityBoost?: number;
    };

    if (!voiceId || typeof voiceId !== 'string' || voiceId.trim() === '') {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Voice ID is required"));
    }

    const configService = getVoiceConfigService();
    const defaultConfig: Parameters<typeof configService.setDefaultConfig>[0] = {
      voiceId,
    };
    if (voiceName !== undefined) defaultConfig.voiceName = voiceName;
    if (speed !== undefined) defaultConfig.speed = speed;
    if (stability !== undefined) defaultConfig.stability = stability;
    if (similarityBoost !== undefined) defaultConfig.similarityBoost = similarityBoost;
    await configService.setDefaultConfig(defaultConfig);

    const updatedConfig = await configService.getDefaultConfig();
    return res.json(success(updatedConfig));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set default config";
    return res.status(500).json(apiError("CONFIG_ERROR", message));
  }
});
