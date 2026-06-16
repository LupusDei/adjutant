/**
 * adj-182.3.1 (T014a) — worktree Dolt pin: a worktree agent must reach the ONE
 * supervised server on the pinned port and never spawn a stray local Dolt.
 *
 * resolveWorktreeDoltEnv() (1) exports the pinned BEADS_DOLT_SERVER_PORT from the main
 * repo and (2) asserts the worktree has no stray local dolt data-dir. Seams keep these
 * tests off the real filesystem; a couple of real-fs cases pin the symlink-vs-real rule.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveWorktreeDoltEnv } from "../../src/services/worktree-service.js";

describe("resolveWorktreeDoltEnv (adj-182.3.1) — seams", () => {
  it("should export the pinned BEADS_DOLT_SERVER_PORT from the main repo", () => {
    const result = resolveWorktreeDoltEnv("/main", "/main/worktrees/zeratul", {
      readPinnedPort: () => 17000,
      worktreeDataDirIsStray: () => false,
    });

    expect(result.port).toBe(17000);
    expect(result.exportLine).toBe("BEADS_DOLT_SERVER_PORT=17000");
  });

  it("should THROW when the worktree has a stray local dolt data-dir", () => {
    expect(() =>
      resolveWorktreeDoltEnv("/main", "/main/worktrees/zeratul", {
        readPinnedPort: () => 17000,
        worktreeDataDirIsStray: () => true,
      }),
    ).toThrow(/stray dolt data-dir/i);
  });

  it("should THROW when no pinned port is found (would spawn a rogue server)", () => {
    expect(() =>
      resolveWorktreeDoltEnv("/main", "/main/worktrees/zeratul", {
        readPinnedPort: () => null,
        worktreeDataDirIsStray: () => false,
      }),
    ).toThrow(/no pinned dolt port/i);
  });
});

describe("resolveWorktreeDoltEnv (adj-182.3.1) — real-fs stray detection", () => {
  let tmp: string;
  const setup = () => {
    tmp = mkdtempSync(join(tmpdir(), "wt-dolt-"));
  };
  const cleanup = () => {
    rmSync(tmp, { recursive: true, force: true });
  };

  it("should treat a REAL <wt>/.beads/dolt as STRAY (default detector)", () => {
    setup();
    try {
      const main = join(tmp, "main");
      const wt = join(tmp, "wt");
      mkdirSync(join(main, ".beads"), { recursive: true });
      writeFileSync(join(main, ".beads", "dolt-server.port"), "17000", "utf-8");
      mkdirSync(join(wt, ".beads", "dolt"), { recursive: true }); // a real, stray data-dir

      expect(() => resolveWorktreeDoltEnv(main, wt)).toThrow(/stray dolt data-dir/i);
    } finally {
      cleanup();
    }
  });

  it("should treat a SYMLINKED .beads as shared (NOT stray) and read the pinned port", () => {
    setup();
    try {
      const main = join(tmp, "main");
      const wt = join(tmp, "wt");
      mkdirSync(join(main, ".beads", "dolt"), { recursive: true });
      writeFileSync(join(main, ".beads", "dolt-server.port"), "17000", "utf-8");
      mkdirSync(wt, { recursive: true });
      symlinkSync(join(main, ".beads"), join(wt, ".beads")); // shared, the provision-worktree.sh way

      const result = resolveWorktreeDoltEnv(main, wt);
      expect(result.port).toBe(17000);
      expect(result.exportLine).toBe("BEADS_DOLT_SERVER_PORT=17000");
    } finally {
      cleanup();
    }
  });
});
