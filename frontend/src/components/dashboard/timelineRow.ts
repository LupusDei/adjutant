/**
 * Pure helpers for the Overview dashboard timeline rows (adj timeline UX pass).
 *
 * The backend `events` table has no project_id column, so the project tag is
 * best-effort: prefer an explicit `detail.projectName`, else fall back to the
 * bead-id prefix (e.g. `adj-181.3.1` -> `adj`). Returns null when neither is
 * available (e.g. a status_change / message_sent event with no bead).
 */

interface TimelineRowLike {
  detail: Record<string, unknown> | null;
  beadId: string | null;
}

export function timelineEventProject(evt: TimelineRowLike): string | null {
  const pnRaw = evt.detail ? evt.detail['projectName'] : undefined;
  if (typeof pnRaw === 'string' && pnRaw) return pnRaw;
  if (evt.beadId) {
    const prefix = evt.beadId.split('-')[0];
    if (prefix) return prefix;
  }
  return null;
}

/**
 * Normalize an event action for single-line display: collapse newlines to
 * spaces and trim. Deliberately does NOT char-truncate — the row's action
 * column is flex:1 and uses CSS ellipsis, so it expands to fill the (wide)
 * available space and only ellipsizes on real overflow.
 */
export function timelineActionText(action: string): string {
  return action.replace(/\n/g, ' ').trim();
}
