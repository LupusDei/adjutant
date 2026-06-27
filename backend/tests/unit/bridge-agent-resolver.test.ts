import { describe, it, expect } from "vitest";

import { resolveAgentName, phoneticKey, levenshtein } from "../../src/services/bridge-agent-resolver.js";

const AGENTS = [
  { id: "fenix", name: "fenix" },
  { id: "kerrigan", name: "kerrigan" },
  { id: "raynor", name: "raynor" },
];

describe("resolveAgentName", () => {
  it("should resolve an exact name match (case-insensitive)", () => {
    const r = resolveAgentName("Fenix", AGENTS);
    expect(r.matched).toBe(true);
    expect(r.canonical).toBe("fenix");
  });

  it("should resolve a phonetic homophone (Phoenix -> fenix)", () => {
    const r = resolveAgentName("Phoenix", AGENTS);
    expect(r.matched).toBe(true);
    expect(r.canonical).toBe("fenix");
  });

  it("should resolve a substring/title form (Praetor Fenix -> fenix)", () => {
    const r = resolveAgentName("Praetor Fenix", AGENTS);
    expect(r.matched).toBe(true);
    expect(r.canonical).toBe("fenix");
  });

  it("should resolve a near-miss within edit distance (kerigan -> kerrigan)", () => {
    const r = resolveAgentName("kerigan", AGENTS);
    expect(r.matched).toBe(true);
    expect(r.canonical).toBe("kerrigan");
  });

  it("should resolve by id when name differs", () => {
    const r = resolveAgentName("toast", [{ id: "toast", name: "greenplace/Toast" }]);
    expect(r.matched).toBe(true);
    expect(r.canonical).toBe("greenplace/Toast");
  });

  it("should NOT match an unknown name and should suggest the closest", () => {
    const r = resolveAgentName("zzzxyzzy", AGENTS);
    expect(r.matched).toBe(false);
    expect(r.canonical).toBeUndefined();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("should return no match for empty input or empty roster", () => {
    expect(resolveAgentName("", AGENTS).matched).toBe(false);
    expect(resolveAgentName("fenix", []).matched).toBe(false);
  });

  it("should not falsely match when two agents are equally near (ambiguous)", () => {
    // "ana" is edit-distance 1 from both "anna" and "anya" → ambiguous, must not pick one
    const r = resolveAgentName("ana", [
      { id: "anna", name: "anna" },
      { id: "anya", name: "anya" },
    ]);
    expect(r.matched).toBe(false);
    expect(r.candidates).toEqual(expect.arrayContaining(["anna", "anya"]));
  });
});

describe("phoneticKey", () => {
  it("should collapse Phoenix and fenix to the same key", () => {
    expect(phoneticKey("Phoenix")).toBe(phoneticKey("fenix"));
  });
});

describe("levenshtein", () => {
  it("should compute basic edit distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("fenix", "fenix")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});
