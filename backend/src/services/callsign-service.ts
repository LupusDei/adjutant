/**
 * Callsign Service — assigns StarCraft hero names to agents on spawn.
 *
 * Provides a roster of 44 hero callsigns across Terran, Zerg, and Protoss races.
 * Names are checked against active sessions to ensure uniqueness.
 */

// ============================================================================
// Types
// ============================================================================

export type Race = "terran" | "zerg" | "protoss";

export interface CallsignEntry {
  name: string;
  race: Race;
}

export interface CallsignStatus extends CallsignEntry {
  available: boolean;
}

// ============================================================================
// Roster
// ============================================================================

export const CALLSIGNS: readonly CallsignEntry[] = [
  // Terran (15)
  { name: "raynor", race: "terran" },
  { name: "kerrigan", race: "terran" },
  { name: "tychus", race: "terran" },
  { name: "nova", race: "terran" },
  { name: "mengsk", race: "terran" },
  { name: "swann", race: "terran" },
  { name: "horner", race: "terran" },
  { name: "stetmann", race: "terran" },
  { name: "tosh", race: "terran" },
  { name: "valerian", race: "terran" },
  { name: "stukov", race: "terran" },
  { name: "duke", race: "terran" },
  { name: "warfield", race: "terran" },
  { name: "han", race: "terran" },
  { name: "hammer", race: "terran" },
  // Zerg (13)
  { name: "zagara", race: "zerg" },
  { name: "abathur", race: "zerg" },
  { name: "dehaka", race: "zerg" },
  { name: "niadra", race: "zerg" },
  { name: "izsha", race: "zerg" },
  { name: "zurvan", race: "zerg" },
  { name: "overmind", race: "zerg" },
  { name: "daggoth", race: "zerg" },
  { name: "nafash", race: "zerg" },
  { name: "mukav", race: "zerg" },
  { name: "naktul", race: "zerg" },
  { name: "brakk", race: "zerg" },
  { name: "amon", race: "zerg" },
  // Protoss (16)
  { name: "artanis", race: "protoss" },
  { name: "zeratul", race: "protoss" },
  { name: "tassadar", race: "protoss" },
  { name: "fenix", race: "protoss" },
  { name: "karax", race: "protoss" },
  { name: "vorazun", race: "protoss" },
  { name: "alarak", race: "protoss" },
  { name: "rohana", race: "protoss" },
  { name: "selendis", race: "protoss" },
  { name: "aldaris", race: "protoss" },
  { name: "raszagal", race: "protoss" },
  { name: "talandar", race: "protoss" },
  { name: "urun", race: "protoss" },
  { name: "mohandar", race: "protoss" },
  { name: "clolarion", race: "protoss" },
  { name: "lasarra", race: "protoss" },
] as const;

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get the set of active session names from a sessions list.
 * Accepts any array of objects with a `name` and `status` field,
 * matching the SessionInfo shape returned by SessionBridge.listSessions().
 */
function getActiveNames(
  sessions: Array<{ name: string; status: string }>
): Set<string> {
  return new Set(
    sessions
      .filter((s) => s.status !== "offline")
      .map((s) => s.name)
  );
}

/**
 * Returns all 44 callsigns with availability based on active sessions.
 */
export function getCallsigns(
  sessions: Array<{ name: string; status: string }>
): CallsignStatus[] {
  const active = getActiveNames(sessions);
  return CALLSIGNS.map((c) => ({
    ...c,
    available: !active.has(c.name),
  }));
}

/**
 * Pick a random available callsign. Returns undefined if all are taken.
 */
export function pickRandomCallsign(
  sessions: Array<{ name: string; status: string }>
): CallsignEntry | undefined {
  const active = getActiveNames(sessions);
  const available = CALLSIGNS.filter((c) => !active.has(c.name));
  if (available.length === 0) return undefined;
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Pick N unique random callsigns. Returns as many as available (up to count).
 */
export function pickRandomCallsigns(
  sessions: Array<{ name: string; status: string }>,
  count: number
): CallsignEntry[] {
  const active = getActiveNames(sessions);
  const available = CALLSIGNS.filter((c) => !active.has(c.name));

  // Fisher-Yates shuffle on a copy, then take first N
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return shuffled.slice(0, count);
}

/**
 * Check if a specific callsign name is available.
 */
export function isCallsignAvailable(
  sessions: Array<{ name: string; status: string }>,
  name: string
): boolean {
  const active = getActiveNames(sessions);
  return !active.has(name);
}

/**
 * Check if a name is a known callsign from the roster.
 */
export function isKnownCallsign(name: string): boolean {
  return CALLSIGNS.some((c) => c.name === name);
}
