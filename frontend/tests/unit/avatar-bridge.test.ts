/**
 * avatar-bridge protocol (adj-202.3.7.1 / .7.2 / .7.3) — the parent↔/avatar
 * postMessage contract. The parser is defensive (the message channel is reachable
 * from the iframe), and applyCaption owns the interim→final caption merge.
 */
import { describe, it, expect } from 'vitest';

import { parseAvatarMessage, applyCaption } from '../../src/components/bridge/avatar-bridge';
import type { CaptionLine } from '../../src/components/bridge/CaptionsPanel';

describe('parseAvatarMessage', () => {
  it('should parse a ready message', () => {
    expect(parseAvatarMessage({ type: 'bridge:ready' })).toEqual({ type: 'bridge:ready' });
  });

  it('should parse a status message', () => {
    expect(parseAvatarMessage({ type: 'bridge:status', status: 'connected' })).toEqual({
      type: 'bridge:status',
      status: 'connected',
    });
  });

  it('should parse a caption message', () => {
    const msg = { type: 'bridge:caption', id: 'c1', role: 'assistant', text: 'Hi', final: true };
    expect(parseAvatarMessage(msg)).toEqual(msg);
  });

  it('should parse a mic state echo', () => {
    expect(parseAvatarMessage({ type: 'bridge:mic', enabled: false })).toEqual({
      type: 'bridge:mic',
      enabled: false,
    });
  });

  it('should parse a camera state echo', () => {
    expect(parseAvatarMessage({ type: 'bridge:camera', enabled: true })).toEqual({
      type: 'bridge:camera',
      enabled: true,
    });
  });

  it('should reject a camera echo with a non-boolean enabled', () => {
    expect(parseAvatarMessage({ type: 'bridge:camera', enabled: 'yes' })).toBeNull();
    expect(parseAvatarMessage({ type: 'bridge:camera' })).toBeNull();
  });

  it('should parse a screen-share state echo', () => {
    expect(parseAvatarMessage({ type: 'bridge:screenshare', enabled: true })).toEqual({
      type: 'bridge:screenshare',
      enabled: true,
    });
  });

  it('should reject a screen-share echo with a non-boolean enabled', () => {
    expect(parseAvatarMessage({ type: 'bridge:screenshare', enabled: 1 })).toBeNull();
    expect(parseAvatarMessage({ type: 'bridge:screenshare' })).toBeNull();
  });

  it('should parse a spawn read-back (confirm) message with just a summary', () => {
    expect(parseAvatarMessage({ type: 'bridge:spawn-confirm', summary: "I'll spawn a QA engineer" })).toEqual({
      type: 'bridge:spawn-confirm',
      summary: "I'll spawn a QA engineer",
    });
  });

  it('should carry the optional structured fields on a spawn read-back', () => {
    const msg = {
      type: 'bridge:spawn-confirm',
      summary: "I'll spawn a QA engineer on adjutant to triage flaky tests — confirm?",
      requestId: 'req-1',
      agentType: 'QA engineer',
      projectRef: 'adjutant',
      task: 'triage flaky tests',
    };
    expect(parseAvatarMessage(msg)).toEqual(msg);
  });

  it('should reject a spawn read-back without a string summary', () => {
    expect(parseAvatarMessage({ type: 'bridge:spawn-confirm' })).toBeNull();
    expect(parseAvatarMessage({ type: 'bridge:spawn-confirm', summary: 42 })).toBeNull();
  });

  it('should drop non-string optional fields on a spawn read-back rather than trust them', () => {
    expect(
      parseAvatarMessage({ type: 'bridge:spawn-confirm', summary: 'ok', requestId: 5, task: {} }),
    ).toEqual({ type: 'bridge:spawn-confirm', summary: 'ok' });
  });

  it('should reject foreign / malformed messages', () => {
    expect(parseAvatarMessage(null)).toBeNull();
    expect(parseAvatarMessage('hello')).toBeNull();
    expect(parseAvatarMessage({ type: 'something-else' })).toBeNull();
    expect(parseAvatarMessage({ type: 'bridge:caption', id: 'c1' })).toBeNull(); // missing fields
    expect(parseAvatarMessage({ type: 'bridge:status', status: 'bogus' })).toBeNull();
  });
});

describe('applyCaption', () => {
  it('should append a new caption line', () => {
    const out = applyCaption([], { type: 'bridge:caption', id: 'a', role: 'assistant', text: 'one', final: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', text: 'one', final: true });
  });

  it('should replace an interim line in place when the same id updates', () => {
    const start: CaptionLine[] = [{ id: 'a', role: 'assistant', text: 'par', final: false }];
    const out = applyCaption(start, {
      type: 'bridge:caption',
      id: 'a',
      role: 'assistant',
      text: 'partial done',
      final: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'partial done', final: true });
  });

  it('should cap the buffer length', () => {
    let lines: CaptionLine[] = [];
    for (let i = 0; i < 60; i++) {
      lines = applyCaption(lines, {
        type: 'bridge:caption',
        id: `c${String(i)}`,
        role: 'assistant',
        text: `line ${String(i)}`,
        final: true,
      }, 50);
    }
    expect(lines.length).toBe(50);
    // Oldest dropped, newest kept.
    expect(lines[lines.length - 1]?.text).toBe('line 59');
  });
});
