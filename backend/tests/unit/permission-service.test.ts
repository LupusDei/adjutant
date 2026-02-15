import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock event bus
const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

// Mock fs (avoid real file I/O in tests)
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

import {
  initPermissionService,
  getPermissionConfig,
  updatePermissionConfig,
  getEffectiveMode,
  processOutputLine,
  onPermission,
  resetPermissionService,
  type PermissionEvent,
} from "../../src/services/permission-service.js";

describe("permission-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPermissionService();
    initPermissionService("/tmp/test-adjutant");
  });

  // ==========================================================================
  // Config
  // ==========================================================================

  describe("config", () => {
    it("should have manual as default mode", () => {
      const config = getPermissionConfig();
      expect(config.defaultMode).toBe("manual");
      expect(config.sessions).toEqual({});
      expect(config.toolOverrides).toEqual({});
    });

    it("should update default mode", () => {
      const updated = updatePermissionConfig({ defaultMode: "auto_accept" });
      expect(updated.defaultMode).toBe("auto_accept");
    });

    it("should update per-session overrides", () => {
      updatePermissionConfig({
        sessions: { "sess-1": "auto_accept", "sess-2": "auto_deny" },
      });
      const config = getPermissionConfig();
      expect(config.sessions["sess-1"]).toBe("auto_accept");
      expect(config.sessions["sess-2"]).toBe("auto_deny");
    });

    it("should update tool overrides", () => {
      updatePermissionConfig({
        toolOverrides: { Read: "auto_accept", Bash: "manual" },
      });
      const config = getPermissionConfig();
      expect(config.toolOverrides["Read"]).toBe("auto_accept");
      expect(config.toolOverrides["Bash"]).toBe("manual");
    });
  });

  // ==========================================================================
  // getEffectiveMode
  // ==========================================================================

  describe("getEffectiveMode", () => {
    it("should return default mode for unknown session", () => {
      expect(getEffectiveMode("unknown-session")).toBe("manual");
    });

    it("should return session override when set", () => {
      updatePermissionConfig({ sessions: { "sess-1": "auto_accept" } });
      expect(getEffectiveMode("sess-1")).toBe("auto_accept");
    });

    it("should prioritize tool override over session override", () => {
      updatePermissionConfig({
        sessions: { "sess-1": "auto_deny" },
        toolOverrides: { Read: "auto_accept" },
      });
      expect(getEffectiveMode("sess-1", "Read")).toBe("auto_accept");
    });

    it("should fall through to session when no tool override", () => {
      updatePermissionConfig({
        sessions: { "sess-1": "auto_deny" },
        toolOverrides: { Read: "auto_accept" },
      });
      expect(getEffectiveMode("sess-1", "Bash")).toBe("auto_deny");
    });
  });

  // ==========================================================================
  // processOutputLine — permission detection + handling
  // ==========================================================================

  describe("processOutputLine", () => {
    it("should detect permission prompt and route to manual", () => {
      const { events, permissionHandled } = processOutputLine(
        "sess-1",
        "Do you want to allow Read file.txt?"
      );

      expect(permissionHandled).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("permission_request");
      expect(mockEmit).toHaveBeenCalledWith(
        "session:permission",
        expect.objectContaining({
          sessionId: "sess-1",
        })
      );
    });

    it("should auto-accept when session is configured", () => {
      updatePermissionConfig({ sessions: { "sess-1": "auto_accept" } });

      const received: PermissionEvent[] = [];
      onPermission((e) => received.push(e));

      const { permissionHandled } = processOutputLine(
        "sess-1",
        "Do you want to allow Bash execute ls?"
      );

      expect(permissionHandled).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0].autoHandled).toBe(true);
      expect(received[0].response).toBe("approved");
    });

    it("should auto-deny when session is configured", () => {
      updatePermissionConfig({ sessions: { "sess-1": "auto_deny" } });

      const received: PermissionEvent[] = [];
      onPermission((e) => received.push(e));

      const { permissionHandled } = processOutputLine(
        "sess-1",
        "Do you want to allow Write sensitive-file?"
      );

      expect(permissionHandled).toBe(true);
      expect(received[0].response).toBe("denied");
    });

    it("should pass through non-permission output without handling", () => {
      const { events, permissionHandled } = processOutputLine(
        "sess-1",
        "⏺ Read(foo.txt)"
      );

      expect(permissionHandled).toBe(false);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("tool_use");
    });

    it("should maintain separate parsers per session", () => {
      // Session 1 gets a tool use
      processOutputLine("sess-1", "⏺ Read(foo.txt)");
      // Session 2 gets a different tool use
      const { events } = processOutputLine("sess-2", "⏺ Bash(ls)");

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("tool_use");
      expect((events[0] as { tool: string }).tool).toBe("Bash");
    });
  });
});
