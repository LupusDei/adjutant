/**
 * Tests for resolveAgentName (adj-202.4.6).
 *
 * Live finding: the avatar was told to message "Phoenix" but the agent is registered
 * "fenix" (Praetor Fenix) — the send fired to a phantom recipient that reached 0 live
 * sessions. This resolver maps a SPOKEN name onto the REAL agent registry so every
 * command tool hits the canonical agent: exact → case/trim → token/alias → fuzzy, and
 * on no confident match returns the closest candidates so the avatar can ask.
 */

import { describe, it, expect } from "vitest";

import { resolveAgentName, type ResolvableAgent } from "../../src/services/agent-name-resolver.js";

const FLEET: ResolvableAgent[] = [
  { id: "fenix", name: "fenix" },
  { id: "kerrigan", name: "kerrigan" },
  { id: "raynor", name: "raynor" },
  { id: "greenplace/Toast", name: "Toast" },
];

describe("resolveAgentName", () => {
  it("resolves an exact name to the canonical agent", () => {
    const r = resolveAgentName("fenix", FLEET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent.name).toBe("fenix");
  });

  it("is case-insensitive and trims whitespace", () => {
    for (const spoken of ["FENIX", "  Fenix  ", "Fenix"]) {
      const r = resolveAgentName(spoken, FLEET);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.agent.name).toBe("fenix");
    }
  });

  it("resolves a display/alias phrase that contains the name token (Praetor Fenix → fenix)", () => {
    const r = resolveAgentName("Praetor Fenix", FLEET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent.name).toBe("fenix");
  });

  it("resolves a fuzzy near-miss to the canonical agent (Phoenix → fenix)", () => {
    const r = resolveAgentName("Phoenix", FLEET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent.name).toBe("fenix");
  });

  it("resolves an unambiguous abbreviation (ray → raynor)", () => {
    const r = resolveAgentName("ray", FLEET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent.name).toBe("raynor");
  });

  it("matches the last path segment of a slash id", () => {
    const r = resolveAgentName("toast", FLEET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent.name).toBe("Toast");
  });

  it("returns no-match with closest suggestions for an unknown name", () => {
    const r = resolveAgentName("Phoenix", [
      { id: "kerrigan", name: "kerrigan" },
      { id: "raynor", name: "raynor" },
    ]);
    // With no fenix in the fleet, Phoenix should NOT confidently resolve.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Array.isArray(r.closest)).toBe(true);
  });

  it("does NOT auto-resolve an ambiguous prefix — returns both as closest", () => {
    const ambiguous: ResolvableAgent[] = [
      { id: "raynor", name: "raynor" },
      { id: "raymond", name: "raymond" },
    ];
    const r = resolveAgentName("ray", ambiguous);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.closest).toContain("raynor");
      expect(r.closest).toContain("raymond");
    }
  });

  it("returns a generic no-match (empty closest) when nothing is remotely similar", () => {
    const r = resolveAgentName("zzqqxx", FLEET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.closest).toEqual([]);
  });

  it("returns no-match on an empty fleet", () => {
    const r = resolveAgentName("fenix", []);
    expect(r.ok).toBe(false);
  });
});
