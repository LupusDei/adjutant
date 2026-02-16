import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StandaloneProvider } from "../../src/services/workspace/standalone-provider.js";

const TEST_DIR = join(tmpdir(), `standalone-provider-test-${Date.now()}`);

describe("StandaloneProvider", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // listBeadsDirs
  // ===========================================================================

  describe("listBeadsDirs", () => {
    it("returns root .beads/ when no sub-projects exist", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].rig).toBeNull();
      expect(dirs[0].workDir).toBe(TEST_DIR);
      expect(dirs[0].path).toBe(join(TEST_DIR, ".beads"));
    });

    it("returns empty array when no .beads/ exists anywhere", async () => {
      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(0);
    });

    it("discovers sub-projects with .beads/beads.db", async () => {
      // Root .beads/
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Sub-project with .beads/beads.db
      mkdirSync(join(TEST_DIR, "frontend", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "frontend", ".beads", "beads.db"), "");

      mkdirSync(join(TEST_DIR, "backend", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "backend", ".beads", "beads.db"), "");

      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(3);

      const root = dirs.find((d) => d.rig === null);
      expect(root).toBeDefined();
      expect(root!.workDir).toBe(TEST_DIR);

      const frontend = dirs.find((d) => d.rig === "frontend");
      expect(frontend).toBeDefined();
      expect(frontend!.workDir).toBe(join(TEST_DIR, "frontend"));
      expect(frontend!.path).toBe(join(TEST_DIR, "frontend", ".beads"));

      const backend = dirs.find((d) => d.rig === "backend");
      expect(backend).toBeDefined();
      expect(backend!.workDir).toBe(join(TEST_DIR, "backend"));
    });

    it("skips sub-dirs without .beads/beads.db", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Has .beads/ but no beads.db
      mkdirSync(join(TEST_DIR, "incomplete", ".beads"), { recursive: true });

      // No .beads/ at all
      mkdirSync(join(TEST_DIR, "plain"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].rig).toBeNull();
    });

    it("skips node_modules, .git, and dotfile directories", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // These should all be skipped even if they have beads.db
      for (const skip of ["node_modules", ".git", ".hidden"]) {
        mkdirSync(join(TEST_DIR, skip, ".beads"), { recursive: true });
        writeFileSync(join(TEST_DIR, skip, ".beads", "beads.db"), "");
      }

      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].rig).toBeNull();
    });

    it("follows .beads/redirect for sub-projects", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Sub-project with redirect
      const subDir = join(TEST_DIR, "myrig");
      const redirectTarget = join(TEST_DIR, "shared-beads");
      mkdirSync(join(subDir, ".beads"), { recursive: true });
      writeFileSync(join(subDir, ".beads", "beads.db"), "");
      writeFileSync(join(subDir, ".beads", "redirect"), redirectTarget);
      mkdirSync(redirectTarget, { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      const rig = dirs.find((d) => d.rig === "myrig");
      expect(rig).toBeDefined();
      expect(rig!.path).toBe(redirectTarget);
      expect(rig!.workDir).toBe(subDir);
    });
  });

  // ===========================================================================
  // listRigNames
  // ===========================================================================

  describe("listRigNames", () => {
    it("returns empty array when no sub-projects exist", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const names = await provider.listRigNames();

      expect(names).toEqual([]);
    });

    it("returns names of discovered sub-projects", async () => {
      mkdirSync(join(TEST_DIR, "alpha", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "alpha", ".beads", "beads.db"), "");

      mkdirSync(join(TEST_DIR, "beta", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "beta", ".beads", "beads.db"), "");

      // This one has no beads.db, should not appear
      mkdirSync(join(TEST_DIR, "gamma", ".beads"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const names = await provider.listRigNames();

      expect(names).toHaveLength(2);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).not.toContain("gamma");
    });

    it("skips dotfile directories", async () => {
      mkdirSync(join(TEST_DIR, ".secret", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, ".secret", ".beads", "beads.db"), "");

      const provider = new StandaloneProvider(TEST_DIR);
      const names = await provider.listRigNames();

      expect(names).toEqual([]);
    });
  });

  // ===========================================================================
  // resolveRigPath
  // ===========================================================================

  describe("resolveRigPath", () => {
    it("returns path for valid sub-project with .beads/", () => {
      mkdirSync(join(TEST_DIR, "myrig", ".beads"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const result = provider.resolveRigPath("myrig");

      expect(result).toBe(join(TEST_DIR, "myrig"));
    });

    it("returns null for directory without .beads/", () => {
      mkdirSync(join(TEST_DIR, "plain"), { recursive: true });

      const provider = new StandaloneProvider(TEST_DIR);
      const result = provider.resolveRigPath("plain");

      expect(result).toBeNull();
    });

    it("returns null for non-existent directory", () => {
      const provider = new StandaloneProvider(TEST_DIR);
      const result = provider.resolveRigPath("nonexistent");

      expect(result).toBeNull();
    });
  });
});
