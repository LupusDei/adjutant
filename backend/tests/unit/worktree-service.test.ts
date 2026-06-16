/**
 * adj-182.5 — worktree-service: provision an isolated git worktree for a spawned agent
 * so its edits never touch the watched canonical checkout (the adj-8mmyd restart loop).
 *
 * All external effects are injected seams — these tests never run git or touch the FS.
 */
import { describe, it, expect, vi } from "vitest";

import { provisionAgentWorktree, removeAgentWorktree } from "../../src/services/worktree-service.js";

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
