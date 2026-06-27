/**
 * Tests for the Bridge RPC tool descriptors (adj-202.7).
 *
 * These are the `backend_rpc` tool definitions handed to Runway at session-create
 * so GWM-1 knows the read-only fleet tools exist and can CALL them mid-conversation
 * (instead of stalling on "querying…"). The descriptors must mirror the read-only
 * whitelist exactly — every callable tool, no write tools — and the personality
 * must tell the model the tools exist and to narrate the structured result.
 */

import { describe, it, expect } from "vitest";

import { BRIDGE_READONLY_TOOLS } from "../../src/services/bridge-tool-bridge.js";
import {
  BRIDGE_RPC_TOOLS,
  BRIDGE_RPC_PERSONALITY,
  composeBridgePersonality,
} from "../../src/services/bridge-rpc-tools.js";

describe("BRIDGE_RPC_TOOLS descriptors", () => {
  it("should declare exactly one backend_rpc tool per read-only whitelist entry", () => {
    const names = BRIDGE_RPC_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...BRIDGE_READONLY_TOOLS].sort());
  });

  it("should mark every tool as backend_rpc with a description and a timeout (model-callable shape)", () => {
    for (const tool of BRIDGE_RPC_TOOLS) {
      expect(tool.type).toBe("backend_rpc");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.timeoutSeconds).toBeGreaterThan(0);
      expect(Array.isArray(tool.parameters)).toBe(true);
    }
  });

  it("should NOT expose a projectId parameter (it is injected server-side from session context)", () => {
    for (const tool of BRIDGE_RPC_TOOLS) {
      const paramNames = tool.parameters.map((p) => p.name);
      expect(paramNames).not.toContain("projectId");
    }
  });

  it("should give every declared parameter a name, type, and description", () => {
    for (const tool of BRIDGE_RPC_TOOLS) {
      for (const p of tool.parameters) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.type.length).toBeGreaterThan(0);
        expect(p.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("composeBridgePersonality", () => {
  it("should reference the read-only fleet tools so GWM-1 knows to call them", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    // Must name at least the roster tool the acceptance test exercises.
    expect(text).toContain("list_agents");
    // Must instruct the model to call tools rather than stall, and to ground its
    // answer in the returned data.
    expect(text).toMatch(/call|use/);
  });

  it("should append the tool guidance to a supplied base personality", () => {
    const base = "You are the Adjutant. Address the user as Commander.";
    const composed = composeBridgePersonality(base);
    expect(composed.startsWith(base)).toBe(true);
    expect(composed).toContain("list_agents");
  });

  it("should fall back to the default personality when no base is supplied", () => {
    expect(composeBridgePersonality()).toBe(BRIDGE_RPC_PERSONALITY);
    expect(composeBridgePersonality(undefined)).toBe(BRIDGE_RPC_PERSONALITY);
    expect(composeBridgePersonality("")).toBe(BRIDGE_RPC_PERSONALITY);
  });
});
