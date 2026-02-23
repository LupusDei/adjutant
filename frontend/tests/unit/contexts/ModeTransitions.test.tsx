import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModeProvider, useMode, useVisibleTabs, type DeploymentMode } from '../../../src/contexts/ModeContext';

// =============================================================================
// Test Helpers
// =============================================================================

/** Component that renders mode state and provides switch buttons for both modes */
function ModeTransitionTester() {
  const { mode, features, switchMode, isGasTown, isSwarm, loading, error, hasFeature } = useMode();
  const visibleTabs = useVisibleTabs();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <span data-testid="isGasTown">{String(isGasTown)}</span>
      <span data-testid="isSwarm">{String(isSwarm)}</span>
      <span data-testid="features">{features.join(',')}</span>
      <span data-testid="tabs">{Array.from(visibleTabs).sort().join(',')}</span>
      <span data-testid="hasDashboard">{String(hasFeature('dashboard'))}</span>
      <span data-testid="hasMail">{String(hasFeature('mail'))}</span>
      <span data-testid="hasChat">{String(hasFeature('chat'))}</span>
      <button data-testid="switch-gastown" onClick={() => void switchMode('gastown')}>
        To GasTown
      </button>
      <button data-testid="switch-swarm" onClick={() => void switchMode('swarm')}>
        To Swarm
      </button>
    </div>
  );
}

// =============================================================================
// Mock Data
// =============================================================================

const MODE_RESPONSES: Record<DeploymentMode, {
  mode: DeploymentMode;
  features: string[];
  availableModes: { mode: DeploymentMode; available: boolean; reason?: string }[];
}> = {
  gastown: {
    mode: 'gastown',
    features: ['power_control', 'rigs', 'epics', 'crew_hierarchy', 'mail', 'dashboard', 'refinery', 'witness', 'websocket', 'sse'],
    availableModes: [
      { mode: 'gastown', available: true },
      { mode: 'swarm', available: true },
    ],
  },
  swarm: {
    mode: 'swarm',
    features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'],
    availableModes: [
      { mode: 'gastown', available: true },
      { mode: 'swarm', available: true },
    ],
  },
  unknown: {
    mode: 'unknown',
    features: [],
    availableModes: [],
  },
};

// =============================================================================
// Mock Setup
// =============================================================================

let currentMode: DeploymentMode = 'gastown';

beforeEach(() => {
  currentMode = 'gastown';

  global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr === '/api/mode' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { mode: DeploymentMode };
      currentMode = body.mode;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: MODE_RESPONSES[body.mode],
        }),
      } as Response);
    }

    if (urlStr === '/api/mode') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: MODE_RESPONSES[currentMode],
        }),
      } as Response);
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

