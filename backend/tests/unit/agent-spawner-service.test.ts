import { describe, it, expect, vi, beforeEach } from "vitest";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock node:fs/promises for constitution reading
const mockReadFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock session bridge
const mockBridgeCreateSession = vi.fn();
const mockDiscoverSessions = vi.fn();
const mockRegistrySave = vi.fn();
const mockFindByTmuxSession = vi.fn();
const mockExportEnvVars = vi.fn();
const mockLifecycle = { discoverSessions: mockDiscoverSessions, exportEnvVars: mockExportEnvVars };
const mockRegistry = {
  findByTmuxSession: mockFindByTmuxSession,
  save: mockRegistrySave,
};
const mockBridge = {
  lifecycle: mockLifecycle,
  registry: mockRegistry,
  createSession: mockBridgeCreateSession,
  init: vi.fn(),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

// Mock tmux
const mockListTmuxSessions = vi.fn();
vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: () => mockListTmuxSessions(),
}));

// Mock persona service
const mockGetPersonaByCallsign = vi.fn();
vi.mock("../../src/services/persona-service.js", () => ({
  getPersonaService: () => ({
    getPersonaByCallsign: mockGetPersonaByCallsign,
  }),
}));

import {
  spawnAgent,
  isAgentAlive,
  getAgentTmuxSession,
  readProjectConstitution,
  formatConstitutionPrompt,
  CONSTITUTION_LABEL,
} from "../../src/services/agent-spawner-service.js";

import { logInfo, logWarn } from "../../src/utils/index.js";

