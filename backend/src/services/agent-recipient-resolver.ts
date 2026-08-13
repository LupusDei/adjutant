/**
 * Shared agent-recipient resolution (syl-j8fa.7).
 *
 * ONE resolution rule for the fleet. The matching itself is `resolveAgentName`
 * (`bridge-agent-resolver.ts`) — pure, cascading exact → substring → phonetic →
 * nearest-edit, and separately tested. This module is the roster-fetching wrapper
 * around it, extracted out of `index.ts` so the avatar's Bridge path and the
 * `direct_message` MCP tool resolve names through the SAME code rather than through
 * two rules that can drift.
 *
 * The precedent is adj-202.4.6: the avatar said "Phoenix" for "fenix" and the message
 * went to a phantom recipient. A second matching rule elsewhere in the fleet is that
 * bug waiting to be reintroduced.
 *
 * WHY A THREE-WAY RESULT rather than the throw the Bridge used: "I checked the roster
 * and that name is not on it" and "I could not read the roster at all" are different
 * facts, and only the first is the sender's mistake. A caller that treats them alike
 * either rejects good messages during an infrastructure blip or accepts typos as real
 * recipients. `resolveAgentRecipientOrThrow` keeps the Bridge's original throwing
 * contract byte-for-byte on top of this.
 */

import { getAgents } from "./agents-service.js";
import { resolveAgentName } from "./bridge-agent-resolver.js";

export type RecipientResolutionStatus =
  /** A confident, unambiguous match against the roster. */
  | "resolved"
  /** The roster was read and this name is not a confident match for anything on it. */
  | "unknown"
  /** The roster could not be read (service failure, or nothing registered at all). */
  | "roster-unavailable";

export interface RecipientResolution {
  status: RecipientResolutionStatus;
  /** Canonical messaging name to deliver to. Set iff `status === "resolved"`. */
  canonical?: string;
  /** Up to three closest names to suggest. Only meaningful when `status === "unknown"`. */
  candidates: string[];
}

/** How a caller asks for a name to be resolved. Injected so call sites stay testable. */
export type RecipientResolver = (spoken: string) => Promise<RecipientResolution>;

/**
 * Resolve a spoken/typed agent name against the live roster.
 *
 * Never throws: a roster that cannot be read is reported as `roster-unavailable` so the
 * caller can decide, rather than surfacing as "no such agent" — which would blame the
 * sender for an outage.
 */
export async function resolveAgentRecipient(spoken: string): Promise<RecipientResolution> {
  let agents: { id: string; name: string }[] = [];
  try {
    const res = await getAgents();
    agents = res.success && res.data ? res.data.map((a) => ({ id: a.id, name: a.name })) : [];
  } catch {
    return { status: "roster-unavailable", candidates: [] };
  }

  // An empty roster is indistinguishable from a failed one for our purposes: either way
  // we have nothing to check against, so we must not claim the name is wrong.
  if (agents.length === 0) return { status: "roster-unavailable", candidates: [] };

  const resolution = resolveAgentName(spoken, agents);
  if (resolution.matched && resolution.canonical) {
    return { status: "resolved", canonical: resolution.canonical, candidates: [] };
  }
  return { status: "unknown", candidates: resolution.candidates };
}

/**
 * The Bridge path's original contract: resolve or throw. Preserved exactly — including
 * the message text — so extracting the resolver changed nothing for the avatar, which
 * surfaces this error to the Commander so he can correct the name.
 */
export async function resolveAgentRecipientOrThrow(spoken: string): Promise<string> {
  const resolution = await resolveAgentRecipient(spoken);
  if (resolution.status === "resolved" && resolution.canonical) return resolution.canonical;
  const hint = resolution.candidates.length ? ` Did you mean: ${resolution.candidates.join(", ")}?` : "";
  throw new Error(`No agent named "${spoken}".${hint}`);
}
