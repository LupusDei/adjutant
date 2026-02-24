/**
 * API client service for backend communication.
 * Provides typed fetch wrapper with error handling.
 */
import type {
  ApiResponse,
  GastownStatus,
  Message,
  CrewMember,
  SendMessageRequest,
  PaginatedResponse,
  PowerState,
  BeadInfo,
  BeadDetail,
  ChatMessage,
  ChatThread,
  UnreadCount,
  Proposal,
} from '../types';
import type {
  SynthesizeRequest,
  SynthesizeResponse,
  TranscribeResponse,
  VoiceConfigResponse,
  VoiceStatus,
} from '../types/voice';

// =============================================================================
// Configuration
// =============================================================================

// Use relative URL by default - works with Vite proxy for local dev AND ngrok tunneling
// Set VITE_API_URL only when you need to hit a different backend (e.g., production)
const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';
const DEFAULT_TIMEOUT = 30000;
const API_KEY_STORAGE_KEY = 'adjutant-api-key';

// =============================================================================
// API Key Management
// =============================================================================

/**
 * Get the stored API key from session storage.
 */
export function getApiKey(): string | null {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Set the API key in session storage.
 */
export function setApiKey(key: string): void {
  sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
}

/**
 * Clear the API key from session storage.
 */
export function clearApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

/**
 * Check if an API key is configured.
 */
export function hasApiKey(): boolean {
  const key = getApiKey();
  return key !== null && key.length > 0;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Custom error class for API-related errors.
 * Includes error code, optional details, and HTTP status.
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// =============================================================================
// Core Fetch Wrapper
// =============================================================================

interface FetchOptions extends Omit<RequestInit, 'body'> {
  timeout?: number;
  body?: unknown;
}

async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, body, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  const url = `${API_BASE_URL}${endpoint}`;
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add API key authorization header if configured
  const apiKey = getApiKey();
  if (apiKey) {
    baseHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  // Merge additional headers if provided (assumes Record-style headers)
  const headers: HeadersInit = fetchOptions.headers
    ? { ...baseHeaders, ...(fetchOptions.headers as Record<string, string>) }
    : baseHeaders;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = (await response.json()) as ApiResponse<T>;

    if (!json.success) {
      throw new ApiError(
        json.error?.code ?? 'UNKNOWN_ERROR',
        json.error?.message ?? 'An unknown error occurred',
        json.error?.details,
        response.status
      );
    }

    return json.data as T;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof ApiError) {
      throw err;
    }

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new ApiError('TIMEOUT', `Request timed out after ${timeout}ms`);
      }
      throw new ApiError('NETWORK_ERROR', err.message);
    }

    throw new ApiError('UNKNOWN_ERROR', 'An unexpected error occurred');
  }
}

// =============================================================================
// API Client
// =============================================================================

/**
 * API client for communicating with the Adjutant backend.
 * Provides methods for status, power, mail, and agent operations.
 */
