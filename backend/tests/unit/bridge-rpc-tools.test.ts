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
  it("should declare every read-only whitelist tool PLUS the safe-write command tools (incl. the gated spawn_worker)", () => {
    const names = BRIDGE_RPC_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [...BRIDGE_READONLY_TOOLS, "send_message", "nudge_agent", "answer_question", "create_bead", "spawn_worker"].sort(),
    );
  });

  it("should NOT expose destructive tools (decommission stays out of the toolset)", () => {
    const names = BRIDGE_RPC_TOOLS.map((t) => t.name);
    expect(names).not.toContain("decommission_agent");
  });

  it("should describe read_messages with { agentId, conversationId, limit } for recalling past discussion", () => {
    const read = BRIDGE_RPC_TOOLS.find((t) => t.name === "read_messages");
    expect(read).toBeDefined();
    const paramNames = read!.parameters.map((p) => p.name).sort();
    expect(paramNames).toEqual(["agentId", "conversationId", "limit"]);
    expect(read!.description.toLowerCase()).toMatch(/recall|past|earlier|previous|history/);
  });

  it("should describe spawn_worker with { agentType, project, task, confirm } and require confirmation", () => {
    const spawn = BRIDGE_RPC_TOOLS.find((t) => t.name === "spawn_worker");
    expect(spawn).toBeDefined();
    const paramNames = spawn!.parameters.map((p) => p.name).sort();
    expect(paramNames).toEqual(["agentType", "confirm", "project", "task"]);
    // No project/epic/bead id — at most a project NAME — and a confirm requirement.
    expect(spawn!.description.toLowerCase()).toMatch(/confirm/);
    expect(spawn!.description.toLowerCase()).toMatch(/name/);
  });

  it("should mark every tool as backend_rpc with a description and a Runway-legal timeout (<=8s)", () => {
    for (const tool of BRIDGE_RPC_TOOLS) {
      expect(tool.type).toBe("backend_rpc");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.timeoutSeconds).toBeGreaterThan(0);
      expect(tool.timeoutSeconds).toBeLessThanOrEqual(8); // Runway max
      expect(Array.isArray(tool.parameters)).toBe(true);
    }
  });

  it("should describe send_message with { to, body } and state NO project/epic/bead id is needed", () => {
    const send = BRIDGE_RPC_TOOLS.find((t) => t.name === "send_message");
    expect(send).toBeDefined();
    const paramNames = send!.parameters.map((p) => p.name).sort();
    expect(paramNames).toEqual(["body", "to"]);
    expect(send!.description.toLowerCase()).toMatch(/do not need|don't need|no .*(project|epic|bead)/);
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

  it("should empower GWM-1 to message agents by name without requiring any IDs", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    expect(text).toContain("send_message");
    // Tells the avatar it can direct agents by name...
    expect(text).toMatch(/by name/);
    // ...and that no project/epic/bead id is required.
    expect(text).toMatch(/do not need|don't need|no .*(project|epic|bead) id/);
  });

  it("should name the full safe-write command toolset in the persona", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    for (const tool of ["send_message", "nudge_agent", "answer_question", "create_bead", "spawn_worker"]) {
      expect(text).toContain(tool);
    }
  });

  it("should tell GWM-1 to use read_messages to recall earlier discussion", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    expect(text).toContain("read_messages");
    expect(text).toMatch(/recall|earlier|past|previous|prior/);
  });

  it("should instruct GWM-1 to read back and confirm before spawning, and forbid decommission", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    expect(text).toContain("spawn_worker");
    expect(text).toContain("confirm");
    // The persona must tell the model to read back the plan before spawning.
    expect(text).toMatch(/read back|read-back/);
    // Decommission / destroying agents stays explicitly off the table.
    expect(text).toMatch(/decommission|destroy/);
  });

  it("should carve spawn_worker OUT of the act-decisively doctrine (adj-202.5.3 P1)", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    // The "act decisively without asking permission" doctrine must NOT apply to spawn_worker —
    // it has to be paired with an explicit exception/exclusion naming spawn_worker.
    expect(text).toMatch(/act decisively/);
    expect(text).toMatch(/spawn_worker[^.]*\b(except|exception|not|never)\b|\b(except|exception|not|never)\b[^.]*spawn_worker/);
  });

  it("should require stating role, project, and task/bead and WAITING for an explicit affirmative (adj-202.5.3 P1)", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    // The read-back must enumerate what will be spawned: role/persona, target project, the task/bead.
    expect(text).toMatch(/role|persona/);
    expect(text).toMatch(/project/);
    expect(text).toMatch(/task|bead/);
    // And it must WAIT for an explicit affirmative before firing (not just "confirm" generically).
    expect(text).toMatch(/wait/);
    expect(text).toMatch(/explicit/);
  });

  it("should forbid treating ambiguous musing as assent (adj-202.5.3 P1)", () => {
    const text = BRIDGE_RPC_PERSONALITY.toLowerCase();
    // Must explicitly say ambiguous/musing/"maybe" is NOT a go.
    expect(text).toMatch(/ambiguous|musing|maybe|thinking out loud/);
    expect(text).toMatch(/not (a |an )?(assent|yes|confirmation|go|affirmative)|do not (treat|count|take)|never (treat|count|take)/);
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
