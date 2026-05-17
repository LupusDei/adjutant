/**
 * Tests for adj-139.3.5: useTerminalStream content ring buffer.
 *
 * Verifies appendWithRingBuffer (pure helper exported from useTerminalStream):
 *  - never lets content exceed MAX_TERMINAL_BYTES
 *  - drops oldest lines, never truncating mid-line
 *  - preserves newest content verbatim
 */
import { describe, it, expect } from 'vitest';

import {
  appendWithRingBuffer,
  MAX_TERMINAL_BYTES,
} from '../../src/hooks/useTerminalStream';

describe('appendWithRingBuffer (adj-139.3.5)', () => {
  it('should append plain text when total is under the cap', () => {
    const result = appendWithRingBuffer(null, 'hello');
    expect(result).toBe('hello');

    const next = appendWithRingBuffer(result, 'world');
    expect(next).toBe('hello\nworld');
  });

  it('should never exceed MAX_TERMINAL_BYTES', () => {
    // Build a string > MAX bytes from many small lines.
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) {
      lines.push(`line-${i}-${'x'.repeat(20)}`); // ~30 bytes per line
    }

    let content: string | null = null;
    for (const ln of lines) {
      content = appendWithRingBuffer(content, ln);
      expect((content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    }
    expect((content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    expect((content ?? '').length).toBeGreaterThan(0);
  });

  it('should drop oldest lines (FIFO) when over the cap', () => {
    // First chunk: large content that fills almost the entire buffer.
    const big = 'A'.repeat(MAX_TERMINAL_BYTES - 10);
    // Append a new tail that pushes past the cap.
    const newTail = `B\nC\nD${'E'.repeat(50)}`;
    const result = appendWithRingBuffer(big, newTail);

    // Total length must be ≤ cap.
    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    // The newest text must still be present at the end.
    expect(result.endsWith(`D${'E'.repeat(50)}`)).toBe(true);
  });

  it('should preserve line boundaries (never truncate mid-line)', () => {
    // Create content where every line is distinct and identifiable.
    const lines = Array.from({ length: 5000 }, (_, i) => `LINE_${String(i).padStart(5, '0')}_${'.'.repeat(40)}`);
    let content: string | null = null;
    for (const ln of lines) {
      content = appendWithRingBuffer(content, ln);
    }

    expect(content).not.toBeNull();
    const finalLines = (content ?? '').split('\n');

    // Every surviving line must match the LINE_NNNNN_..... pattern exactly.
    // If we truncated mid-line, the first surviving line would be a partial match.
    const linePattern = /^LINE_\d{5}_\.{40}$/;
    for (const ln of finalLines) {
      expect(ln).toMatch(linePattern);
    }
  });

  it('should keep the newest input intact even if it alone is large', () => {
    // Pre-existing content fills the buffer.
    const filler = 'X'.repeat(MAX_TERMINAL_BYTES - 100);
    // New text is larger than what's left but still smaller than the cap.
    const newText = 'NEW_LINE_AAA\nNEW_LINE_BBB\nNEW_LINE_CCC';
    const result = appendWithRingBuffer(filler, newText);

    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    expect(result.endsWith('NEW_LINE_CCC')).toBe(true);
    expect(result.includes('NEW_LINE_AAA')).toBe(true);
  });

  it('should handle the case where new text alone exceeds the cap by keeping only the last MAX bytes worth of complete lines', () => {
    // newText is huge. Make it many lines so we keep complete tail lines.
    const lines = Array.from({ length: 10000 }, (_, i) => `L${i}_${'y'.repeat(20)}`);
    const huge = lines.join('\n');
    const result = appendWithRingBuffer(null, huge);

    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    // The very last line should be intact at the end.
    expect(result.endsWith(`L9999_${'y'.repeat(20)}`)).toBe(true);
    // Result must not start mid-line.
    expect(result.split('\n')[0]).toMatch(/^L\d+_y+$/);
  });

  it('should handle null prev', () => {
    expect(appendWithRingBuffer(null, 'first')).toBe('first');
  });

  it('should handle empty new text without changing prev', () => {
    expect(appendWithRingBuffer('existing', '')).toBe('existing');
  });
});
