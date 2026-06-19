/**
 * adj-182.5 — worktree-service: provision an isolated git worktree for a spawned agent
 * so its edits never touch the watched canonical checkout (the adj-8mmyd restart loop).
 *
 * All external effects are injected seams — these tests never run git or touch the FS.
 */
import { describe, it, expect, vi } from "vitest";

import {
  provisionAgentWorktree,
  removeAgentWorktree,
  buildWorktreeMcpConfig,
  writeWorktreeMcpIdentity,
} from "../../src/services/worktree-service.js";

describe("worktree-service — provisionAgentWorktree (adj-182.5)", () => {
  it("should `git worktree add` a new worktree and return its path when none exists", async () => {
    const exec = vi.fn(async () => "");
    const provisionDeps = vi.fn(async () => {});
    const exists = vi.fn(() => false);

    const result = await provisionAgentWorktree("/repo", "zeratul", { exec, exists, provisionDeps });

    expect(result).toBe("/repo/worktrees/zeratul");
    // Created on a dedicated branch, rooted at worktrees/<name>, run in the project dir.
    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, cwd] = exec.mock.calls[0] as [string, string[], string];
    expect(cmd).toBe("git");
    expect(args).toEqual(["worktree", "add", "-b", "agent/zeratul", "worktrees/zeratul"]);
    expect(cwd).toBe("/repo");
    expect(provisionDeps).toHaveBeenCalledWith("/repo/worktrees/zeratul", "/repo");
  });

  it("should REUSE an existing worktree (idempotent re-spawn) without `git worktree add`", async () => {
    const exec = vi.fn(async () => "");
    const provisionDeps = vi.fn(async () => {});
    const exists = vi.fn(() => true); // worktree dir already present

    const result = await provisionAgentWorktree("/repo", "zeratul", { exec, exists, provisionDeps });

    expect(result).toBe("/repo/worktrees/zeratul");
    expect(exec).not.toHaveBeenCalled(); // no re-creation
    expect(provisionDeps).toHaveBeenCalledTimes(1); // deps still ensured
  });

  it("should return null (fail-open) when `git worktree add` fails — never throw", async () => {
    const exec = vi.fn(async () => {
      throw new Error("fatal: a branch named 'agent/zeratul' already exists");
    });
    const exists = vi.fn(() => false);

    const result = await provisionAgentWorktree("/repo", "zeratul", { exec, exists });

    // null signals the caller to fall back to the canonical checkout (with a warn),
    // rather than blocking the whole spawn.
    expect(result).toBeNull();
  });

  it("should honor a custom branch prefix", async () => {
    const exec = vi.fn(async () => "");
    const exists = vi.fn(() => false);

    await provisionAgentWorktree("/repo", "kerrigan", {
      exec,
      exists,
      provisionDeps: async () => {},
      branchPrefix: "wt",
    });

    const [, args] = exec.mock.calls[0] as [string, string[]];
    expect(args).toContain("wt/kerrigan");
  });
});

describe("worktree-service — removeAgentWorktree (adj-182.5)", () => {
  it("should `git worktree remove --force` and never throw on failure", async () => {
    const exec = vi.fn(async () => "");
    await removeAgentWorktree("/repo", "zeratul", { exec });
    expect(exec).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "worktrees/zeratul", "--force"],
      "/repo",
    );

    const failing = vi.fn(async () => {
      throw new Error("not a worktree");
    });
    await expect(removeAgentWorktree("/repo", "ghost", { exec: failing })).resolves.toBeUndefined();
  });
});

