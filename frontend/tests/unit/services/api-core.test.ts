import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasApiKey, setApiKey, clearApiKey, ApiError, api } from '../../../src/services/api';

// Mock fetch globally
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockSuccessResponse<T>(data: T) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data, timestamp: new Date().toISOString() }),
  };
}

function mockErrorResponse(code: string, message: string, status = 400) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({
      success: false,
      error: { code, message },
      timestamp: new Date().toISOString(),
    }),
  };
}

describe('hasApiKey', () => {
  it('should return true when API key is set in session storage', () => {
    setApiKey('test-key-123');
    expect(hasApiKey()).toBe(true);
  });

  it('should return false when no API key is set', () => {
    expect(hasApiKey()).toBe(false);
  });

  it('should return false after API key is cleared', () => {
    setApiKey('test-key-123');
    clearApiKey();
    expect(hasApiKey()).toBe(false);
  });

  it('should return false for empty string API key', () => {
    sessionStorage.setItem('adjutant-api-key', '');
    expect(hasApiKey()).toBe(false);
  });
});

describe('apiFetch Authorization header', () => {
  it('should include Authorization header when API key is set', async () => {
    setApiKey('secret-key-42');
    mockFetch.mockResolvedValue(mockSuccessResponse({ ok: true }));

    await api.agents.list();

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-42');
  });

  it('should not include Authorization header when no API key is set', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse({ ok: true }));

    await api.agents.list();

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('apiFetch timeout', () => {
  it('should throw TIMEOUT ApiError when request exceeds timeout', async () => {
    // Mock a fetch that never resolves naturally but respects abort signal
    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    vi.useFakeTimers();

    const promise = api.agents.check();

    // Advance past the default 30s timeout
    vi.advanceTimersByTime(31_000);

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow(/timed out/i);

    vi.useRealTimers();
  });
});

describe('apiFetch ApiError re-throw', () => {
  it('should preserve original ApiError code when API returns structured error', async () => {
    mockFetch.mockResolvedValue(
      mockErrorResponse('AGENT_OFFLINE', 'Agent is not connected', 503)
    );

    try {
      await api.messages.send({ to: 'agent-1', body: 'Test' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      // The error code should be the original AGENT_OFFLINE, not re-wrapped as NETWORK_ERROR
      expect(apiErr.code).toBe('AGENT_OFFLINE');
      expect(apiErr.message).toBe('Agent is not connected');
      expect(apiErr.status).toBe(503);
    }
  });
});
