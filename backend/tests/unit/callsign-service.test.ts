import { describe, it, expect } from "vitest";

import {
  CALLSIGNS,
  getCallsigns,
  pickRandomCallsign,
  pickRandomCallsigns,
  isCallsignAvailable,
  isKnownCallsign,
} from "../../src/services/callsign-service.js";

// ============================================================================
// Helper: build a mock sessions list
// ============================================================================

function mockSessions(
  ...names: string[]
): Array<{ name: string; status: string }> {
  return names.map((name) => ({ name, status: "idle" }));
}

// ============================================================================
// CALLSIGNS roster
// ============================================================================

describe("CALLSIGNS roster", () => {
  it("should contain exactly 44 entries", () => {
    expect(CALLSIGNS).toHaveLength(44);
  });

  it("should have 15 terran, 13 zerg, 16 protoss", () => {
    const terran = CALLSIGNS.filter((c) => c.race === "terran");
    const zerg = CALLSIGNS.filter((c) => c.race === "zerg");
    const protoss = CALLSIGNS.filter((c) => c.race === "protoss");

    expect(terran).toHaveLength(15);
    expect(zerg).toHaveLength(13);
    expect(protoss).toHaveLength(16);
  });

  it("should have all unique names", () => {
    const names = CALLSIGNS.map((c) => c.name);
    expect(new Set(names).size).toBe(44);
  });

  it("should have all lowercase alphanumeric names", () => {
    for (const callsign of CALLSIGNS) {
      expect(callsign.name).toMatch(/^[a-z]+$/);
    }
  });
});

// ============================================================================
// getCallsigns
// ============================================================================

describe("getCallsigns", () => {
  it("should return all 44 as available when no active sessions", () => {
    const result = getCallsigns([]);
    expect(result).toHaveLength(44);
    expect(result.every((c) => c.available)).toBe(true);
  });

  it("should mark active session names as unavailable", () => {
    const result = getCallsigns(mockSessions("raynor", "zeratul"));

    const raynor = result.find((c) => c.name === "raynor");
    const zeratul = result.find((c) => c.name === "zeratul");
    const nova = result.find((c) => c.name === "nova");

    expect(raynor?.available).toBe(false);
    expect(zeratul?.available).toBe(false);
    expect(nova?.available).toBe(true);
  });

  it("should treat offline sessions as available", () => {
    const sessions = [{ name: "raynor", status: "offline" }];
    const result = getCallsigns(sessions);

    const raynor = result.find((c) => c.name === "raynor");
    expect(raynor?.available).toBe(true);
  });

  it("should include race information", () => {
    const result = getCallsigns([]);
    const raynor = result.find((c) => c.name === "raynor");
    const zagara = result.find((c) => c.name === "zagara");
    const artanis = result.find((c) => c.name === "artanis");

    expect(raynor?.race).toBe("terran");
    expect(zagara?.race).toBe("zerg");
    expect(artanis?.race).toBe("protoss");
  });

  it("should ignore non-callsign session names", () => {
    const result = getCallsigns(mockSessions("my-custom-agent"));
    expect(result.every((c) => c.available)).toBe(true);
  });
});

// ============================================================================
// pickRandomCallsign
// ============================================================================

describe("pickRandomCallsign", () => {
  it("should return a callsign entry when names are available", () => {
    const result = pickRandomCallsign([]);
    expect(result).toBeDefined();
    expect(result!.name).toBeTruthy();
    expect(result!.race).toBeTruthy();
  });

  it("should not return an active session name", () => {
    // Take 43 names, leaving only one available
    const taken = CALLSIGNS.slice(0, 43).map((c) => c.name);
    const remaining = CALLSIGNS[43]!;

    const sessions = mockSessions(...taken);
    const result = pickRandomCallsign(sessions);

    expect(result).toBeDefined();
    expect(result!.name).toBe(remaining.name);
  });

  it("should return undefined when all 44 names are taken", () => {
    const allNames = CALLSIGNS.map((c) => c.name);
    const sessions = mockSessions(...allNames);
    const result = pickRandomCallsign(sessions);
    expect(result).toBeUndefined();
  });

  it("should not return offline session names (they are available)", () => {
    // All names offline except one active
    const offlineSessions = CALLSIGNS.slice(0, 43).map((c) => ({
      name: c.name,
      status: "offline",
    }));
    const activeSession = { name: CALLSIGNS[43]!.name, status: "working" };

    const result = pickRandomCallsign([...offlineSessions, activeSession]);
    expect(result).toBeDefined();
    // The result should be one of the offline names (now available), not the active one
    expect(result!.name).not.toBe(CALLSIGNS[43]!.name);
  });
});

// ============================================================================
// pickRandomCallsigns
// ============================================================================

describe("pickRandomCallsigns", () => {
  it("should return requested count of unique callsigns", () => {
    const result = pickRandomCallsigns([], 5);
    expect(result).toHaveLength(5);

    const names = result.map((c) => c.name);
    expect(new Set(names).size).toBe(5);
  });

  it("should not include active session names", () => {
    const sessions = mockSessions("raynor", "zeratul", "artanis");
    const result = pickRandomCallsigns(sessions, 3);

    const names = result.map((c) => c.name);
    expect(names).not.toContain("raynor");
    expect(names).not.toContain("zeratul");
    expect(names).not.toContain("artanis");
  });

  it("should return fewer than requested when not enough available", () => {
    const taken = CALLSIGNS.slice(0, 42).map((c) => c.name);
    const sessions = mockSessions(...taken);

    const result = pickRandomCallsigns(sessions, 5);
    expect(result).toHaveLength(2); // Only 2 remaining
  });

  it("should return empty array when all taken", () => {
    const allNames = CALLSIGNS.map((c) => c.name);
    const sessions = mockSessions(...allNames);
    const result = pickRandomCallsigns(sessions, 3);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// isCallsignAvailable
// ============================================================================

describe("isCallsignAvailable", () => {
  it("should return true for a name not in use", () => {
    expect(isCallsignAvailable([], "raynor")).toBe(true);
  });

  it("should return false for a name in active use", () => {
    expect(isCallsignAvailable(mockSessions("raynor"), "raynor")).toBe(false);
  });

  it("should return true for an offline session name", () => {
    const sessions = [{ name: "raynor", status: "offline" }];
    expect(isCallsignAvailable(sessions, "raynor")).toBe(true);
  });

  it("should return true for non-callsign names", () => {
    expect(isCallsignAvailable([], "my-custom-agent")).toBe(true);
  });
});

// ============================================================================
// isKnownCallsign
// ============================================================================

describe("isKnownCallsign", () => {
  it("should return true for roster names", () => {
    expect(isKnownCallsign("raynor")).toBe(true);
    expect(isKnownCallsign("zeratul")).toBe(true);
    expect(isKnownCallsign("abathur")).toBe(true);
  });

  it("should return false for non-roster names", () => {
    expect(isKnownCallsign("my-agent")).toBe(false);
    expect(isKnownCallsign("agent-1")).toBe(false);
    expect(isKnownCallsign("")).toBe(false);
  });
});
