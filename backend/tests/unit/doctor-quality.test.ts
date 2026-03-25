import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { checkQualityFiles } from "../../../cli/commands/doctor.js";
import { getQualityFilePaths } from "../../../cli/lib/quality-templates.js";
import { runPrime } from "../../../cli/commands/prime.js";

describe("checkQualityFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "doctor-quality-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should report pass for all present quality files", () => {
    const paths = getQualityFilePaths();
    for (const p of paths) {
      const fullPath = join(tempDir, p);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, "content", "utf-8");
    }

    const results = checkQualityFiles(tempDir);

    expect(results).toHaveLength(paths.length);
    for (const r of results) {
      expect(r.status).toBe("pass");
    }
  });

  it("should report fail for all missing quality files", () => {
    const paths = getQualityFilePaths();
    const results = checkQualityFiles(tempDir);

    expect(results).toHaveLength(paths.length);
    for (const r of results) {
      expect(r.status).toBe("fail");
      expect(r.message).toBe("run adjutant upgrade");
    }
  });

  it("should report fail only for specific missing files", () => {
    const paths = getQualityFilePaths();
    const firstPath = join(tempDir, paths[0]);
    mkdirSync(join(firstPath, ".."), { recursive: true });
    writeFileSync(firstPath, "content", "utf-8");

    const results = checkQualityFiles(tempDir);

    expect(results).toHaveLength(paths.length);
    expect(results[0].status).toBe("pass");
    for (let i = 1; i < results.length; i++) {
      expect(results[i].status).toBe("fail");
      expect(results[i].message).toBe("run adjutant upgrade");
    }
  });
});

describe("runPrime quality warning", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let tempDir: string;
  let origCwd: typeof process.cwd;

  beforeEach(() => {
    origCwd = process.cwd;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    tempDir = mkdtempSync(join(tmpdir(), "prime-quality-test-"));
    // Create .adjutant/PRIME.md so prime finds local file
    mkdirSync(join(tempDir, ".adjutant"), { recursive: true });
    writeFileSync(join(tempDir, ".adjutant", "PRIME.md"), "# Test Prime", "utf-8");
  });

  afterEach(() => {
    process.cwd = origCwd;
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should warn when quality files are missing", () => {
    process.cwd = () => tempDir;

    const exitCode = runPrime();

    expect(exitCode).toBe(0);

    const allPaths = getQualityFilePaths();
    const logCalls = consoleSpy.mock.calls.map((c) => String(c[0]));
    const warningLine = logCalls.find((line) => line.includes("Quality files missing"));
    expect(warningLine).toBeDefined();
    expect(warningLine).toContain(`${allPaths.length}/${allPaths.length}`);

    const upgradeLine = logCalls.find((line) => line.includes("adjutant upgrade"));
    expect(upgradeLine).toBeDefined();
  });

  it("should not warn when all quality files are present", () => {
    const allPaths = getQualityFilePaths();
    for (const p of allPaths) {
      const fullPath = join(tempDir, p);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, "content", "utf-8");
    }

    process.cwd = () => tempDir;

    const exitCode = runPrime();

    expect(exitCode).toBe(0);

    const logCalls = consoleSpy.mock.calls.map((c) => String(c[0]));
    const warningLine = logCalls.find((line) => line.includes("Quality files missing"));
    expect(warningLine).toBeUndefined();
  });
});
