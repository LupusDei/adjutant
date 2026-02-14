import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModeProvider, useMode, useVisibleTabs } from '../../../src/contexts/ModeContext';

// =============================================================================
// Test Helpers
// =============================================================================

/** Component that renders mode state for testing */
function ModeDisplay() {
  const { mode, isGasTown, isStandalone, isSwarm, loading, error, features, hasFeature } = useMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <span data-testid="isGasTown">{String(isGasTown)}</span>
      <span data-testid="isStandalone">{String(isStandalone)}</span>
      <span data-testid="isSwarm">{String(isSwarm)}</span>
      <span data-testid="features">{features.join(',')}</span>
      <span data-testid="hasDashboard">{String(hasFeature('dashboard'))}</span>
    </div>
  );
}

/** Component that renders visible tabs for testing */
function TabsDisplay() {
  const visibleTabs = useVisibleTabs();
  return (
    <div>
      <span data-testid="tabs">{Array.from(visibleTabs).sort().join(',')}</span>
    </div>
  );
}

/** Component that tests switchMode */
function ModeSwitcher() {
  const { mode, switchMode } = useMode();
  return (
    <div>
      <span data-testid="current-mode">{mode}</span>
      <button onClick={() => void switchMode('standalone')}>Switch to Standalone</button>
    </div>
  );
}

// =============================================================================
// Mocks
// =============================================================================

let mockFetchResponses: Record<string, { ok: boolean; json: () => unknown }> = {};

beforeEach(() => {
  mockFetchResponses = {};

  // Default: /api/mode returns gastown
  mockFetchResponses['/api/mode'] = {
    ok: true,
    json: () => ({
      success: true,
      data: {
        mode: 'gastown',
        features: ['dashboard', 'mail', 'crew_hierarchy', 'epics', 'power_control'],
        availableModes: [
          { mode: 'gastown', available: true },
          { mode: 'standalone', available: true },
          { mode: 'swarm', available: true },
        ],
      },
    }),
  };

  global.fetch = vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const response = mockFetchResponses[urlStr];
    if (response) {
      return Promise.resolve(response as Response);
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });

  // Mock EventSource
  vi.stubGlobal('EventSource', vi.fn(() => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    onerror: null,
  })));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe('ModeContext', () => {
  describe('ModeProvider', () => {
    it('should throw when useMode is used outside ModeProvider', () => {
      // Suppress error boundary noise
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => render(<ModeDisplay />)).toThrow('useMode must be used within a ModeProvider');
      consoleSpy.mockRestore();
    });

    it('should start in loading state then resolve to gastown', async () => {
      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      // Eventually resolves to gastown
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('isGasTown').textContent).toBe('true');
      expect(screen.getByTestId('isStandalone').textContent).toBe('false');
      expect(screen.getByTestId('isSwarm').textContent).toBe('false');
    });

    it('should detect standalone mode from API', async () => {
      mockFetchResponses['/api/mode'] = {
        ok: true,
        json: () => ({
          success: true,
          data: {
            mode: 'standalone',
            features: ['chat', 'beads'],
            availableModes: [],
          },
        }),
      };

      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('standalone');
      });

      expect(screen.getByTestId('isStandalone').textContent).toBe('true');
      expect(screen.getByTestId('isGasTown').textContent).toBe('false');
    });

    it('should detect swarm mode from API', async () => {
      mockFetchResponses['/api/mode'] = {
        ok: true,
        json: () => ({
          success: true,
          data: {
            mode: 'swarm',
            features: ['chat', 'crew_flat', 'beads', 'mail'],
            availableModes: [],
          },
        }),
      };

      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      expect(screen.getByTestId('isSwarm').textContent).toBe('true');
    });

    it('should fall back to capabilities endpoint when /api/mode fails', async () => {
      mockFetchResponses['/api/mode'] = { ok: false, json: () => ({}) };
      mockFetchResponses['/api/power/capabilities'] = {
        ok: true,
        json: () => ({
          success: true,
          data: { canControl: false, autoStart: true },
        }),
      };

      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('standalone');
      });
    });

    it('should fall back to gastown when both endpoints fail', async () => {
      mockFetchResponses['/api/mode'] = { ok: false, json: () => ({}) };
      mockFetchResponses['/api/power/capabilities'] = { ok: false, json: () => ({}) };

      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });
    });

    it('should expose features and hasFeature', async () => {
      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('features').textContent).toContain('dashboard');
      });

      expect(screen.getByTestId('hasDashboard').textContent).toBe('true');
    });

    it('should connect to SSE for mode_changed events', async () => {
      render(
        <ModeProvider>
          <ModeDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Verify EventSource was created
      expect(EventSource).toHaveBeenCalledWith('/api/events');
    });
  });

  describe('useVisibleTabs', () => {
    it('should show all tabs in gastown mode', async () => {
      render(
        <ModeProvider>
          <TabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        const tabs = screen.getByTestId('tabs').textContent;
        expect(tabs).toContain('dashboard');
        expect(tabs).toContain('mail');
        expect(tabs).toContain('chat');
        expect(tabs).toContain('epics');
        expect(tabs).toContain('crew');
        expect(tabs).toContain('beads');
        expect(tabs).toContain('settings');
      });
    });

    it('should show only chat, beads, settings in standalone mode', async () => {
      mockFetchResponses['/api/mode'] = {
        ok: true,
        json: () => ({
          success: true,
          data: { mode: 'standalone', features: ['chat', 'beads'], availableModes: [] },
        }),
      };

      render(
        <ModeProvider>
          <TabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,settings');
      });
    });

    it('should show chat, crew, beads, settings in swarm mode', async () => {
      mockFetchResponses['/api/mode'] = {
        ok: true,
        json: () => ({
          success: true,
          data: { mode: 'swarm', features: ['chat', 'crew_flat', 'beads', 'mail'], availableModes: [] },
        }),
      };

      render(
        <ModeProvider>
          <TabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,settings');
      });
    });
  });

  describe('switchMode', () => {
    it('should call POST /api/mode and update state on success', async () => {
      const user = userEvent.setup();

      // Set up POST response
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr === '/api/mode' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                mode: 'standalone',
                features: ['chat', 'beads'],
                availableModes: [],
              },
            }),
          } as Response);
        }
        // GET /api/mode
        if (urlStr === '/api/mode') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                mode: 'gastown',
                features: ['dashboard'],
                availableModes: [],
              },
            }),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 404 } as Response);
      });

      render(
        <ModeProvider>
          <ModeSwitcher />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-mode').textContent).toBe('gastown');
      });

      await user.click(screen.getByText('Switch to Standalone'));

      await waitFor(() => {
        expect(screen.getByTestId('current-mode').textContent).toBe('standalone');
      });
    });
  });
});
