/**
 * Agent-name resolution for the avatar's command tools (adj-202.4.6).
 *
 * The avatar directs agents by spoken NAME, which is often mistranscribed or informal
 * ("Phoenix" for "fenix", "Praetor Fenix" for "fenix"). Without resolution a send lands
 * on a phantom recipient (the literal spoken string) and never reaches a real agent — the
 * exact bug found in live testing. This maps a spoken name to a registered agent's
 * canonical messaging name (`CrewMember.name`, which is what the message store and the
 * session registry key on) using a small cascade: exact → substring → phonetic →
 * nearest-edit. When there is no confident match the caller is told to ASK the Commander
 * (with suggestions) rather than send into the void.
 *
 * `resolveAgentName` is a pure function over a supplied agent list so it is fully unit
 * testable; callers pass the same `getAgents()` source `list_agents` uses.
 */

export interface ResolvableAgent {
  id: string;
  name: string;
}

export interface AgentResolution {
  /** True when a single confident match was found. */
  matched: boolean;
  /** Canonical messaging name to deliver to (set iff matched). */
  canonical?: string;
  /** Up to 3 closest names to suggest when there is no confident match. */
  candidates: string[];
}

/** Lowercase + strip everything but [a-z0-9] so "Praetor Fenix" and "praetor-fenix" align. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Rough phonetic key so homophones collapse together: ph→f, ck→k, drop semivowels,
 * keep the leading letter, drop later vowels, collapse runs. "Phoenix" and "fenix" both
 * reduce to "fnx".
 */
export function phoneticKey(s: string): string {
  const x = norm(s).replace(/ph/g, "f").replace(/ck/g, "k").replace(/[yw]/g, "");
  if (!x) return "";
  const key = (x[0] ?? "") + x.slice(1).replace(/[aeiou]/g, "");
  return key.replace(/(.)\1+/g, "$1");
}

/** Standard Levenshtein edit distance (iterative, O(n) space). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Two-row DP. The `?? 0` fallbacks are unreachable (indices are bounded by the loops)
  // but satisfy noUncheckedIndexedAccess without non-null assertions.
  let prev: number[] = [];
  for (let j = 0; j <= n; j++) prev.push(j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr.push(Math.min(del, ins, sub));
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

/**
 * Resolve a spoken agent name to a registered agent's canonical messaging name.
 * Cascade (first confident, unambiguous hit wins):
 *   1. exact (normalized) on name or id
 *   2. substring either direction, unambiguous
 *   3. phonetic key, unambiguous
 *   4. nearest edit distance ≤ 2 and strictly closer than the runner-up
 * Otherwise `matched:false` with up to three closest candidate names.
 */
export function resolveAgentName(spoken: string, agents: ResolvableAgent[]): AgentResolution {
  const q = norm(spoken);
  if (!q || agents.length === 0) return { matched: false, candidates: [] };

  // 1. exact on name or id
  for (const a of agents) {
    if (norm(a.name) === q || norm(a.id) === q) return { matched: true, canonical: a.name, candidates: [] };
  }

  // 2. substring either direction, unambiguous
  const subs = agents.filter((a) => {
    const n = norm(a.name);
    return n.length > 0 && (n.includes(q) || q.includes(n));
  });
  if (subs.length === 1) return { matched: true, canonical: subs[0]!.name, candidates: [] };

  // 3. phonetic, unambiguous
  const pq = phoneticKey(spoken);
  const phon = pq ? agents.filter((a) => phoneticKey(a.name) === pq) : [];
  if (phon.length === 1) return { matched: true, canonical: phon[0]!.name, candidates: [] };

  // 4. nearest edit distance, accepted only when within threshold AND uniquely closest
  const scored = agents
    .map((a) => ({ name: a.name, d: levenshtein(norm(a.name), q) }))
    .sort((x, y) => x.d - y.d);
  const best = scored[0];
  const second = scored[1];
  if (best && best.d <= 2 && (!second || second.d > best.d)) {
    return { matched: true, canonical: best.name, candidates: [] };
  }

  return { matched: false, candidates: scored.slice(0, 3).map((s) => s.name) };
}
