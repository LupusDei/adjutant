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
  Convoy,
  BeadInfo,
} from '../types';

// =============================================================================
// Configuration
// =============================================================================

// Use relative URL by default - works with Vite proxy for local dev AND ngrok tunneling
// Set VITE_API_URL only when you need to hit a different backend (e.g., production)
const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';
const DEFAULT_TIMEOUT = 30000;

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
 * API client for communicating with the gastown-boy backend.
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
  },

  /**
   * Convoy operations.
   */
  convoys: {
    async list(): Promise<Convoy[]> {
      return apiFetch('/convoys');
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
  },
};

export default api;
