/**
 * Agent-name resolution for the avatar command tools (adj-202.4.6).
 *
 * The avatar hears a SPOKEN name ("Phoenix", "Praetor Fenix", "ray") and must hit the
 * REAL agent ("fenix", "raynor"). Without this, send_message/nudge_agent fire at a
 * phantom recipient that reaches 0 live sessions. This maps a spoken string onto the
 * agent registry (the same source list_agents uses) and returns the CANONICAL agent —
 * or, when there's no confident match, the closest candidates so the avatar can ask
 * "did you mean fenix?" instead of sending into the void.
 *
 * Tiers (first confident hit wins):
 *   1. exact (case-insensitive, trimmed) on name / id / last id segment
 *   2. token/alias — the spoken phrase contains an agent's name token, or vice versa
 *      ("Praetor Fenix" → fenix)
 *   3. fuzzy — best similarity (edit-distance + longest-common-substring) above a
 *      confidence threshold AND clearly ahead of the runner-up ("Phoenix" → fenix)
 *
 * Pure + dependency-free so it is trivially unit-testable; the registry is passed in.
 */

export interface ResolvableAgent {
  id: string;
  /** Display name / callsign — the canonical target the session registry knows. */
  name: string;
  displayName?: string | undefined;
  status?: string | undefined;
}

export type AgentNameResolution =
  | { ok: true; agent: ResolvableAgent }
  | { ok: false; closest: string[] };

/** Confidence needed to AUTO-resolve a fuzzy match. */
const AUTO_THRESHOLD = 0.7;
/** The winner must beat the runner-up by at least this, else it's ambiguous. */
const MARGIN = 0.1;
/** Below this score a candidate isn't even worth suggesting. */
const SUGGEST_FLOOR = 0.34;
/** Minimum spoken length before fuzzy/substring matching kicks in (avoids 1–2 char noise). */
const MIN_FUZZY_LEN = 3;

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Alphanumeric tokens, lowercased. */
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 0);
}

/** Candidate match keys for an agent: name, id, and the last segment of a slash id. */
function agentKeys(agent: ResolvableAgent): string[] {
  const keys = [agent.name, agent.id];
  if (agent.displayName) keys.push(agent.displayName);
  const slash = agent.id.lastIndexOf("/");
  if (slash >= 0) keys.push(agent.id.slice(slash + 1));
  return [...new Set(keys.map(normalize).filter((k) => k.length > 0))];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** Length of the longest substring common to both strings. */
function longestCommonSubstring(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const run = prev[j - 1]! + 1;
        curr[j] = run;
        if (run > best) best = run;
      }
    }
    prev = curr;
  }
  return best;
}

/** Similarity in [0,1] between a normalized spoken string and a candidate key. */
function similarity(spoken: string, key: string): number {
  if (spoken === key) return 1;
  const maxLen = Math.max(spoken.length, key.length);
  const minLen = Math.min(spoken.length, key.length);
  if (maxLen === 0) return 0;
  const levSim = 1 - levenshtein(spoken, key) / maxLen;
  const lcs = longestCommonSubstring(spoken, key);
  // Substring ratio only counts a meaningful (>=3 char) shared run.
  const lcsRatio = lcs >= 3 && minLen > 0 ? lcs / minLen : 0;
  return Math.max(levSim, lcsRatio);
}

/**
 * Resolve a spoken agent name against the registry. Returns the canonical agent on a
 * confident match, else the closest candidate names (best first, may be empty).
 */
export function resolveAgentName(spoken: string, agents: ResolvableAgent[]): AgentNameResolution {
  const normSpoken = normalize(spoken);
  if (!normSpoken || agents.length === 0) return { ok: false, closest: [] };

  const spokenTokens = tokenize(spoken);

  // Tier 1: exact key match.
  for (const agent of agents) {
    if (agentKeys(agent).includes(normSpoken)) return { ok: true, agent };
  }

  // Tier 2: token/alias containment — the spoken phrase names the agent as a token
  // ("praetor fenix" → fenix), or the spoken token is itself an agent key.
  const tokenMatches = agents.filter((agent) => {
    const keys = agentKeys(agent);
    return keys.some((key) => spokenTokens.includes(key) || (key.length >= MIN_FUZZY_LEN && spokenTokens.some((t) => t === key)));
  });
  if (tokenMatches.length === 1) return { ok: true, agent: tokenMatches[0]! };

  // Tier 3: fuzzy scoring.
  const scored = agents
    .map((agent) => ({
      agent,
      score: normSpoken.length >= MIN_FUZZY_LEN ? Math.max(...agentKeys(agent).map((k) => similarity(normSpoken, k))) : 0,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const second = scored[1];
  const clearWinner = best.score >= AUTO_THRESHOLD && (!second || best.score - second.score >= MARGIN);
  if (clearWinner) return { ok: true, agent: best.agent };

  const closest = scored
    .filter((s) => s.score >= SUGGEST_FLOOR)
    .slice(0, 3)
    .map((s) => s.agent.name);
  return { ok: false, closest };
}