describe('mode transitions', () => {
  // ===========================================================================
  // Full cycle: switch through both modes
  // ===========================================================================

  describe('full mode cycle via switchMode', () => {
    it('should cycle gastown → swarm → gastown', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      // Start in gastown
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Switch to swarm
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      // Switch back to gastown
      await user.click(screen.getByTestId('switch-gastown'));
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });
    });

    it('should cycle swarm → gastown → swarm', async () => {
      currentMode = 'swarm';
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      await user.click(screen.getByTestId('switch-gastown'));
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });
    });
  });

  // ===========================================================================
  // Boolean flags update correctly across transitions
  // ===========================================================================

  describe('boolean mode flags', () => {
    it('should set only isGasTown=true in gastown mode', async () => {
      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isGasTown').textContent).toBe('true');
        expect(screen.getByTestId('isSwarm').textContent).toBe('false');
      });
    });

    it('should update boolean flags correctly when switching modes', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Switch to swarm
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('isGasTown').textContent).toBe('false');
        expect(screen.getByTestId('isSwarm').textContent).toBe('true');
      });
    });
  });

  // ===========================================================================
  // Tab visibility adapts to mode
  // ===========================================================================

  describe('tab visibility across transitions', () => {
    it('should show all 7 tabs in gastown mode', async () => {
      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,dashboard,epics,mail,settings');
      });
    });

    it('should show swarm tabs when switching to swarm', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      await user.click(screen.getByTestId('switch-swarm'));

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,epics,settings');
      });
    });

    it('should restore all tabs when switching back to gastown', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Go to swarm (5 tabs)
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,epics,settings');
      });

      // Back to gastown (all 7 tabs)
      await user.click(screen.getByTestId('switch-gastown'));
      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,dashboard,epics,mail,settings');
      });
    });
  });

  // ===========================================================================
  // Feature set updates across transitions
  // ===========================================================================

  describe('features update across transitions', () => {
    it('should update features when switching gastown → swarm', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('hasDashboard').textContent).toBe('true');
      });

      await user.click(screen.getByTestId('switch-swarm'));

      await waitFor(() => {
        expect(screen.getByTestId('hasDashboard').textContent).toBe('false');
        expect(screen.getByTestId('hasMail').textContent).toBe('true');
      });
    });

    it('should not carry stale features across mode transitions', async () => {
      const user = userEvent.setup();

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // gastown has dashboard
      expect(screen.getByTestId('features').textContent).toContain('dashboard');

      // Switch to swarm
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('features').textContent).not.toContain('dashboard');
        expect(screen.getByTestId('features').textContent).not.toContain('power_control');
        expect(screen.getByTestId('features').textContent).toContain('chat');
        expect(screen.getByTestId('features').textContent).toContain('beads');
      });
    });
  });

  // ===========================================================================
  // SSE mode_changed event handling
  // ===========================================================================

  describe('SSE mode_changed events', () => {
    it('should update mode when SSE mode_changed event is received', async () => {
      const sseHandlers: Record<string, (event: MessageEvent) => void> = {};

      vi.stubGlobal('EventSource', vi.fn(() => ({
        addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
          sseHandlers[type] = handler;
        }),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
      })));

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Simulate SSE mode_changed event
      act(() => {
        sseHandlers['mode_changed']?.({
          data: JSON.stringify({
            mode: 'swarm',
            features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'],
            action: 'mode_changed',
          }),
        } as MessageEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
        expect(screen.getByTestId('isSwarm').textContent).toBe('true');
      });
    });

    it('should update tabs when mode changes via SSE', async () => {
      const sseHandlers: Record<string, (event: MessageEvent) => void> = {};

      vi.stubGlobal('EventSource', vi.fn(() => ({
        addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
          sseHandlers[type] = handler;
        }),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
      })));

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,dashboard,epics,mail,settings');
      });

      // SSE pushes mode to swarm
      act(() => {
        sseHandlers['mode_changed']?.({
          data: JSON.stringify({
            mode: 'swarm',
            features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'],
            action: 'mode_changed',
          }),
        } as MessageEvent);
      });

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,epics,settings');
      });
    });

    it('should handle rapid SSE mode changes without data loss', async () => {
      const sseHandlers: Record<string, (event: MessageEvent) => void> = {};

      vi.stubGlobal('EventSource', vi.fn(() => ({
        addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
          sseHandlers[type] = handler;
        }),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
      })));

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Rapid fire SSE events
      act(() => {
        sseHandlers['mode_changed']?.({
          data: JSON.stringify({ mode: 'gastown', features: ['dashboard', 'mail', 'websocket', 'sse'] }),
        } as MessageEvent);
        sseHandlers['mode_changed']?.({
          data: JSON.stringify({ mode: 'swarm', features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'] }),
        } as MessageEvent);
      });

      // Should settle on the last mode
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
        expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,epics,settings');
      });
    });
  });

  // ===========================================================================
  // Error handling on failed transitions
  // ===========================================================================

  describe('transition error handling', () => {
    it('should preserve current mode when switch fails', async () => {
      const user = userEvent.setup();

      // Override fetch for POST to return failure
      global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr === '/api/mode' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: false,
              error: { code: 'MODE_UNAVAILABLE', message: 'Gas Town infrastructure not detected' },
            }),
          } as Response);
        }

        if (urlStr === '/api/mode') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: MODE_RESPONSES.swarm,
            }),
          } as Response);
        }

        return Promise.resolve({ ok: false, status: 404 } as Response);
      });

      currentMode = 'swarm';

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      // Try switching to gastown (fails)
      await user.click(screen.getByTestId('switch-gastown'));

      // Mode should remain swarm
      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toContain('Gas Town infrastructure not detected');
      });
      expect(screen.getByTestId('mode').textContent).toBe('swarm');
      expect(screen.getByTestId('tabs').textContent).toBe('beads,chat,crew,epics,settings');
    });

    it('should preserve current mode when network request fails', async () => {
      const user = userEvent.setup();

      global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr === '/api/mode' && init?.method === 'POST') {
          return Promise.reject(new Error('Network error'));
        }

        if (urlStr === '/api/mode') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: MODE_RESPONSES.gastown,
            }),
          } as Response);
        }

        return Promise.resolve({ ok: false, status: 404 } as Response);
      });

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      await user.click(screen.getByTestId('switch-swarm'));

      // Mode should remain gastown, error should be set
      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toContain('Network error');
      });
      expect(screen.getByTestId('mode').textContent).toBe('gastown');
    });

    it('should clear error on subsequent successful transition', async () => {
      const user = userEvent.setup();
      let failSwitch = true;

      global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr === '/api/mode' && init?.method === 'POST') {
          if (failSwitch) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                success: false,
                error: { code: 'MODE_UNAVAILABLE', message: 'Temporarily unavailable' },
              }),
            } as Response);
          }
          const body = JSON.parse(init.body as string) as { mode: DeploymentMode };
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: MODE_RESPONSES[body.mode],
            }),
          } as Response);
        }

        if (urlStr === '/api/mode') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: MODE_RESPONSES.gastown,
            }),
          } as Response);
        }

        return Promise.resolve({ ok: false, status: 404 } as Response);
      });

      render(
        <ModeProvider>
          <ModeTransitionTester />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // First attempt fails
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).not.toBe('null');
      });

      // Second attempt succeeds
      failSwitch = false;
      await user.click(screen.getByTestId('switch-swarm'));
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
        expect(screen.getByTestId('error').textContent).toBe('null');
      });
    });
  });
});
