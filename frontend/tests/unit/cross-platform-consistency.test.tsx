/**
 * Cross-platform consistency tests (Phase 5.3).
 *
 * Verifies that the Frontend tab visibility rules and SSE mode_changed handling
 * match the expected behavior that iOS also implements. Both platforms must:
 * 1. Show the same tabs per mode
 * 2. React to SSE mode_changed events the same way
 * 3. Use the same mode identifiers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModeProvider, useMode, useVisibleTabs } from '../../src/contexts/ModeContext';

// =============================================================================
// Test Components
// =============================================================================

function ModeAndTabsDisplay() {
  const { mode, features } = useMode();
  const visibleTabs = useVisibleTabs();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="features">{features.join(',')}</span>
      <span data-testid="tabs">{Array.from(visibleTabs).sort().join(',')}</span>
    </div>
  );
}

// =============================================================================
// Expected tab visibility (MUST match iOS DeploymentMode.visibleTabs)
// =============================================================================

const EXPECTED_TABS = {
  gastown: ['beads', 'chat', 'crew', 'dashboard', 'epics', 'mail', 'settings'],
  swarm: ['beads', 'chat', 'crew', 'epics', 'settings'],
};

// =============================================================================
// Mocks
// =============================================================================

let mockFetchResponses: Record<string, { ok: boolean; json: () => unknown }> = {};
let mockEventSourceInstances: {
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onerror: ((event: Event) => void) | null;
}[] = [];

beforeEach(() => {
  mockFetchResponses = {};
  mockEventSourceInstances = [];

  vi.stubGlobal('EventSource', vi.fn(() => {
    const instance = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      onerror: null,
    };
    mockEventSourceInstances.push(instance);
    return instance;
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setupModeResponse(mode: string, features: string[]) {
  mockFetchResponses['/api/mode'] = {
    ok: true,
    json: () => ({
      success: true,
      data: { mode, features, availableModes: [] },
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
}

// =============================================================================
// Tests
// =============================================================================

describe('cross-platform consistency', () => {
  describe('tab visibility matches iOS per mode', () => {
    it('gastown mode: shows all 7 tabs (dashboard, mail, chat, epics, crew, beads, settings)', async () => {
      setupModeResponse('gastown', ['dashboard', 'mail', 'crew_hierarchy', 'epics', 'power_control']);

      render(
        <ModeProvider>
          <ModeAndTabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe(EXPECTED_TABS.gastown.join(','));
      });
    });

    it('swarm mode: shows chat, crew, epics, beads, settings (matches iOS)', async () => {
      setupModeResponse('swarm', ['chat', 'crew_flat', 'beads', 'mail']);

      render(
        <ModeProvider>
          <ModeAndTabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('tabs').textContent).toBe(EXPECTED_TABS.swarm.join(','));
      });
    });
  });

  describe('SSE mode_changed event handling', () => {
    it('should update mode when receiving mode_changed SSE event (same as iOS)', async () => {
      setupModeResponse('gastown', ['dashboard', 'mail']);

      render(
        <ModeProvider>
          <ModeAndTabsDisplay />
        </ModeProvider>
      );

      // Wait for initial mode to load
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('gastown');
      });

      // Verify EventSource was created and mode_changed listener was added
      expect(mockEventSourceInstances.length).toBeGreaterThan(0);
      const es = mockEventSourceInstances[0]!;

      // Find the mode_changed listener
      const modeChangedCall = es.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'mode_changed'
      );
      expect(modeChangedCall).toBeDefined();

      // Simulate SSE mode_changed event (same payload that iOS DataSyncService handles)
      const listener = modeChangedCall![1] as (event: { data: string }) => void;
      listener({
        data: JSON.stringify({
          mode: 'swarm',
          features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'],
          reason: 'Switched from gastown',
        }),
      });

      // Verify mode updated
      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      // Verify tabs also updated to match swarm
      expect(screen.getByTestId('tabs').textContent).toBe(EXPECTED_TABS.swarm.join(','));
    });

    it('mode_changed event with same payload format as backend emits', async () => {
      setupModeResponse('swarm', ['chat', 'crew_flat', 'beads', 'mail']);

      render(
        <ModeProvider>
          <ModeAndTabsDisplay />
        </ModeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
      });

      const es = mockEventSourceInstances[0]!;
      const modeChangedCall = es.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'mode_changed'
      );

      // Backend emits: { mode, features, reason }
      // Both iOS ModeChangedEvent and Frontend parse this same structure
      const listener = modeChangedCall![1] as (event: { data: string }) => void;
      listener({
        data: JSON.stringify({
          mode: 'swarm',
          features: ['chat', 'crew_flat', 'beads', 'mail', 'websocket', 'sse'],
          reason: 'Switched from swarm',
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('swarm');
        expect(screen.getByTestId('tabs').textContent).toBe(EXPECTED_TABS.swarm.join(','));
      });
    });
  });

  describe('mode identifier values match iOS DeploymentMode.rawValue', () => {
    // iOS uses: case gasTown = "gastown", case swarm = "swarm"
    // Frontend uses: type DeploymentMode = 'gastown' | 'swarm' | 'unknown'
    // Backend uses: type DeploymentMode = "gastown" | "swarm"

    it('uses "gastown" not "gas_town" or "GT"', async () => {
      setupModeResponse('gastown', []);
      render(<ModeProvider><ModeAndTabsDisplay /></ModeProvider>);
      await waitFor(() => { expect(screen.getByTestId('mode').textContent).toBe('gastown'); });
    });

    it('uses "swarm"', async () => {
      setupModeResponse('swarm', []);
      render(<ModeProvider><ModeAndTabsDisplay /></ModeProvider>);
      await waitFor(() => { expect(screen.getByTestId('mode').textContent).toBe('swarm'); });
    });
  });
});
