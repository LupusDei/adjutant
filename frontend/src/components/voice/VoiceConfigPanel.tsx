/**
 * VoiceConfigPanel Component - T050 [US4]
 * Admin panel for managing agent voice configurations
 */
import React, { useState, useEffect, useCallback } from 'react';
import { VoicePreview } from './VoicePreview';
import './voice.css';

export interface VoiceConfigPanelProps {
  /** Optional class name */
  className?: string;
}

interface AgentVoiceConfig {
  agentId: string;
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

interface DefaultVoiceConfig {
  voiceId: string;
  voiceName?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

const AVAILABLE_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
  { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde' },
  { id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave' },
];

/**
 * Voice configuration panel for admin settings.
 */
export const VoiceConfigPanel: React.FC<VoiceConfigPanelProps> = ({
  className = '',
}) => {
  const [defaultConfig, setDefaultConfig] = useState<DefaultVoiceConfig | null>(null);
  const [agentConfigs, setAgentConfigs] = useState<AgentVoiceConfig[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAgentId, setNewAgentId] = useState('');

  // Form state for editing
  const [editForm, setEditForm] = useState<{
    voiceId: string;
    speed: number;
    stability: number;
    similarityBoost: number;
  }>({
    voiceId: '',
    speed: 1.0,
    stability: 0.5,
    similarityBoost: 0.75,
  });

  // Fetch configs on mount
  useEffect(() => {
    async function fetchConfigs() {
      try {
        const [defaultRes, agentsRes] = await Promise.all([
          fetch('/api/voice/defaults'),
          fetch('/api/voice/agents'),
        ]);

        const defaultJson = await defaultRes.json() as { success: boolean; data?: DefaultVoiceConfig };
        const agentsJson = await agentsRes.json() as { success: boolean; data?: AgentVoiceConfig[] };

        if (defaultJson.success && defaultJson.data) {
          setDefaultConfig(defaultJson.data);
          setEditForm({
            voiceId: defaultJson.data.voiceId,
            speed: defaultJson.data.speed ?? 1.0,
            stability: defaultJson.data.stability ?? 0.5,
            similarityBoost: defaultJson.data.similarityBoost ?? 0.75,
          });
        }

        if (agentsJson.success && agentsJson.data) {
          setAgentConfigs(agentsJson.data);
        }
      } catch {
        setError('Failed to load voice configurations');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchConfigs();
  }, []);

  // Select an agent to edit
  const handleSelectAgent = useCallback((agentId: string | null) => {
    setSelectedAgent(agentId);

    if (agentId === null && defaultConfig) {
      // Editing defaults
      setEditForm({
        voiceId: defaultConfig.voiceId,
        speed: defaultConfig.speed ?? 1.0,
        stability: defaultConfig.stability ?? 0.5,
        similarityBoost: defaultConfig.similarityBoost ?? 0.75,
      });
    } else if (agentId) {
      const config = agentConfigs.find((c) => c.agentId === agentId);
      if (config) {
        setEditForm({
          voiceId: config.voiceId,
          speed: config.speed ?? 1.0,
          stability: config.stability ?? 0.5,
          similarityBoost: config.similarityBoost ?? 0.75,
        });
      }
    }
  }, [defaultConfig, agentConfigs]);

  // Save current edit
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      const endpoint = selectedAgent
        ? `/api/voice/config/${encodeURIComponent(selectedAgent)}`
        : '/api/voice/defaults';

      const body = selectedAgent
        ? { ...editForm, agentId: selectedAgent }
        : editForm;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await response.json() as { success: boolean; data?: AgentVoiceConfig | DefaultVoiceConfig };

      if (json.success && json.data) {
        if (selectedAgent) {
          setAgentConfigs((prev) => {
            const existing = prev.findIndex((c) => c.agentId === selectedAgent);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = json.data as AgentVoiceConfig;
              return updated;
            }
            return [...prev, json.data as AgentVoiceConfig];
          });
        } else {
          setDefaultConfig(json.data as DefaultVoiceConfig);
        }
      }
    } catch {
      setError('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  }, [selectedAgent, editForm]);

  // Add new agent
  const handleAddAgent = useCallback(() => {
    if (!newAgentId.trim()) return;

    const agentId = newAgentId.trim();
    setNewAgentId('');

    // Initialize with defaults
    if (defaultConfig) {
      setEditForm({
        voiceId: defaultConfig.voiceId,
        speed: defaultConfig.speed ?? 1.0,
        stability: defaultConfig.stability ?? 0.5,
        similarityBoost: defaultConfig.similarityBoost ?? 0.75,
      });
    }

    setSelectedAgent(agentId);
  }, [newAgentId, defaultConfig]);

  // Delete agent config
  const handleDeleteAgent = useCallback(async (agentId: string) => {
    try {
      await fetch(`/api/voice/config/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      });
      setAgentConfigs((prev) => prev.filter((c) => c.agentId !== agentId));
      if (selectedAgent === agentId) {
        setSelectedAgent(null);
        handleSelectAgent(null);
      }
    } catch {
      setError('Failed to delete configuration');
    }
  }, [selectedAgent, handleSelectAgent]);

  if (isLoading) {
    return (
      <div className={`voice-config-panel voice-config-loading ${className}`}>
        <span className="voice-loading">◌</span> Loading configurations...
      </div>
    );
  }

  return (
    <div className={`voice-config-panel ${className}`}>
      <header className="voice-config-header">
        <h2 className="voice-config-title">🎤 VOICE CONFIGURATION</h2>
      </header>

      {error && (
        <div className="voice-error" role="alert">
          {error}
        </div>
      )}

      <div className="voice-config-content">
        {/* Agent List */}
        <div className="voice-config-sidebar">
          <div className="voice-config-section">
            <h3 className="voice-config-section-title">DEFAULT VOICE</h3>
            <button
              type="button"
              className={`voice-config-agent-btn ${selectedAgent === null ? 'voice-config-agent-selected' : ''}`}
              onClick={() => handleSelectAgent(null)}
            >
              System Default
            </button>
          </div>

          <div className="voice-config-section">
            <h3 className="voice-config-section-title">AGENT VOICES</h3>
            {agentConfigs.map((config) => (
              <div key={config.agentId} className="voice-config-agent-row">
                <button
                  type="button"
                  className={`voice-config-agent-btn ${selectedAgent === config.agentId ? 'voice-config-agent-selected' : ''}`}
                  onClick={() => handleSelectAgent(config.agentId)}
                >
                  {config.agentId}
                </button>
                <button
                  type="button"
                  className="voice-config-delete-btn"
                  onClick={() => void handleDeleteAgent(config.agentId)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}

            <div className="voice-config-add-agent">
              <input
                type="text"
                className="voice-config-input"
                placeholder="Agent ID..."
                value={newAgentId}
                onChange={(e) => setNewAgentId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()}
              />
              <button
                type="button"
                className="voice-config-add-btn"
                onClick={handleAddAgent}
                disabled={!newAgentId.trim()}
              >
                + ADD
              </button>
            </div>
          </div>
        </div>

        {/* Edit Form */}
        <div className="voice-config-editor">
          <h3 className="voice-config-section-title">
            {selectedAgent ? `EDITING: ${selectedAgent}` : 'EDITING: DEFAULT VOICE'}
          </h3>

          <div className="voice-config-field">
            <label className="voice-config-label">VOICE:</label>
            <select
              className="voice-config-select"
              value={editForm.voiceId}
              onChange={(e) => setEditForm((prev) => ({ ...prev, voiceId: e.target.value }))}
            >
              {AVAILABLE_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>

          <div className="voice-config-field">
            <label className="voice-config-label">
              SPEED: {editForm.speed.toFixed(2)}
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={editForm.speed}
              onChange={(e) => setEditForm((prev) => ({ ...prev, speed: parseFloat(e.target.value) }))}
              className="voice-config-slider"
            />
          </div>

          <div className="voice-config-field">
            <label className="voice-config-label">
              STABILITY: {editForm.stability.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={editForm.stability}
              onChange={(e) => setEditForm((prev) => ({ ...prev, stability: parseFloat(e.target.value) }))}
              className="voice-config-slider"
            />
          </div>

          <div className="voice-config-field">
            <label className="voice-config-label">
              SIMILARITY: {editForm.similarityBoost.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={editForm.similarityBoost}
              onChange={(e) => setEditForm((prev) => ({ ...prev, similarityBoost: parseFloat(e.target.value) }))}
              className="voice-config-slider"
            />
          </div>

          <VoicePreview
            voiceId={editForm.voiceId}
            speed={editForm.speed}
            stability={editForm.stability}
            similarityBoost={editForm.similarityBoost}
          />

          <button
            type="button"
            className="voice-config-save-btn"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? '◌ SAVING...' : '💾 SAVE CONFIGURATION'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceConfigPanel;
