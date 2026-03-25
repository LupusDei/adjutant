import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { syncQualityFiles } from "../../../cli/commands/upgrade.js";
import { QUALITY_FILES, loadTemplate } from "../../../cli/lib/quality-templates.js";

describe("syncQualityFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "upgrade-quality-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create all missing quality files including ci.yml", () => {
    const results = syncQualityFiles(tempDir);

    // All files should be created when missing — including skipIfExists entries
    for (const qf of QUALITY_FILES) {
      const result = results.find((r) => r.name === qf.destPath);
      expect(result, `Missing result for ${qf.destPath}`).toBeDefined();
      expect(result!.status).toBe("created");
      expect(result!.message).toBe("did not exist — created");

      // Verify file was actually written with template content
      const fullPath = join(tempDir, qf.destPath);
      const written = readFileSync(fullPath, "utf-8");
      expect(written).toBe(loadTemplate(qf.templateName));
    }
  });

  it("should skip up-to-date files", () => {
    // Pre-populate all files with template content
    for (const qf of QUALITY_FILES) {
      const fullPath = join(tempDir, qf.destPath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, loadTemplate(qf.templateName), "utf-8");
    }

    const results = syncQualityFiles(tempDir);

    const nonSkipped = QUALITY_FILES.filter((qf) => !qf.skipIfExists);
    for (const qf of nonSkipped) {
      const result = results.find((r) => r.name === qf.destPath);
      expect(result, `Missing result for ${qf.destPath}`).toBeDefined();
      expect(result!.status).toBe("pass");
      expect(result!.message).toBe("up to date");
    }

    // skipIfExists files that exist should be skipped (not overwritten)
    const skipped = QUALITY_FILES.filter((qf) => qf.skipIfExists);
    for (const qf of skipped) {
      const result = results.find((r) => r.name === qf.destPath);
      expect(result, `Missing result for ${qf.destPath}`).toBeDefined();
      expect(result!.status).toBe("skipped");
    }
  });

  it("should skip outdated files without --force", () => {
    const nonSkipped = QUALITY_FILES.filter((qf) => !qf.skipIfExists);
    for (const qf of nonSkipped) {
      const fullPath = join(tempDir, qf.destPath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, "old content\nline 2\nline 3\n", "utf-8");
    }

    const results = syncQualityFiles(tempDir);

    for (const qf of nonSkipped) {
      const result = results.find((r) => r.name === qf.destPath);
      expect(result, `Missing result for ${qf.destPath}`).toBeDefined();
      expect(result!.status).toBe("skipped");
      expect(result!.message).toContain("differs from package");

      // Verify content was NOT replaced
      const fullPath = join(tempDir, qf.destPath);
      const content = readFileSync(fullPath, "utf-8");
      expect(content).toBe("old content\nline 2\nline 3\n");
    }
  });

  it("should update outdated files with --force", () => {
    const nonSkipped = QUALITY_FILES.filter((qf) => !qf.skipIfExists);
    for (const qf of nonSkipped) {
      const fullPath = join(tempDir, qf.destPath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, "old content\nline 2\nline 3\n", "utf-8");
    }

    const results = syncQualityFiles(tempDir, true);

    for (const qf of nonSkipped) {
      const result = results.find((r) => r.name === qf.destPath);
      expect(result, `Missing result for ${qf.destPath}`).toBeDefined();
      expect(result!.status).toBe("created");
      expect(result!.message).toMatch(/^updated \(4 → \d+ lines\)$/);

      // Verify content was replaced
      const fullPath = join(tempDir, qf.destPath);
      const written = readFileSync(fullPath, "utf-8");
      expect(written).toBe(loadTemplate(qf.templateName));
    }
  });

  it("should never touch ci.yml even if it has custom content", () => {
    const ciEntry = QUALITY_FILES.find((qf) => qf.templateName === "ci.yml");
    expect(ciEntry).toBeDefined();

    const ciPath = join(tempDir, ciEntry!.destPath);
    mkdirSync(join(ciPath, ".."), { recursive: true });
    const customContent = "# My custom CI config\nname: custom\n";
    writeFileSync(ciPath, customContent, "utf-8");

    const results = syncQualityFiles(tempDir);

    const ciResult = results.find((r) => r.name === ciEntry!.destPath);
    expect(ciResult).toBeDefined();
    expect(ciResult!.status).toBe("skipped");

    // Verify content is unchanged
    const afterContent = readFileSync(ciPath, "utf-8");
    expect(afterContent).toBe(customContent);
  });

  it("should set executable bit on verify-before-push.sh after sync", () => {
    const results = syncQualityFiles(tempDir);

    const shEntry = QUALITY_FILES.find((qf) => qf.templateName === "verify-before-push.sh");
    expect(shEntry).toBeDefined();

    const shResult = results.find((r) => r.name === shEntry!.destPath);
    expect(shResult).toBeDefined();
    expect(shResult!.status).toBe("created");

    // Check file mode — 0o755 means owner rwx, group rx, others rx
    const fullPath = join(tempDir, shEntry!.destPath);
    const stats = statSync(fullPath);
    // eslint-disable-next-line no-bitwise -- checking file permission bits
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o755);
  });
});
