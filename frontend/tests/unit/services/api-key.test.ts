/**
 * Regression tests for adj-0da4g — the API key must persist across windows.
 *
 * The key used to live in sessionStorage, which is scoped per window/tab and
 * wiped on close, so every new browser window demanded a fresh key. These
 * tests pin the storage medium (localStorage) and the single shared storage
 * key used by BOTH api.ts and api-costs.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  API_KEY_STORAGE_KEY,
  getApiKey,
  setApiKey,
  clearApiKey,
  hasApiKey,
} from '../../../src/services/api-key';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('api-key storage', () => {
  it('should use the shared adjutant-api-key storage key', () => {
    expect(API_KEY_STORAGE_KEY).toBe('adjutant-api-key');
  });

  it('should persist the key in localStorage so it survives a new window', () => {
    setApiKey('secret-42');

    // localStorage is shared across windows of the same origin and survives
    // browser restart — sessionStorage is not and does not.
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe('secret-42');
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('should read back the key written by another window', () => {
    // Simulate a second window: storage is already populated before this
    // module reads it.
    localStorage.setItem(API_KEY_STORAGE_KEY, 'from-other-window');

    expect(getApiKey()).toBe('from-other-window');
    expect(hasApiKey()).toBe(true);
  });

  it('should remove the key from localStorage when cleared', () => {
    setApiKey('secret-42');
    clearApiKey();

    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(getApiKey()).toBeNull();
    expect(hasApiKey()).toBe(false);
  });

  it('should report no key when the stored value is an empty string', () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, '');
    expect(hasApiKey()).toBe(false);
  });

  it('should migrate a legacy sessionStorage key into localStorage', () => {
    sessionStorage.setItem(API_KEY_STORAGE_KEY, 'legacy-key');

    expect(getApiKey()).toBe('legacy-key');
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe('legacy-key');
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('should prefer the localStorage key over a stale legacy session key', () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, 'current');
    sessionStorage.setItem(API_KEY_STORAGE_KEY, 'stale');

    expect(getApiKey()).toBe('current');
  });
});
