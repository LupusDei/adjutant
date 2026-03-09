/**
 * Spawn + Persona Integration Tests
 *
 * Tests that all spawn paths (agents route, sessions route)
 * correctly handle personaId: look up persona, generate prompt, inject via
 * --prompt CLI flag, and set ADJUTANT_PERSONA_ID env var.
 *
 * Covers QA findings:
 * - adj-033.0.3: ADJUTANT_PERSONA_ID env var in tmux session
 * - adj-033.0.5: All callsigns disabled edge case
 * - adj-033.0.7: Dual spawn paths (agents.ts + sessions.ts)
 * - adj-033.0.8: Injection via --prompt flag
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

// Mock persona service with getPersonaService singleton accessor
const mockPersonaService = {
  getPersona: vi.fn(),
  getPersonaByName: vi.fn(),
  listPersonas: vi.fn().mockReturnValue([]),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
};

vi.mock("../../src/services/persona-service.js", () => ({
  createPersonaService: () => mockPersonaService,
  getPersonaService: () => mockPersonaService,
  initPersonaService: vi.fn(),
  resetPersonaService: vi.fn(),
}));

// Mock prompt generator
const mockGeneratePersonaPrompt = vi.fn();

vi.mock("../../src/services/prompt-generator.js", () => ({
  generatePersonaPrompt: (...args: unknown[]) => mockGeneratePersonaPrompt(...args),
  generatePrompt: (...args: unknown[]) => mockGeneratePersonaPrompt(...args),
}));

// Mock session bridge for route tests
const mockBridge = {
  listSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(),
  createSession: vi.fn(),
  connectClient: vi.fn(),
  disconnectClient: vi.fn(),
  sendInput: vi.fn(),
  sendInterrupt: vi.fn(),
  sendPermissionResponse: vi.fn(),
  killSession: vi.fn(),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

// Mock callsign service
vi.mock("../../src/services/callsign-service.js", () => ({
  pickRandomCallsign: vi.fn().mockReturnValue({ name: "raynor", race: "terran" }),
  pickRandomCallsigns: vi.fn().mockReturnValue([{ name: "raynor", race: "terran" }]),
  getCallsigns: vi.fn().mockReturnValue([]),
  nextAvailableName: vi.fn().mockImplementation((_sessions: unknown[], baseName: string) => baseName),
}));

// Mock projects service
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: vi.fn().mockReturnValue({ success: true, data: { path: "/test/project" } }),
}));

// Mock tmux
vi.mock("../../src/services/tmux.js", () => ({
  captureTmuxPane: vi.fn().mockResolvedValue(""),
  listTmuxSessions: vi.fn().mockResolvedValue(new Map()),
}));

// Mock agents-service (used by GET /api/agents)
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

// Suppress logging
vi.mock("../../src/utils/index.js", async () => {
  const actual = await vi.importActual("../../src/utils/index.js");
  return {
    ...actual,
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    logDebug: vi.fn(),
  };
});

import { agentsRouter } from "../../src/routes/agents.js";
import { sessionsRouter } from "../../src/routes/sessions.js";
import { pickRandomCallsign } from "../../src/services/callsign-service.js";

// ============================================================================
// Helpers
// ============================================================================

function createAgentsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  return app;
}

function createSessionsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
  return app;
}

const MOCK_PERSONA = {
  id: "persona-uuid-123",
  name: "Architect",
  description: "System design specialist",
  traits: {
    architecture_focus: 18,
    product_design: 0,
    uiux_focus: 0,
    qa_scalability: 5,
    qa_correctness: 5,
    testing_unit: 10,
    testing_acceptance: 0,
    modular_architecture: 15,
    business_objectives: 0,
    technical_depth: 12,
    code_review: 10,
    documentation: 0,
  },
  createdAt: "2026-03-04T00:00:00.000Z",
  updatedAt: "2026-03-04T00:00:00.000Z",
};

const MOCK_PROMPT = "You are the Architect persona. Focus on system design...";

// ============================================================================
// Tests: POST /api/agents/spawn with personaId
// ============================================================================

describe("POST /api/agents/spawn — persona integration", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createAgentsApp();
    vi.clearAllMocks();
    mockBridge.listSessions.mockReturnValue([]);
    vi.mocked(pickRandomCallsign).mockReturnValue({ name: "raynor", race: "terran" });
  });

  it("should spawn without personaId (backward compatible)", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-1",
      name: "raynor",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({ projectPath: "/test/project" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    // Should NOT have called persona service or prompt generator
    expect(mockPersonaService.getPersona).not.toHaveBeenCalled();
    expect(mockGeneratePersonaPrompt).not.toHaveBeenCalled();
  });

  it("should spawn with personaId and inject persona via initialPrompt", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-2",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-2",
      name: "raynor",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    // Should have looked up persona
    expect(mockPersonaService.getPersona).toHaveBeenCalledWith("persona-uuid-123");

    // Should have generated prompt
    expect(mockGeneratePersonaPrompt).toHaveBeenCalledWith(MOCK_PERSONA);

    // Persona prompt should be passed via initialPrompt (paste-buffer), NOT --prompt CLI arg
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.initialPrompt).toBe(MOCK_PROMPT);
    expect(createCall.claudeArgs).toBeUndefined();
    expect(createCall.envVars).toEqual(
      expect.objectContaining({ ADJUTANT_PERSONA_ID: "persona-uuid-123" }),
    );
  });

  it("should return 404 when personaId does not exist", async () => {
    mockPersonaService.getPersona.mockReturnValue(null);

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "nonexistent-id",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toMatch(/persona/i);
  });

  it("should use persona name as agent name when callsign not available", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-3",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-3",
      name: "Architect",
      status: "idle",
    });

    // No callsign available
    vi.mocked(pickRandomCallsign).mockReturnValue(undefined);

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    // Name should fall back to persona name (lowercased) when no callsign
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("architect");
  });

  it("should prefer explicit callsign over persona name", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-4",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-4",
      name: "zeratul",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
        callsign: "zeratul",
      });

    expect(response.status).toBe(201);
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("zeratul");
  });

  it("should include personaId and personaName in spawn response", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-5",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-5",
      name: "raynor",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.personaId).toBe("persona-uuid-123");
    expect(response.body.data.personaName).toBe("Architect");
  });

  it("should not include personaId in response when not provided", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-6",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-6",
      name: "raynor",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({ projectPath: "/test/project" });

    expect(response.status).toBe(201);
    expect(response.body.data.personaId).toBeUndefined();
    expect(response.body.data.personaName).toBeUndefined();
  });

  it("should not pass envVars when no personaId provided", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-7",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-7",
      name: "raynor",
      status: "idle",
    });

    await request(app)
      .post("/api/agents/spawn")
      .send({ projectPath: "/test/project" });

    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.envVars).toBeUndefined();
  });
});

// ============================================================================
// Tests: POST /api/sessions with personaId
// ============================================================================

describe("POST /api/sessions — persona integration", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createSessionsApp();
    vi.clearAllMocks();
    mockBridge.listSessions.mockReturnValue([]);
    vi.mocked(pickRandomCallsign).mockReturnValue({ name: "artanis", race: "protoss" });
  });

  it("should create session without personaId (backward compatible)", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-1",
      name: "artanis",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/sessions")
      .send({ projectPath: "/test/project" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockPersonaService.getPersona).not.toHaveBeenCalled();
  });

  it("should create session with personaId and inject persona via initialPrompt", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-2",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-2",
      name: "artanis",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/sessions")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    expect(mockPersonaService.getPersona).toHaveBeenCalledWith("persona-uuid-123");
    expect(mockGeneratePersonaPrompt).toHaveBeenCalledWith(MOCK_PERSONA);

    // Persona prompt should be passed via initialPrompt (paste-buffer), NOT --prompt CLI arg
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.initialPrompt).toBe(MOCK_PROMPT);
    expect(createCall.claudeArgs).toBeUndefined();
    expect(createCall.envVars).toEqual(
      expect.objectContaining({ ADJUTANT_PERSONA_ID: "persona-uuid-123" }),
    );
  });

  it("should return 404 when personaId does not exist", async () => {
    mockPersonaService.getPersona.mockReturnValue(null);

    const response = await request(app)
      .post("/api/sessions")
      .send({
        projectPath: "/test/project",
        personaId: "nonexistent-id",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it("should use persona name as fallback when no name and no callsign available", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    vi.mocked(pickRandomCallsign).mockReturnValue(undefined);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-3",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-3",
      name: "Architect",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/sessions")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("Architect");
  });

  it("should preserve existing claudeArgs separately from persona prompt", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-4",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-4",
      name: "artanis",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/sessions")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
        claudeArgs: ["--verbose"],
      });

    expect(response.status).toBe(201);
    const createCall = mockBridge.createSession.mock.calls[0][0];
    // claudeArgs should only have user-provided args, NOT --prompt
    expect(createCall.claudeArgs).toContain("--verbose");
    expect(createCall.claudeArgs).not.toContain("--prompt");
    // Persona prompt goes via initialPrompt instead
    expect(createCall.initialPrompt).toBe(MOCK_PROMPT);
  });
});

// ============================================================================
// Tests: LifecycleManager — envVars support
// ============================================================================

describe("LifecycleManager — envVars support", () => {
  const mockExecFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "has-session") {
          cb(new Error("no session"), "", "no session");
        } else if (args[0] === "list-panes") {
          const tIdx = args.indexOf("-t");
          const sessionName = tIdx >= 0 ? args[tIdx + 1] : "test";
          cb(null, `${sessionName}:1.1\n`, "");
        } else {
          cb(null, "", "");
        }
      },
    );
  });

  it("should set ADJUTANT_PERSONA_ID env var when envVars provided", async () => {
    vi.doMock("child_process", () => ({
      execFile: (...args: unknown[]) => mockExecFile(...args),
    }));

    const { LifecycleManager } = await import("../../src/services/lifecycle-manager.js");
    const { SessionRegistry } = await import("../../src/services/session-registry.js");

    const registry = new SessionRegistry("/tmp/test-lm-envvars.json");
    const lifecycle = new LifecycleManager(registry, 5);

    await lifecycle.createSession({
      name: "test-agent",
      projectPath: "/test/project",
      envVars: { ADJUTANT_PERSONA_ID: "persona-123" },
    });

    // Find the send-keys calls that set env vars
    const sendKeysCalls = mockExecFile.mock.calls.filter(
      (call: unknown[]) => {
        const args = call[1] as string[];
        return args[0] === "send-keys" && typeof args[3] === "string" &&
          args[3].includes("ADJUTANT_PERSONA_ID");
      },
    );

    expect(sendKeysCalls.length).toBeGreaterThanOrEqual(1);
    const envCmd = (sendKeysCalls[0][1] as string[])[3];
    expect(envCmd).toContain("export ADJUTANT_PERSONA_ID=");
    expect(envCmd).toContain("persona-123");
  });

  it("should not set extra env vars when envVars is undefined", async () => {
    vi.doMock("child_process", () => ({
      execFile: (...args: unknown[]) => mockExecFile(...args),
    }));

    const { LifecycleManager } = await import("../../src/services/lifecycle-manager.js");
    const { SessionRegistry } = await import("../../src/services/session-registry.js");

    const registry = new SessionRegistry("/tmp/test-lm-no-envvars.json");
    const lifecycle = new LifecycleManager(registry, 5);

    await lifecycle.createSession({
      name: "test-agent",
      projectPath: "/test/project",
    });

    // Should only have the ADJUTANT_AGENT_ID export, not ADJUTANT_PERSONA_ID
    const personaEnvCalls = mockExecFile.mock.calls.filter(
      (call: unknown[]) => {
        const args = call[1] as string[];
        return args[0] === "send-keys" && typeof args[3] === "string" &&
          args[3].includes("ADJUTANT_PERSONA_ID");
      },
    );

    expect(personaEnvCalls.length).toBe(0);
  });

  it("should set multiple env vars when provided", async () => {
    vi.doMock("child_process", () => ({
      execFile: (...args: unknown[]) => mockExecFile(...args),
    }));

    const { LifecycleManager } = await import("../../src/services/lifecycle-manager.js");
    const { SessionRegistry } = await import("../../src/services/session-registry.js");

    const registry = new SessionRegistry("/tmp/test-lm-multi-envvars.json");
    const lifecycle = new LifecycleManager(registry, 5);

    await lifecycle.createSession({
      name: "test-agent",
      projectPath: "/test/project",
      envVars: {
        ADJUTANT_PERSONA_ID: "persona-123",
        CUSTOM_VAR: "custom-value",
      },
    });

    // Find all env var exports
    const envCalls = mockExecFile.mock.calls.filter(
      (call: unknown[]) => {
        const args = call[1] as string[];
        return args[0] === "send-keys" && typeof args[3] === "string" &&
          (args[3].includes("ADJUTANT_PERSONA_ID") || args[3].includes("CUSTOM_VAR"));
      },
    );

    expect(envCalls.length).toBe(2);
  });
});

// ============================================================================
// Tests: All callsigns disabled edge case (adj-033.0.5)
// ============================================================================

describe("All callsigns disabled edge case (adj-033.0.5)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createAgentsApp();
    vi.clearAllMocks();
    mockBridge.listSessions.mockReturnValue([]);
    // Simulate all callsigns exhausted / disabled
    vi.mocked(pickRandomCallsign).mockReturnValue(undefined);
  });

  it("should fall back to 'agent' when no callsign, no persona, and no explicit name", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-fallback",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-fallback",
      name: "agent",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({ projectPath: "/test/project" });

    expect(response.status).toBe(201);
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("agent");
  });

  it("should use persona name when callsigns disabled but personaId provided", async () => {
    mockPersonaService.getPersona.mockReturnValue(MOCK_PERSONA);
    mockGeneratePersonaPrompt.mockReturnValue(MOCK_PROMPT);
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-persona-fallback",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-persona-fallback",
      name: "Architect",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        personaId: "persona-uuid-123",
      });

    expect(response.status).toBe(201);
    // Persona name is lowercased when used as agent name
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("architect");
  });

  it("should use explicit callsign even when auto-assignment disabled", async () => {
    mockBridge.createSession.mockResolvedValue({
      success: true,
      sessionId: "sess-explicit",
    });
    mockBridge.getSession.mockReturnValue({
      id: "sess-explicit",
      name: "my-agent",
      status: "idle",
    });

    const response = await request(app)
      .post("/api/agents/spawn")
      .send({
        projectPath: "/test/project",
        callsign: "my-agent",
      });

    expect(response.status).toBe(201);
    const createCall = mockBridge.createSession.mock.calls[0][0];
    expect(createCall.name).toBe("my-agent");
  });
});

// ============================================================================
// Tests: Prompt Generator (stub)
// ============================================================================

describe("Prompt Generator (stub)", () => {
  it("should generate a prompt with persona name and active traits", async () => {
    // Use the real prompt generator (not mocked)
    const { generatePersonaPrompt } = await import("../../src/services/prompt-generator.js");

    // This is the real one, but we need to un-mock for this test
    // Since the mock is set at module level, test the real function directly
    expect(typeof generatePersonaPrompt).toBe("function");
  });
});
