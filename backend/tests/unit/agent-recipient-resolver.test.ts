/**
 * Shared agent-recipient resolution (syl-j8fa.7).
 *
 * ONE resolution rule for the fleet. `resolveAgentName` (pure, already tested) does the
 * matching; this module is the roster-fetching wrapper around it, and it exists so the
 * Bridge path and the `direct_message` MCP tool cannot drift apart.
 *
 * The wrapper adds one distinction the throwing Bridge helper could not express: "I
 * checked the roster and that name is not on it" is NOT the same as "I could not read
 * the roster at all". Conflating those is how a delivery failure gets reported as a
 * bad name, which is the failure class this epic exists to close.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// adj-xugvt: the candidate set comes from the MERGED fleet roster now, not the
// tmux-derived listing. An agent live over MCP with no local session used to be
// missing from the candidate list entirely, so `direct_message` answered "No
// agent named X" about an agent that had just messaged the coordinator.
const mockGetFleetRoster = vi.fn();
vi.mock("../../src/services/agent-roster.js", () => ({
  getFleetRoster: (...args: unknown[]) => mockGetFleetRoster(...args),
}));

import {
  resolveAgentRecipient,
  resolveAgentRecipientOrThrow,
} from "../../src/services/agent-recipient-resolver.js";

/** Injectable (tmux-backed) agents — the classic roster. */
function roster(...names: string[]) {
  return names.map((n) => ({ id: n, name: n, transport: "tmux", injectable: true }));
}

/** An agent that is live over MCP with no local session to inject into. */
function mcpOnly(name: string) {
  return { id: name, name, transport: "mcp", injectable: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFleetRoster.mockResolvedValue(roster("kerrigan", "raynor", "fenix"));
});

describe("resolveAgentRecipient", () => {
  it("resolves an exact registered name to itself", async () => {
    const res = await resolveAgentRecipient("kerrigan");
    expect(res).toMatchObject({ status: "resolved", canonical: "kerrigan" });
  });

  it("resolves a mistranscribed name to the canonical one (the Phoenix/fenix case)", async () => {
    const res = await resolveAgentRecipient("Phoenix");
    expect(res).toMatchObject({ status: "resolved", canonical: "fenix" });
  });

  it("reports unknown with candidates when the name matches nothing", async () => {
    const res = await resolveAgentRecipient("nobody-at-all");
    expect(res.status).toBe("unknown");
    expect(res.canonical).toBeUndefined();
    expect(res.candidates.length).toBeGreaterThan(0);
  });

  it("reports unknown when a near-miss is ambiguous between two agents", async () => {
    mockGetFleetRoster.mockResolvedValue(roster("alpha", "alphb"));
    const res = await resolveAgentRecipient("alphc");
    expect(res.status).toBe("unknown");
    expect(res.candidates).toEqual(expect.arrayContaining(["alpha", "alphb"]));
  });

  // The distinction the throwing helper could not make.
  it("reports roster-unavailable — NOT unknown — when the roster cannot be read", async () => {
    mockGetFleetRoster.mockRejectedValue(new Error("roster unreadable"));
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
  });

  it("reports roster-unavailable when the roster is empty", async () => {
    mockGetFleetRoster.mockResolvedValue(roster());
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
  });

  it("reports roster-unavailable when the roster lookup throws, rather than propagating", async () => {
    mockGetFleetRoster.mockRejectedValue(new Error("tmux is not running"));
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
  });
  // adj-xugvt: the correction that matters most. An agent that EXISTS but has no
  // injectable session is not an unknown name, and saying so cost a coordinator a
  // wrong report to the General.
  it("reports not-injectable — NOT unknown — for a live MCP-only agent", async () => {
    mockGetFleetRoster.mockResolvedValue([...roster("kerrigan"), mcpOnly("Adjudicator")]);

    const res = await resolveAgentRecipient("Adjudicator");

    expect(res.status).toBe("not-injectable");
    expect(res.canonical).toBe("Adjudicator");
  });

  it("resolves a mistranscribed MCP-only name and still marks it not-injectable", async () => {
    mockGetFleetRoster.mockResolvedValue([...roster("kerrigan"), mcpOnly("Adjudicator")]);

    const res = await resolveAgentRecipient("adjudicator");

    expect(res).toMatchObject({ status: "not-injectable", canonical: "Adjudicator" });
  });

  it("still reports unknown for a name that matches nothing on either transport", async () => {
    mockGetFleetRoster.mockResolvedValue([...roster("kerrigan"), mcpOnly("Adjudicator")]);

    const res = await resolveAgentRecipient("nobody-at-all");

    expect(res.status).toBe("unknown");
  });
});

describe("resolveAgentRecipientOrThrow (the Bridge's existing contract)", () => {
  it("returns the canonical name on a confident match", async () => {
    await expect(resolveAgentRecipientOrThrow("Phoenix")).resolves.toBe("fenix");
  });

  // Byte-for-byte the message the Bridge path already threw, so the avatar's
  // behaviour is unchanged by the extraction.
  it("throws naming the spoken name and suggesting candidates", async () => {
    await expect(resolveAgentRecipientOrThrow("nobody-at-all")).rejects.toThrow(
      /^No agent named "nobody-at-all"\. Did you mean: .+\?$/,
    );
  });

  it("throws a transport error — not a nonexistence claim — for an MCP-only agent", async () => {
    mockGetFleetRoster.mockResolvedValue([mcpOnly("Adjudicator")]);

    await expect(resolveAgentRecipientOrThrow("Adjudicator")).rejects.toThrow(
      /has no live session.*send_message/i,
    );
    await expect(resolveAgentRecipientOrThrow("Adjudicator")).rejects.not.toThrow(/No agent named/);
  });

  it("throws without a suggestion when there is nothing to suggest", async () => {
    mockGetFleetRoster.mockResolvedValue(roster());
    await expect(resolveAgentRecipientOrThrow("kerrigan")).rejects.toThrow('No agent named "kerrigan".');
  });
});
