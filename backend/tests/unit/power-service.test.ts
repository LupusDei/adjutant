import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/services/agent-data.js", () => ({
  collectAgentSnapshot: vi.fn(),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  resolveGtBinary: vi.fn(() => "gt"),
  loadTownConfig: vi.fn(),
  listRigNames: vi.fn(),
}));

vi.mock("../../src/services/gt-control.js", () => ({
  execGtControl: vi.fn(),
}));

import { collectAgentSnapshot } from "../../src/services/agent-data.js";
import { loadTownConfig, listRigNames } from "../../src/services/gastown-workspace.js";
import { execGtControl } from "../../src/services/gt-control.js";
import { getStatus, powerDown, powerUp } from "../../src/services/power-service.js";
import type { AgentRuntimeInfo } from "../../src/services/agent-data.js";

function createAgent(overrides: Partial<AgentRuntimeInfo>): AgentRuntimeInfo {
  return {
    id: "hq-mayor",
    name: "mayor",
    role: "mayor",
    rig: null,
    address: "mayor/",
    sessionName: "hq-mayor",
    running: false,
    unreadMail: 0,
    ...overrides,
  };
}

describe("power-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTownConfig).mockResolvedValue({
      name: "gastown",
      owner: { name: "operator", email: "operator@gastown.local" },
    });
    vi.mocked(listRigNames).mockResolvedValue(["rig-a"]);
  });

  describe("getStatus", () => {
    it("returns running when mayor session is active", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: true })],
        mailIndex: new Map([["overseer", { unread: 2 }]]),
      });

      const result = await getStatus();

      expect(result.success).toBe(true);
      expect(result.data?.powerState).toBe("running");
      expect(result.data?.operator.unreadMail).toBe(2);
    });

    it("returns stopped when mayor is offline", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: false })],
        mailIndex: new Map(),
      });

      const result = await getStatus();

      expect(result.success).toBe(true);
      expect(result.data?.powerState).toBe("stopped");
    });
  });

  describe("powerUp", () => {
    it("returns ALREADY_RUNNING when running", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: true })],
        mailIndex: new Map(),
      });

      const result = await powerUp();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ALREADY_RUNNING");
      expect(execGtControl).not.toHaveBeenCalled();
    });

    it("invokes gt up when stopped", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: false })],
        mailIndex: new Map(),
      });
      vi.mocked(execGtControl).mockResolvedValue({
        success: true,
        data: "ok",
        exitCode: 0,
      });

      const result = await powerUp();

      expect(result.success).toBe(true);
      expect(execGtControl).toHaveBeenCalledWith(["up"], expect.any(Object));
    });
  });

  describe("powerDown", () => {
    it("returns ALREADY_STOPPED when stopped", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: false })],
        mailIndex: new Map(),
      });

      const result = await powerDown();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("ALREADY_STOPPED");
      expect(execGtControl).not.toHaveBeenCalled();
    });

    it("invokes gt down when running", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [createAgent({ running: true })],
        mailIndex: new Map(),
      });
      vi.mocked(execGtControl).mockResolvedValue({
        success: true,
        data: "ok",
        exitCode: 0,
      });

      const result = await powerDown();

      expect(result.success).toBe(true);
      expect(execGtControl).toHaveBeenCalledWith(["down"], expect.any(Object));
    });
  });
});
