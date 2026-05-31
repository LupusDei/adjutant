import { describe, it, expect } from 'vitest';
import { timelineEventProject, timelineActionText } from '../../src/components/dashboard/timelineRow';

/**
 * Timeline row helpers (Overview dashboard timeline section).
 * The `events` table carries no project_id, so the project tag is best-effort:
 * detail.projectName when present, else the bead-id prefix (e.g. adj-181.3 -> adj).
 */
describe('timelineEventProject', () => {
  it('returns detail.projectName when present', () => {
    expect(timelineEventProject({ detail: { projectName: 'bloomfolio' }, beadId: null })).toBe('bloomfolio');
  });

  it('derives the project prefix from beadId when no projectName', () => {
    expect(timelineEventProject({ detail: null, beadId: 'adj-181.3.1' })).toBe('adj');
    expect(timelineEventProject({ detail: { status: 'working' }, beadId: 'adj-181' })).toBe('adj');
  });

  it('prefers projectName over the bead prefix', () => {
    expect(timelineEventProject({ detail: { projectName: 'adjutant' }, beadId: 'adj-181' })).toBe('adjutant');
  });

  it('returns null when neither projectName nor beadId is available', () => {
    expect(timelineEventProject({ detail: null, beadId: null })).toBeNull();
    expect(timelineEventProject({ detail: { status: 'idle' }, beadId: null })).toBeNull();
  });

  it('ignores a non-string projectName', () => {
    expect(timelineEventProject({ detail: { projectName: 42 }, beadId: 'adj-9' })).toBe('adj');
  });
});

describe('timelineActionText', () => {
  it('collapses newlines to single spaces (no char truncation — CSS handles overflow)', () => {
    expect(timelineActionText('line one\nline two')).toBe('line one line two');
  });

  it('trims surrounding whitespace', () => {
    expect(timelineActionText('  hello  ')).toBe('hello');
  });

  it('does NOT truncate long text (the wide column + CSS ellipsis show as much as fits)', () => {
    const long = 'x'.repeat(300);
    expect(timelineActionText(long)).toBe(long);
  });
});
