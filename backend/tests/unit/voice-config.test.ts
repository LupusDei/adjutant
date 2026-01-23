/**
 * Unit tests for voice-config service
 * T046 [US4] - Tests for voice configuration CRUD operations
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  type VoiceConfigService,
  createVoiceConfigService,
  type AgentVoiceConfig,
} from '../../src/services/voice-config-service.js';

// Use a temp directory for config persistence tests
const testConfigDir = join(tmpdir(), 'gastown-voice-config-test');
const testConfigPath = join(testConfigDir, 'voice-config.json');

describe('VoiceConfigService', () => {
  let service: VoiceConfigService;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true });
    }
    mkdirSync(testConfigDir, { recursive: true });

    service = createVoiceConfigService(testConfigPath);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true });
    }
  });

  describe('getAgentConfig', () => {
    it('should return default config for unknown agent', async () => {
      const config = await service.getAgentConfig('unknown-agent');

      expect(config).toBeDefined();
      expect(config.voiceId).toBeDefined();
      expect(config.agentId).toBe('unknown-agent');
    });

    it('should return stored config for known agent', async () => {
      const customConfig: AgentVoiceConfig = {
        agentId: 'test-agent',
        voiceId: 'custom-voice-123',
        voiceName: 'Custom Voice',
        speed: 1.1,
        stability: 0.6,
        similarityBoost: 0.8,
      };

      await service.setAgentConfig('test-agent', customConfig);
      const retrieved = await service.getAgentConfig('test-agent');

      expect(retrieved.voiceId).toBe('custom-voice-123');
      expect(retrieved.voiceName).toBe('Custom Voice');
      expect(retrieved.speed).toBe(1.1);
    });

    it('should inherit defaults for missing optional fields', async () => {
      const partialConfig = {
        agentId: 'partial-agent',
        voiceId: 'voice-456',
      };

      await service.setAgentConfig('partial-agent', partialConfig as AgentVoiceConfig);
      const retrieved = await service.getAgentConfig('partial-agent');

      expect(retrieved.voiceId).toBe('voice-456');
      expect(retrieved.speed).toBeDefined();
      expect(retrieved.stability).toBeDefined();
    });
  });

  describe('setAgentConfig', () => {
    it('should save agent config', async () => {
      const config: AgentVoiceConfig = {
        agentId: 'new-agent',
        voiceId: 'voice-789',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      };

      await service.setAgentConfig('new-agent', config);
      const saved = await service.getAgentConfig('new-agent');

      expect(saved.voiceId).toBe('voice-789');
    });

    it('should update existing agent config', async () => {
      await service.setAgentConfig('existing-agent', {
        agentId: 'existing-agent',
        voiceId: 'old-voice',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      await service.setAgentConfig('existing-agent', {
        agentId: 'existing-agent',
        voiceId: 'new-voice',
        speed: 1.2,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      const updated = await service.getAgentConfig('existing-agent');

      expect(updated.voiceId).toBe('new-voice');
      expect(updated.speed).toBe(1.2);
    });

    it('should persist config to file', async () => {
      await service.setAgentConfig('persist-agent', {
        agentId: 'persist-agent',
        voiceId: 'persist-voice',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      // Create new service instance to verify persistence
      const newService = createVoiceConfigService(testConfigPath);
      const loaded = await newService.getAgentConfig('persist-agent');

      expect(loaded.voiceId).toBe('persist-voice');
    });

    it('should validate voice ID is not empty', async () => {
      await expect(
        service.setAgentConfig('bad-agent', {
          agentId: 'bad-agent',
          voiceId: '',
          speed: 1.0,
          stability: 0.5,
          similarityBoost: 0.75,
        })
      ).rejects.toThrow('Voice ID is required');
    });
  });

  describe('deleteAgentConfig', () => {
    it('should remove agent config', async () => {
      await service.setAgentConfig('delete-me', {
        agentId: 'delete-me',
        voiceId: 'temp-voice',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      await service.deleteAgentConfig('delete-me');
      const config = await service.getAgentConfig('delete-me');

      // Should return default, not the deleted custom config
      expect(config.voiceId).not.toBe('temp-voice');
    });

    it('should not throw when deleting non-existent agent', async () => {
      await expect(service.deleteAgentConfig('non-existent')).resolves.not.toThrow();
    });
  });

  describe('listAgentConfigs', () => {
    it('should return empty array when no custom configs', async () => {
      const configs = await service.listAgentConfigs();
      expect(configs).toEqual([]);
    });

    it('should list all custom agent configs', async () => {
      await service.setAgentConfig('agent-1', {
        agentId: 'agent-1',
        voiceId: 'voice-1',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });
      await service.setAgentConfig('agent-2', {
        agentId: 'agent-2',
        voiceId: 'voice-2',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      const configs = await service.listAgentConfigs();

      expect(configs).toHaveLength(2);
      expect(configs.map((c) => c.agentId)).toContain('agent-1');
      expect(configs.map((c) => c.agentId)).toContain('agent-2');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return the default voice configuration', async () => {
      const defaultConfig = await service.getDefaultConfig();

      expect(defaultConfig).toBeDefined();
      expect(defaultConfig.voiceId).toBeDefined();
    });
  });

  describe('setDefaultConfig', () => {
    it('should update the default voice configuration', async () => {
      await service.setDefaultConfig({
        voiceId: 'new-default-voice',
        speed: 0.9,
        stability: 0.7,
        similarityBoost: 0.8,
      });

      const defaultConfig = await service.getDefaultConfig();

      expect(defaultConfig.voiceId).toBe('new-default-voice');
      expect(defaultConfig.speed).toBe(0.9);
    });
  });

  describe('persistence', () => {
    it('should create config file if it does not exist', async () => {
      // File shouldn't exist yet
      expect(existsSync(testConfigPath)).toBe(false);

      await service.setAgentConfig('trigger-save', {
        agentId: 'trigger-save',
        voiceId: 'trigger-voice',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      expect(existsSync(testConfigPath)).toBe(true);
    });

    it('should handle corrupted config file gracefully', async () => {
      // Write invalid JSON
      writeFileSync(testConfigPath, 'not valid json {{{');

      const newService = createVoiceConfigService(testConfigPath);
      const config = await newService.getAgentConfig('any-agent');

      // Should fall back to defaults
      expect(config).toBeDefined();
      expect(config.voiceId).toBeDefined();
    });

    it('should preserve unmodified configs when saving', async () => {
      await service.setAgentConfig('agent-a', {
        agentId: 'agent-a',
        voiceId: 'voice-a',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });
      await service.setAgentConfig('agent-b', {
        agentId: 'agent-b',
        voiceId: 'voice-b',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      // Modify only agent-a
      await service.setAgentConfig('agent-a', {
        agentId: 'agent-a',
        voiceId: 'voice-a-updated',
        speed: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
      });

      // agent-b should still exist
      const configB = await service.getAgentConfig('agent-b');
      expect(configB.voiceId).toBe('voice-b');
    });
  });
});