describe("worktree-service — worktree MCP identity (adj-vevei)", () => {
  describe("buildWorktreeMcpConfig", () => {
    it("should pin X-Agent-Id to the LITERAL callsign (no ${...} interpolation)", () => {
      const out = JSON.parse(buildWorktreeMcpConfig("alarak", "/p/worktrees/alarak", null));
      const adj = out.mcpServers.adjutant;
      expect(adj.headers["X-Agent-Id"]).toBe("alarak");
      expect(adj.headers["X-Agent-Id"]).not.toContain("${");
    });

    it("should set X-Project-Root to the literal worktree path", () => {
      const out = JSON.parse(buildWorktreeMcpConfig("alarak", "/p/worktrees/alarak", null));
      expect(out.mcpServers.adjutant.headers["X-Project-Root"]).toBe("/p/worktrees/alarak");
    });

    it("should mirror the source project's url/type instead of hardcoding", () => {
      const source = JSON.stringify({
        mcpServers: { adjutant: { type: "http", url: "https://tunnel.example/mcp" } },
      });
      const out = JSON.parse(buildWorktreeMcpConfig("fenix", "/p/worktrees/fenix", source));
      expect(out.mcpServers.adjutant.url).toBe("https://tunnel.example/mcp");
    });

    it("should fall back to the default dashboard url when source is null or malformed", () => {
      const fromNull = JSON.parse(buildWorktreeMcpConfig("nova", "/p/worktrees/nova", null));
      const fromBad = JSON.parse(buildWorktreeMcpConfig("nova", "/p/worktrees/nova", "{not json"));
      expect(fromNull.mcpServers.adjutant.url).toBe("http://localhost:4201/mcp");
      expect(fromBad.mcpServers.adjutant.url).toBe("http://localhost:4201/mcp");
    });
  });

  describe("writeWorktreeMcpIdentity", () => {
    it("should write a literal-callsign .mcp.json when the worktree has none", () => {
      const writeFile = vi.fn();
      const ensureExcluded = vi.fn();
      writeWorktreeMcpIdentity("/p/worktrees/kerrigan", "kerrigan", "/p", {
        exists: () => false,
        readFile: () => null,
        writeFile,
        ensureExcluded,
      });
      expect(writeFile).toHaveBeenCalledTimes(1);
      const [path, content] = writeFile.mock.calls[0] as [string, string];
      expect(path).toBe("/p/worktrees/kerrigan/.mcp.json");
      expect(JSON.parse(content).mcpServers.adjutant.headers["X-Agent-Id"]).toBe("kerrigan");
      expect(ensureExcluded).toHaveBeenCalledWith("/p/worktrees/kerrigan", ".mcp.json");
    });

    it("should be IDEMPOTENT — never clobber an existing worktree .mcp.json", () => {
      const writeFile = vi.fn();
      writeWorktreeMcpIdentity("/p/worktrees/kerrigan", "kerrigan", "/p", {
        exists: () => true, // worktree file already present (hand-tuned or prior spawn)
        writeFile,
        ensureExcluded: vi.fn(),
      });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("should derive url from the project's root .mcp.json when present", () => {
      const writeFile = vi.fn();
      const readFile = vi.fn(() =>
        JSON.stringify({ mcpServers: { adjutant: { type: "http", url: "http://localhost:9999/mcp" } } }),
      );
      writeWorktreeMcpIdentity("/p/worktrees/nick", "nick", "/p", {
        exists: () => false,
        readFile,
        writeFile,
        ensureExcluded: vi.fn(),
      });
      expect(readFile).toHaveBeenCalledWith("/p/.mcp.json");
      const content = (writeFile.mock.calls[0] as [string, string])[1];
      expect(JSON.parse(content).mcpServers.adjutant.url).toBe("http://localhost:9999/mcp");
    });
  });

  describe("provisionAgentWorktree wires identity", () => {
    it("should write the MCP identity on a freshly created worktree", async () => {
      const writeMcpIdentity = vi.fn();
      await provisionAgentWorktree("/repo", "alarak", {
        exec: vi.fn(async () => ""),
        exists: () => false,
        provisionDeps: vi.fn(async () => {}),
        writeMcpIdentity,
      });
      expect(writeMcpIdentity).toHaveBeenCalledWith("/repo/worktrees/alarak", "alarak", "/repo");
    });

    it("should write the MCP identity on a REUSED worktree too (backfills old worktrees)", async () => {
      const writeMcpIdentity = vi.fn();
      await provisionAgentWorktree("/repo", "alarak", {
        exec: vi.fn(async () => ""),
        exists: () => true, // reuse path
        provisionDeps: vi.fn(async () => {}),
        writeMcpIdentity,
      });
      expect(writeMcpIdentity).toHaveBeenCalledWith("/repo/worktrees/alarak", "alarak", "/repo");
    });
  });
});
