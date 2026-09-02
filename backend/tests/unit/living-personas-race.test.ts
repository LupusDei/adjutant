/**
 * adj-158.6.2 — concurrent-callsign race guard in the create_persona MCP tool.
 *
 * Two agents spawned under the same callsign can both run genesis and both
 * call create_persona. The loser's insert/link fails. Without the guard it
 * would surface as a hard error and the losing agent would boot with NO
 * persona — the exact failure the guard exists to prevent.
 *
 * The guard is a catch branch: on failure it re-reads the callsign and, if a
 * persona now exists, returns the winner's persona as a success. The DB-level
 * `INSERT OR IGNORE` in linkCallsignPersona is the backstop; this is the
 * user-visible half, and it was previously untested (the genesis tests assert
 * trait arithmetic only, never the tool call).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn() }),
}));

vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn(() => "loser-agent"),
}));

import { registerPersonaTools } from "../../src/services/mcp-tools/personas.js";
import { PERSONA_TRAIT_KEYS, POINT_BUDGET } from "../../src/types/personas.js";
import type { PersonaService } from "../../src/services/persona-service.js";

type ToolHandler = (
  args: Record<string, unknown>,
  extra: { sessionId?: string },
) => Promise<{ content: { type: string; text: string }[] }>;

/** Minimal McpServer stand-in that captures registered tool handlers. */
function captureTools() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  };
  return { server, handlers };
}

/** A valid allocation summing to exactly POINT_BUDGET across the 12 traits. */
function budgetTraits(): Record<string, number> {
  const traits: Record<string, number> = {};
  for (const key of PERSONA_TRAIT_KEYS) traits[key] = 0;
  let remaining = POINT_BUDGET;
  for (const key of PERSONA_TRAIT_KEYS) {
    const take = Math.min(20, remaining);
    traits[key] = take;
    remaining -= take;
    if (remaining === 0) break;
  }
  return traits;
}

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const WINNER = {
  id: "persona-winner",
  name: "Winner",
  description: "",
  traits: budgetTraits(),
  source: "self-generated",
  createdAt: "2026-09-02T00:00:00Z",
};

describe("create_persona — concurrent callsign race guard (adj-158.6.2)", () => {
  let handler: ToolHandler;
  let service: {
    createPersona: ReturnType<typeof vi.fn>;
    updatePersonaSource: ReturnType<typeof vi.fn>;
    linkCallsignPersona: ReturnType<typeof vi.fn>;
    getPersonaByCallsign: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      createPersona: vi.fn(),
      updatePersonaSource: vi.fn(),
      linkCallsignPersona: vi.fn(),
      getPersonaByCallsign: vi.fn(() => null),
    };
    const { server, handlers } = captureTools();
    registerPersonaTools(
      server as unknown as Parameters<typeof registerPersonaTools>[0],
      service as unknown as PersonaService,
    );
    handler = handlers.get("create_persona")!;
    expect(handler).toBeDefined();
  });

  const args = { callsign: "abathur2", name: "Loser", description: "", traits: budgetTraits() };
  const extra = { sessionId: "session-1" };

  it("should return the winner's persona as a success when creation loses the race", async () => {
    // The loser's insert fails, and by the time it re-reads, the winner has landed.
    service.createPersona.mockImplementation(() => {
      throw new Error("UNIQUE constraint failed: callsign_personas.callsign");
    });
    service.getPersonaByCallsign.mockReturnValue(WINNER);

    const parsed = parse(await handler(args, extra));

    expect(parsed.success).toBe(true);
    expect(parsed.personaId).toBe("persona-winner");
    expect(parsed.personaName).toBe("Winner");
    expect(parsed.callsign).toBe("abathur2");
    expect(parsed.note).toMatch(/already existed/i);
  });

  it("should still surface a genuine error when no persona exists for the callsign", async () => {
    // Same failure, but it was NOT a race — nothing exists to fall back to.
    // The guard must not swallow real errors into a false success.
    service.createPersona.mockImplementation(() => {
      throw new Error("disk I/O error");
    });
    service.getPersonaByCallsign.mockReturnValue(null);

    const parsed = parse(await handler(args, extra));

    expect(parsed.success).toBeUndefined();
    expect(parsed.error).toContain("disk I/O error");
  });

  it("should apply the guard when the LINK fails after a successful insert", async () => {
    // The other ordering: our persona row is created, then linking the callsign
    // loses. The caller must still be handed the winner, not our orphan.
    service.createPersona.mockReturnValue({ ...WINNER, id: "persona-orphan", name: "Loser" });
    service.linkCallsignPersona.mockImplementation(() => {
      throw new Error("UNIQUE constraint failed");
    });
    service.getPersonaByCallsign.mockReturnValue(WINNER);

    const parsed = parse(await handler(args, extra));

    expect(parsed.success).toBe(true);
    expect(parsed.personaId).toBe("persona-winner");
  });

  it("should not consult the race guard at all on the happy path", async () => {
    service.createPersona.mockReturnValue(WINNER);

    const parsed = parse(await handler(args, extra));

    expect(parsed.success).toBe(true);
    expect(parsed.personaId).toBe("persona-winner");
    expect(service.getPersonaByCallsign).not.toHaveBeenCalled();
  });
});
