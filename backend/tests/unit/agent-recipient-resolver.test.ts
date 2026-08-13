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

const mockGetAgents = vi.fn();
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

import {
  resolveAgentRecipient,
  resolveAgentRecipientOrThrow,
} from "../../src/services/agent-recipient-resolver.js";

function roster(...names: string[]) {
  return { success: true, data: names.map((n) => ({ id: n, name: n })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAgents.mockResolvedValue(roster("kerrigan", "raynor", "fenix"));
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
    mockGetAgents.mockResolvedValue(roster("alpha", "alphb"));
    const res = await resolveAgentRecipient("alphc");
    expect(res.status).toBe("unknown");
    expect(res.candidates).toEqual(expect.arrayContaining(["alpha", "alphb"]));
  });

  // The distinction the throwing helper could not make.
  it("reports roster-unavailable — NOT unknown — when the roster cannot be read", async () => {
    mockGetAgents.mockResolvedValue({ success: false });
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
  });

  it("reports roster-unavailable when the roster is empty", async () => {
    mockGetAgents.mockResolvedValue(roster());
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
  });

  it("reports roster-unavailable when getAgents throws, rather than propagating", async () => {
    mockGetAgents.mockRejectedValue(new Error("tmux is not running"));
    const res = await resolveAgentRecipient("kerrigan");
    expect(res.status).toBe("roster-unavailable");
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

  it("throws without a suggestion when there is nothing to suggest", async () => {
    mockGetAgents.mockResolvedValue(roster());
    await expect(resolveAgentRecipientOrThrow("kerrigan")).rejects.toThrow('No agent named "kerrigan".');
  });
});
