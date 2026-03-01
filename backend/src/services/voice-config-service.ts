/**
 * Voice Config Service - T047, T049 [US4]
 * CRUD operations for agent voice configurations with JSON file persistence
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import {
  DEFAULT_VOICE_CONFIGURATION,
} from '../config/voice-config.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentVoiceConfig {
  agentId: string;
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

export interface DefaultVoiceConfig {
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

interface PersistedConfig {
  version: number;
  defaultConfig: DefaultVoiceConfig;
  agentConfigs: Record<string, AgentVoiceConfig>;
  updatedAt: string;
}

export interface VoiceConfigService {
  getAgentConfig(agentId: string): Promise<AgentVoiceConfig>;
  setAgentConfig(agentId: string, config: AgentVoiceConfig): Promise<void>;
  deleteAgentConfig(agentId: string): Promise<void>;
  listAgentConfigs(): Promise<AgentVoiceConfig[]>;
  getDefaultConfig(): Promise<DefaultVoiceConfig>;
  setDefaultConfig(config: DefaultVoiceConfig): Promise<void>;
}

// =============================================================================
// Default Config Path
// =============================================================================

const PRIMARY_PATH = join(homedir(), '.adjutant', 'voice-config.json');
export const VOICE_CONFIG_PATH = PRIMARY_PATH;

// =============================================================================
// Implementation
// =============================================================================

const CONFIG_VERSION = 1;

/**
 * Creates a voice config service with file persistence.
 */
export function createVoiceConfigService(configPath: string = VOICE_CONFIG_PATH): VoiceConfigService {
  let cachedConfig: PersistedConfig | null = null;

  /**
   * Get initial default config from voice-config.ts
   */
  function getInitialDefaults(): DefaultVoiceConfig {
    const defaultVoice = DEFAULT_VOICE_CONFIGURATION.defaultVoice;
    return {
      voiceId: defaultVoice.voiceId,
      voiceName: defaultVoice.name,
      speed: defaultVoice.speed ?? 1.0,
      stability: defaultVoice.stability ?? 0.5,
      similarityBoost: defaultVoice.similarityBoost ?? 0.75,
    };
  }

  /**
   * Load config from file
   */
  function loadConfig(): PersistedConfig {
    if (cachedConfig) {
      return cachedConfig;
    }

    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content) as PersistedConfig;

        // Validate structure
        if (parsed.version === CONFIG_VERSION && parsed.agentConfigs) {
          cachedConfig = parsed;
          return cachedConfig;
        }
      } catch {
        // Invalid JSON or structure, return defaults
      }
    }

    // Return default config
    cachedConfig = {
      version: CONFIG_VERSION,
      defaultConfig: getInitialDefaults(),
      agentConfigs: {},
      updatedAt: new Date().toISOString(),
    };

    return cachedConfig;
  }

  /**
   * Save config to file
   */
  function saveConfig(config: PersistedConfig): void {
    // Ensure directory exists
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    config.updatedAt = new Date().toISOString();
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    cachedConfig = config;
  }

  /**
   * Get agent-specific voice config, falling back to defaults
   */
  async function getAgentConfig(agentId: string): Promise<AgentVoiceConfig> {
    const config = loadConfig();
    const agentConfig = config.agentConfigs[agentId];

    if (agentConfig) {
      return {
        ...agentConfig,
        speed: agentConfig.speed ?? config.defaultConfig.speed ?? 1.0,
        stability: agentConfig.stability ?? config.defaultConfig.stability ?? 0.5,
        similarityBoost: agentConfig.similarityBoost ?? config.defaultConfig.similarityBoost ?? 0.75,
      };
    }

    // Return default config with the requested agentId
    const result: AgentVoiceConfig = {
      agentId,
      voiceId: config.defaultConfig.voiceId,
      speed: config.defaultConfig.speed ?? 1.0,
      stability: config.defaultConfig.stability ?? 0.5,
      similarityBoost: config.defaultConfig.similarityBoost ?? 0.75,
    };
    if (config.defaultConfig.voiceName) {
      result.voiceName = config.defaultConfig.voiceName;
    }
    return result;
  }

  /**
   * Set agent-specific voice config
   */
  async function setAgentConfig(agentId: string, agentConfig: AgentVoiceConfig): Promise<void> {
    if (!agentConfig.voiceId || agentConfig.voiceId.trim() === '') {
      throw new Error('Voice ID is required');
    }

    const config = loadConfig();
    config.agentConfigs[agentId] = {
      ...agentConfig,
      agentId, // Ensure agentId matches
    };
    saveConfig(config);
  }

  /**
   * Delete agent-specific voice config
   */
  async function deleteAgentConfig(agentId: string): Promise<void> {
    const config = loadConfig();
    delete config.agentConfigs[agentId];
    saveConfig(config);
  }

  /**
   * List all custom agent configs
   */
  async function listAgentConfigs(): Promise<AgentVoiceConfig[]> {
    const config = loadConfig();
    return Object.values(config.agentConfigs);
  }

  /**
   * Get default voice config
   */
  async function getDefaultConfig(): Promise<DefaultVoiceConfig> {
    const config = loadConfig();
    return config.defaultConfig;
  }

  /**
   * Set default voice config
   */
  async function setDefaultConfig(defaultConfig: DefaultVoiceConfig): Promise<void> {
    if (!defaultConfig.voiceId || defaultConfig.voiceId.trim() === '') {
      throw new Error('Voice ID is required');
    }

    const config = loadConfig();
    config.defaultConfig = {
      ...config.defaultConfig,
      ...defaultConfig,
    };
    saveConfig(config);
  }

  return {
    getAgentConfig,
    setAgentConfig,
    deleteAgentConfig,
    listAgentConfigs,
    getDefaultConfig,
    setDefaultConfig,
  };
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultService: VoiceConfigService | null = null;

/**
 * Get the default voice config service instance (singleton)
 */
export function getVoiceConfigService(): VoiceConfigService {
  if (!defaultService) {
    defaultService = createVoiceConfigService();
  }
  return defaultService;
}

/**
 * Reset the default service (mainly for testing)
 */
export function resetVoiceConfigService(): void {
  defaultService = null;
}

export default {
  createVoiceConfigService,
  getVoiceConfigService,
  resetVoiceConfigService,
};