describe("agent-spawner-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getAgentTmuxSession
  // ==========================================================================

  describe("getAgentTmuxSession", () => {
    it("should compute correct session name", () => {
      expect(getAgentTmuxSession("foo")).toBe("adj-swarm-foo");
    });

    it("should handle multi-word names", () => {
      expect(getAgentTmuxSession("adjutant-coordinator")).toBe(
        "adj-swarm-adjutant-coordinator"
      );
    });
  });

  // ==========================================================================
  // spawnAgent
  // ==========================================================================

  describe("spawnAgent", () => {
    it("should spawn agent via session bridge createSession", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledOnce();
      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-agent",
          projectPath: "/tmp/project",
          mode: "swarm",
        })
      );
    });

    it("should return success with sessionId on successful spawn", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "session-123",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("session-123");
      expect(result.tmuxSession).toBe("adj-swarm-test-agent");
    });

    it("should skip spawn if tmux session already exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
    });

    it("should re-export persona env var on respawn when persona exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });
      mockGetPersonaByCallsign.mockReturnValue({ id: "persona-123", name: "Test Persona" });
      mockExportEnvVars.mockResolvedValue(undefined);

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(mockExportEnvVars).toHaveBeenCalledWith(
        "adj-swarm-test-agent",
        expect.objectContaining({ ADJUTANT_PERSONA_ID: "persona-123" })
      );
    });

    it("should not call exportEnvVars on respawn when no persona and no env vars", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });
      mockGetPersonaByCallsign.mockReturnValue(undefined);

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(mockExportEnvVars).not.toHaveBeenCalled();
    });

    it("should use caller-provided ADJUTANT_PERSONA_ID over auto-resolved persona", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });
      // Persona service would return a different ID
      mockGetPersonaByCallsign.mockReturnValue({ id: "auto-456", name: "Auto" });
      mockExportEnvVars.mockResolvedValue(undefined);

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        envVars: { ADJUTANT_PERSONA_ID: "explicit-789" },
      });

      expect(result.success).toBe(true);
      expect(mockExportEnvVars).toHaveBeenCalledWith(
        "adj-swarm-test-agent",
        expect.objectContaining({ ADJUTANT_PERSONA_ID: "explicit-789" })
      );
      // Should NOT have been overridden by the auto-resolved persona
      const envVarArg = mockExportEnvVars.mock.calls[0][1] as Record<string, string>;
      expect(envVarArg.ADJUTANT_PERSONA_ID).toBe("explicit-789");
    });

    it("should re-register orphaned session via discoverSessions", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent"])
      );
      // First call: not in registry. Second call (after discover): found.
      const rediscovered = {
        name: "adj-swarm-test-agent",
        projectPath: ".",
      };
      mockFindByTmuxSession
        .mockReturnValueOnce(undefined) // Before discover
        .mockReturnValueOnce(rediscovered); // After discover
      mockDiscoverSessions.mockResolvedValue(["s1"]);
      mockRegistrySave.mockResolvedValue(undefined);

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(mockDiscoverSessions).toHaveBeenCalledWith(
        "adj-swarm-test-agent"
      );
      expect(rediscovered.name).toBe("test-agent");
      expect(rediscovered.projectPath).toBe("/tmp/project");
      expect(mockRegistrySave).toHaveBeenCalled();
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should include --agent flag when agentFile provided", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "myagent",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          claudeArgs: expect.arrayContaining(["--agent", "myagent"]),
        })
      );
    });

    it("should not include --agent flag when agentFile omitted", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      // claudeArgs should either not exist or not contain "--agent"
      if (callArgs.claudeArgs) {
        expect(callArgs.claudeArgs).not.toContain("--agent");
      }
    });

    it("should merge additional claudeArgs with --agent flag", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "myagent",
        claudeArgs: ["--verbose"],
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      expect(callArgs.claudeArgs).toContain("--agent");
      expect(callArgs.claudeArgs).toContain("myagent");
      expect(callArgs.claudeArgs).toContain("--verbose");
    });

    it("should return error on spawn failure", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: false,
        error: "session limit reached",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("session limit reached");
    });

    it("should never throw", async () => {
      // Mock everything to throw
      mockListTmuxSessions.mockRejectedValue(new Error("tmux died"));

      // Also make bridge throw if reached
      mockBridgeCreateSession.mockRejectedValue(
        new Error("bridge exploded")
      );

      // Should not throw
      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should use 'swarm' as default mode", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "swarm" })
      );
    });

    it("should pass custom mode through to createSession", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        mode: "standalone",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "standalone" })
      );
    });

    it("should log spawn info on success", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(logInfo).toHaveBeenCalledWith(
        "Agent spawned",
        expect.objectContaining({ name: "test-agent", sessionId: "s1" })
      );
    });

    it("should log warning on spawn failure", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: false,
        error: "limit exceeded",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(logWarn).toHaveBeenCalledWith(
        "Agent spawn failed",
        expect.objectContaining({ name: "test-agent", error: "limit exceeded" })
      );
    });
  });

  // ==========================================================================
  // readProjectConstitution
  // ==========================================================================

  describe("readProjectConstitution", () => {
    it("should return file content when constitution.md exists", async () => {
      mockReadFile.mockResolvedValue("# Project Constitution v1.0.0\n\n## 1. Test-First\nWrite tests first.\n");

      const result = await readProjectConstitution("/tmp/project");

      expect(result).toBe("# Project Constitution v1.0.0\n\n## 1. Test-First\nWrite tests first.");
      expect(mockReadFile).toHaveBeenCalledWith(
        "/tmp/project/constitution.md",
        "utf-8",
      );
    });

    it("should return undefined when constitution.md does not exist", async () => {
      mockReadFile.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await readProjectConstitution("/tmp/project");

      expect(result).toBeUndefined();
    });

    it("should return undefined when file is empty", async () => {
      mockReadFile.mockResolvedValue("   \n  ");

      const result = await readProjectConstitution("/tmp/project");

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // formatConstitutionPrompt
  // ==========================================================================

  describe("formatConstitutionPrompt", () => {
    it("should wrap constitution text with the mandatory label", () => {
      const result = formatConstitutionPrompt("## 1. Test-First\nWrite tests first.");

      expect(result).toContain(CONSTITUTION_LABEL);
      expect(result).toContain("## 1. Test-First\nWrite tests first.");
      expect(result).toBe(`${CONSTITUTION_LABEL}\n\n## 1. Test-First\nWrite tests first.`);
    });

    it("should return undefined when constitution text is undefined", () => {
      const result = formatConstitutionPrompt(undefined);

      expect(result).toBeUndefined();
    });

    it("should return undefined when constitution text is empty string", () => {
      const result = formatConstitutionPrompt("");

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // spawnAgent — constitution injection
  // ==========================================================================

  describe("spawnAgent — constitution injection", () => {
    it("should inject constitution into spawn prompt when file exists", async () => {
      mockReadFile.mockResolvedValue("## 1. Test-First\nWrite tests first.");
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });
      // Has a persona so genesis path is skipped
      mockGetPersonaByCallsign.mockReturnValue({ id: "p1", name: "Test" });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        initialPrompt: "Do the work",
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      expect(callArgs.initialPrompt).toContain(CONSTITUTION_LABEL);
      expect(callArgs.initialPrompt).toContain("## 1. Test-First");
      // Constitution should come BEFORE the task prompt
      const constitutionIdx = callArgs.initialPrompt.indexOf(CONSTITUTION_LABEL);
      const taskIdx = callArgs.initialPrompt.indexOf("Do the work");
      expect(constitutionIdx).toBeLessThan(taskIdx);
    });

    it("should proceed without constitution when file is missing", async () => {
      mockReadFile.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });
      mockGetPersonaByCallsign.mockReturnValue({ id: "p1", name: "Test" });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        initialPrompt: "Do the work",
      });

      expect(result.success).toBe(true);
      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      expect(callArgs.initialPrompt).toBe("Do the work");
      expect(callArgs.initialPrompt).not.toContain(CONSTITUTION_LABEL);
    });

    it("should use constitution as sole prompt when no initial prompt given", async () => {
      mockReadFile.mockResolvedValue("## 1. Rules");
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });
      // Provide agent file so genesis is skipped and no initial prompt is generated
      mockGetPersonaByCallsign.mockReturnValue({ id: "p1", name: "Test" });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "myagent",
        // No initialPrompt
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      // With agentFile and no initialPrompt, constitution should still be injected
      expect(callArgs.initialPrompt).toContain(CONSTITUTION_LABEL);
      expect(callArgs.initialPrompt).toContain("## 1. Rules");
    });

    it("should place constitution before genesis prompt for persona-less agents", async () => {
      mockReadFile.mockResolvedValue("## 1. Rules");
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });
      // No persona → genesis prompt will be generated
      mockGetPersonaByCallsign.mockReturnValue(undefined);

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        initialPrompt: "Your task is X",
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      // Constitution should be at the very beginning
      expect(callArgs.initialPrompt).toMatch(new RegExp(`^${CONSTITUTION_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });
  });

  // ==========================================================================
  // isAgentAlive
  // ==========================================================================

  describe("isAgentAlive", () => {
    it("should return true when session exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(true);
    });

    it("should return false when session missing", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-other"])
      );

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });

    it("should return false when no tmux sessions exist", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });

    it("should return false when listTmuxSessions fails", async () => {
      mockListTmuxSessions.mockRejectedValue(new Error("tmux not running"));

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });
  });
});