export const api = {
  /**
   * Get gastown system status.
   */
  async getStatus(): Promise<GastownStatus> {
    return apiFetch<GastownStatus>('/status');
  },

  /**
   * Power operations.
   */
  power: {
    async up(): Promise<{ previousState: PowerState; newState: PowerState }> {
      return apiFetch('/power/up', { method: 'POST' });
    },

    async down(): Promise<{ previousState: PowerState; newState: PowerState }> {
      return apiFetch('/power/down', { method: 'POST' });
    },
  },

  /**
   * Mail operations.
   */
  mail: {
    async list(params?: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      all?: boolean;
    }): Promise<PaginatedResponse<Message>> {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set('limit', params.limit.toString());
      if (params?.offset) searchParams.set('offset', params.offset.toString());
      if (params?.unreadOnly) searchParams.set('unreadOnly', 'true');
      if (params?.all) searchParams.set('all', 'true');

      const query = searchParams.toString();
      return apiFetch(`/mail${query ? `?${query}` : ''}`);
    },

    async get(messageId: string): Promise<Message> {
      return apiFetch(`/mail/${encodeURIComponent(messageId)}`);
    },

    async send(request: SendMessageRequest): Promise<{ messageId: string }> {
      return apiFetch('/mail', { method: 'POST', body: request });
    },

    async markRead(messageId: string): Promise<void> {
      return apiFetch(`/mail/${encodeURIComponent(messageId)}/read`, {
        method: 'POST',
      });
    },

    async getThread(threadId: string): Promise<Message[]> {
      return apiFetch(`/mail/thread/${encodeURIComponent(threadId)}`);
    },

    async getIdentity(): Promise<string> {
      const result = await apiFetch<{ identity: string }>('/mail/identity');
      return result.identity;
    },
  },

  /**
   * Agent operations.
   */
  agents: {
    async list(): Promise<CrewMember[]> {
      return apiFetch('/agents');
    },

    async check(): Promise<{ healthy: boolean; issues: string[] }> {
      return apiFetch('/agents/health');
    },

    /**
     * Request a new polecat spawn for a rig.
     * Sends a task message to the mayor.
     */
    async spawnPolecat(rig: string): Promise<{ rig: string; requested: boolean }> {
      return apiFetch('/agents/spawn-polecat', {
        method: 'POST',
        body: { rig },
      });
    },

    /**
     * Get terminal content for a polecat's tmux session.
     * Returns raw output with ANSI escape codes for xterm.js rendering.
     */
    async getTerminal(rig: string, polecat: string): Promise<{
      content: string;
      sessionName: string;
      timestamp: string;
    }> {
      return apiFetch(`/agents/${encodeURIComponent(rig)}/${encodeURIComponent(polecat)}/terminal`);
    },

    /**
     * Get terminal content for a swarm agent by session ID.
     * Returns plain text terminal output for lightweight display.
     */
    async getSessionTerminal(sessionId: string): Promise<{
      content: string;
      sessionId: string;
      sessionName: string;
      timestamp: string;
    }> {
      return apiFetch(`/agents/session/${encodeURIComponent(sessionId)}/terminal`);
    },
  },

  /**
   * Beads operations.
   */
  beads: {
    /**
     * List beads with filtering.
     * @param params.status - Status filter options:
     *   - "default": Shows open + in_progress + blocked (active work)
     *   - "open", "in_progress", "blocked", "deferred", "closed": Single status
     *   - "all": Shows everything
     */
    async list(params?: {
      rig?: string;
      status?: 'default' | 'open' | 'hooked' | 'in_progress' | 'blocked' | 'deferred' | 'closed' | 'all';
      type?: string;
      limit?: number;
    }): Promise<BeadInfo[]> {
      const searchParams = new URLSearchParams();
      if (params?.rig) searchParams.set('rig', params.rig);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.type) searchParams.set('type', params.type);
      if (params?.limit) searchParams.set('limit', params.limit.toString());

      const query = searchParams.toString();
      return apiFetch(`/beads${query ? `?${query}` : ''}`);
    },

    /**
     * Get a single bead by ID with full details.
     * @param id Full bead ID (e.g., "hq-vts8", "adj-53tj")
     */
    async get(id: string): Promise<BeadDetail> {
      return apiFetch(`/beads/${encodeURIComponent(id)}`);
    },

    /**
     * Update a bead's status and/or assignee.
     * @param id Full bead ID (e.g., "hq-vts8", "gb-53tj")
     * @param fields Fields to update (at least one required)
     */
    async update(id: string, fields: { status?: string; assignee?: string }): Promise<{ id: string; status?: string; assignee?: string }> {
      return apiFetch(`/beads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: fields,
      });
    },

    /**
     * Assign a bead to an agent.
     * @param id Full bead ID
     * @param agentId Agent name to assign to
     */
    async assign(id: string, agentId: string): Promise<{ id: string; assignee: string }> {
      return apiFetch(`/beads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { assignee: agentId },
      });
    },

    /**
     * Get available bead sources (projects/rigs) and deployment mode.
     * Used to populate filter dropdowns in any deployment mode.
     */
    async sources(): Promise<{ sources: { name: string; path: string; hasBeads: boolean }[]; mode: string }> {
      return apiFetch('/beads/sources');
    },
  },

  /**
   * Epics operations.
   */
  epics: {
    /**
     * List epics with optional rig filter.
     */
    async list(params?: { rig?: string }): Promise<BeadInfo[]> {
      const query = new URLSearchParams();
      if (params?.rig) query.set('rig', params.rig);
      query.set('type', 'epic');
      query.set('status', 'all');
      return apiFetch(`/beads?${query}`);
    },

    /**
     * Get a single epic by ID.
     */
    async get(id: string): Promise<BeadInfo> {
      return apiFetch(`/beads/${encodeURIComponent(id)}`);
    },

    /**
     * Get subtasks for an epic.
     */
    async getSubtasks(epicId: string): Promise<BeadInfo[]> {
      const all = await apiFetch<BeadInfo[]>('/beads?status=all');
      return all.filter(
        (b) => b.labels.some((l) => l.includes(epicId) || l.includes(`parent:${epicId}`))
      );
    },
  },

  /**
   * Session operations.
   */
  sessions: {
    async kill(sessionId: string): Promise<{ killed: boolean }> {
      return apiFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    },
  },

  /**
   * Swarm operations.
   */
  swarms: {
    async addAgent(swarmId: string, name?: string): Promise<{ id: string; name: string }> {
      return apiFetch(`/swarms/${encodeURIComponent(swarmId)}/agents`, {
        method: 'POST',
        body: name ? { name } : {},
      });
    },
  },

  /**
   * Persistent chat messages (SQLite-backed).
   */
  messages: {
    async list(params?: {
      agentId?: string;
      threadId?: string;
      before?: string;
      beforeId?: string;
      limit?: number;
    }): Promise<PaginatedResponse<ChatMessage>> {
      const searchParams = new URLSearchParams();
      if (params?.agentId) searchParams.set('agentId', params.agentId);
      if (params?.threadId) searchParams.set('threadId', params.threadId);
      if (params?.before) searchParams.set('before', params.before);
      if (params?.beforeId) searchParams.set('beforeId', params.beforeId);
      if (params?.limit) searchParams.set('limit', params.limit.toString());

      const query = searchParams.toString();
      return apiFetch(`/messages${query ? `?${query}` : ''}`);
    },

    async get(id: string): Promise<ChatMessage> {
      return apiFetch(`/messages/${encodeURIComponent(id)}`);
    },

    async getUnread(): Promise<{ counts: UnreadCount[] }> {
      return apiFetch('/messages/unread');
    },

    async getThreads(agentId?: string): Promise<{ threads: ChatThread[] }> {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      return apiFetch(`/messages/threads${query}`);
    },

    async markRead(id: string): Promise<void> {
      return apiFetch(`/messages/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    },

    async markAllRead(agentId: string): Promise<void> {
      return apiFetch(`/messages/read-all?agentId=${encodeURIComponent(agentId)}`, { method: 'PATCH' });
    },

    async send(params: {
      to: string;
      body: string;
      threadId?: string;
      metadata?: Record<string, unknown>;
    }): Promise<{ messageId: string; timestamp: string }> {
      return apiFetch('/messages', { method: 'POST', body: params });
    },

    async search(params: {
      q: string;
      agentId?: string;
      limit?: number;
    }): Promise<PaginatedResponse<ChatMessage>> {
      const searchParams = new URLSearchParams();
      searchParams.set('q', params.q);
      if (params.agentId) searchParams.set('agentId', params.agentId);
      if (params.limit) searchParams.set('limit', params.limit.toString());

      return apiFetch(`/messages/search?${searchParams}`);
    },
  },

  /**
   * Proposals operations.
   */
  proposals: {
    async list(params?: {
      status?: 'pending' | 'accepted' | 'dismissed';
      type?: 'product' | 'engineering';
    }): Promise<Proposal[]> {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set('status', params.status);
      if (params?.type) searchParams.set('type', params.type);

      const query = searchParams.toString();
      return apiFetch(`/proposals${query ? `?${query}` : ''}`);
    },

    async get(id: string): Promise<Proposal> {
      return apiFetch(`/proposals/${encodeURIComponent(id)}`);
    },

    async updateStatus(id: string, status: 'accepted' | 'dismissed'): Promise<Proposal> {
      return apiFetch(`/proposals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { status },
      });
    },
  },

  /**
   * Voice operations - T020
   */
  voice: {
    /**
     * Synthesize text to speech.
     */
    async synthesize(request: SynthesizeRequest): Promise<ApiResponse<SynthesizeResponse>> {
      const result = await apiFetch<SynthesizeResponse>('/voice/synthesize', {
        method: 'POST',
        body: request,
      });
      return { success: true, data: result, timestamp: new Date().toISOString() };
    },

    /**
     * Get the audio URL for a filename.
     */
    getAudioUrl(filename: string): string {
      const base = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';
      return `${base}/voice/audio/${encodeURIComponent(filename)}`;
    },

    /**
     * Get voice configuration.
     */
    async getConfig(): Promise<VoiceConfigResponse> {
      return apiFetch('/voice/config');
    },

    /**
     * Check voice service status.
     */
    async getStatus(): Promise<VoiceStatus> {
      return apiFetch('/voice/status');
    },

    /**
     * Transcribe audio to text.
     */
    async transcribe(
      audioData: Uint8Array,
      mimeType: string
    ): Promise<ApiResponse<TranscribeResponse>> {
      const url = `${API_BASE_URL}/voice/transcribe`;
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
      };

      // Add API key authorization header if configured
      const apiKey = getApiKey();
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: audioData,
      });

      const json = (await response.json()) as ApiResponse<TranscribeResponse>;
      return json;
    },
  },
};

export default api;
