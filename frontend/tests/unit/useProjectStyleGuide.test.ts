/**
 * useProjectStyleGuide (adj-201.2.1) — per-project brand-color editor data layer.
 *
 * The hook owns the read/write lifecycle for a single project's style guide
 * (brand color). It loads the guide on mount (scoped by projectId — the
 * canonical UUID key), exposes loading/error state, and a `save` mutation that
 * matches the backend contract:
 *   GET  /api/projects/:id/style-guide → { brandColorPrimary, brandColorSecondary }
 *   PUT  /api/projects/:id/style-guide   body { primary, secondary|null }
 *
 * An unset guide (both colors null) is a VALID state, not an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useProjectStyleGuide } from '../../src/hooks/useProjectStyleGuide';
import type { ProjectStyleGuide } from '../../src/types';

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    projects: {
      getStyleGuide: mockGet,
      updateStyleGuide: mockUpdate,
    },
  };
  return { api: apiObj, default: apiObj };
});

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function guide(
  primary: string | null,
  secondary: string | null = null,
): ProjectStyleGuide {
  return { brandColorPrimary: primary, brandColorSecondary: secondary };
}

describe('useProjectStyleGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(guide(null, null));
  });

  it('should expose loading defaults synchronously before the fetch resolves', () => {
    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));

    expect(result.current.loading).toBe(true);
    expect(result.current.guide).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it('should load the guide on mount scoped by projectId', async () => {
    mockGet.mockResolvedValue(guide('#00ff00', '#00aa00'));

    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(PROJECT_ID);
    expect(result.current.guide).toEqual(guide('#00ff00', '#00aa00'));
    expect(result.current.error).toBeNull();
  });

  it('should treat an unset guide (both colors null) as a valid, non-error state', async () => {
    mockGet.mockResolvedValue(guide(null, null));

    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.guide).toEqual(guide(null, null));
    expect(result.current.error).toBeNull();
  });

  it('should persist via save and reflect the updated guide', async () => {
    mockGet.mockResolvedValue(guide(null, null));
    mockUpdate.mockResolvedValue(guide('#ff0000', null));

    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.save({ primary: '#ff0000', secondary: null });
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(PROJECT_ID, {
      primary: '#ff0000',
      secondary: null,
    });
    expect(result.current.guide).toEqual(guide('#ff0000', null));
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should surface a load error and leave guide null', async () => {
    mockGet.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.guide).toBeNull();
  });

  it('should surface a save error without clearing the existing guide', async () => {
    mockGet.mockResolvedValue(guide('#00ff00', null));
    mockUpdate.mockRejectedValue(new Error('save failed'));

    const { result } = renderHook(() => useProjectStyleGuide(PROJECT_ID));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.save({ primary: '#zzz', secondary: null });
    });

    expect(result.current.error).toBe('save failed');
    expect(result.current.saving).toBe(false);
    // The optimistic guide is unchanged on failure.
    expect(result.current.guide).toEqual(guide('#00ff00', null));
  });
});
