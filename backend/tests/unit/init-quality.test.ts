import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { scaffoldQualityFiles } from "../../../cli/commands/init.js";
import { QUALITY_FILES } from "../../../cli/lib/quality-templates.js";

/** Create a unique temp directory for each test. */
function makeTempDir(): string {
  const dir = join(tmpdir(), `adjutant-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scaffoldQualityFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create all 5 quality files on fresh init", () => {
    const results = scaffoldQualityFiles(tempDir, false);

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.status).toBe("created");
    }

    // Verify all files actually exist on disk
    for (const qf of QUALITY_FILES) {
      const fullPath = join(tempDir, qf.destPath);
      expect(existsSync(fullPath), `File should exist: ${qf.destPath}`).toBe(true);

      // Verify content is non-empty
      const content = readFileSync(fullPath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("should skip existing files when re-running init without force", () => {
    // First run — creates all files
    scaffoldQualityFiles(tempDir, false);

    // Record file contents after first run
    const originalContents: Record<string, string> = {};
    for (const qf of QUALITY_FILES) {
      originalContents[qf.destPath] = readFileSync(join(tempDir, qf.destPath), "utf-8");
    }

    // Modify one file so we can detect if it gets overwritten
    const testingPath = join(tempDir, ".claude/rules/03-testing.md");
    writeFileSync(testingPath, "MODIFIED CONTENT", "utf-8");

    // Second run — should skip all
    const results = scaffoldQualityFiles(tempDir, false);

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.status).toBe("skipped");
    }

    // Verify the modified file was NOT overwritten
    expect(readFileSync(testingPath, "utf-8")).toBe("MODIFIED CONTENT");
  });

  it("should overwrite existing files when force=true", () => {
    // First run — creates all files
    scaffoldQualityFiles(tempDir, false);

    // Modify a non-skipIfExists file
    const testingPath = join(tempDir, ".claude/rules/03-testing.md");
    writeFileSync(testingPath, "MODIFIED CONTENT", "utf-8");

    // Second run with force — should overwrite (except ci.yml)
    const results = scaffoldQualityFiles(tempDir, true);

    // ci.yml should be skipped (skipIfExists=true), others should be created
    const ciResult = results.find((r) => r.name.includes("ci.yml"));
    expect(ciResult).toBeDefined();
    expect(ciResult!.status).toBe("skipped");
    expect(ciResult!.message).toBe("existing CI config preserved");

    const nonCiResults = results.filter((r) => !r.name.includes("ci.yml"));
    for (const r of nonCiResults) {
      expect(r.status).toBe("created");
    }

    // Verify the modified file WAS overwritten (force=true)
    expect(readFileSync(testingPath, "utf-8")).not.toBe("MODIFIED CONTENT");
  });

  it("should never overwrite ci.yml even with force=true", () => {
    // Create ci.yml with custom content
    const ciPath = join(tempDir, ".github/workflows/ci.yml");
    mkdirSync(join(tempDir, ".github/workflows"), { recursive: true });
    writeFileSync(ciPath, "CUSTOM CI CONFIG", "utf-8");

    // Run with force=true
    const results = scaffoldQualityFiles(tempDir, true);

    const ciResult = results.find((r) => r.name.includes("ci.yml"));
    expect(ciResult).toBeDefined();
    expect(ciResult!.status).toBe("skipped");
    expect(ciResult!.message).toBe("existing CI config preserved");

    // Verify custom content was preserved
    expect(readFileSync(ciPath, "utf-8")).toBe("CUSTOM CI CONFIG");
  });

  it("should set executable bit on verify-before-push.sh after init", () => {
    scaffoldQualityFiles(tempDir, false);

    const shPath = join(tempDir, "scripts/verify-before-push.sh");
    expect(existsSync(shPath)).toBe(true);

    const stats = statSync(shPath);
    // Check that the executable bit is set (owner execute = 0o100)
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable, "verify-before-push.sh should be executable").toBe(true);
  });

  it("should create all required directories when they are missing", () => {
    // Start from completely empty dir — directories don't exist yet
    const results = scaffoldQualityFiles(tempDir, false);

    // All should succeed (directories created automatically)
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.status).toBe("created");
    }

    // Verify all expected directories were created
    const expectedDirs = [
      ".claude/rules",
      ".claude/skills/code-review",
      "scripts",
      ".github/workflows",
    ];
    for (const dir of expectedDirs) {
      const fullDir = join(tempDir, dir);
      expect(existsSync(fullDir), `Directory should exist: ${dir}`).toBe(true);
      const stats = statSync(fullDir);
      expect(stats.isDirectory(), `Should be a directory: ${dir}`).toBe(true);
    }
  });
});
