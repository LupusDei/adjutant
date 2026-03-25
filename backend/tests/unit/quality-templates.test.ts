import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join, isAbsolute } from "path";

import {
  QUALITY_FILES,
  loadTemplate,
  getQualityFilePaths,
} from "../../../cli/lib/quality-templates.js";

/** Resolve the project root (same logic the module uses at runtime). */
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

describe("QualityTemplates", () => {
  it("should have all template files existing on disk for every QUALITY_FILES entry", () => {
    for (const qf of QUALITY_FILES) {
      const templatePath = join(PROJECT_ROOT, "cli", "templates", "quality", qf.templateName);
      expect(existsSync(templatePath), `Template missing: ${qf.templateName}`).toBe(true);
    }
  });

  it("should return non-empty content from loadTemplate for each template", () => {
    for (const qf of QUALITY_FILES) {
      const content = loadTemplate(qf.templateName);
      expect(content.length, `Template empty: ${qf.templateName}`).toBeGreaterThan(0);
    }
  });

  it("should return expected destination paths from getQualityFilePaths", () => {
    const paths = getQualityFilePaths();
    expect(paths).toEqual(QUALITY_FILES.map((f) => f.destPath));
    expect(paths.length).toBe(5);
  });

  it("should have destPaths that are valid relative paths (no leading /)", () => {
    for (const qf of QUALITY_FILES) {
      expect(isAbsolute(qf.destPath), `destPath is absolute: ${qf.destPath}`).toBe(false);
      expect(qf.destPath.startsWith("/"), `destPath starts with /: ${qf.destPath}`).toBe(false);
    }
  });

  it("should mark ci.yml with skipIfExists=true", () => {
    const ciEntry = QUALITY_FILES.find((f) => f.templateName === "ci.yml");
    expect(ciEntry).toBeDefined();
    expect(ciEntry!.skipIfExists).toBe(true);

    // All other entries should NOT skip
    const others = QUALITY_FILES.filter((f) => f.templateName !== "ci.yml");
    for (const qf of others) {
      expect(qf.skipIfExists, `${qf.templateName} should not skipIfExists`).toBe(false);
    }
  });

  it("should mark verify-before-push.sh with executable=true", () => {
    const shEntry = QUALITY_FILES.find((f) => f.templateName === "verify-before-push.sh");
    expect(shEntry).toBeDefined();
    expect(shEntry!.executable).toBe(true);

    // All other entries should NOT be executable
    const others = QUALITY_FILES.filter((f) => f.templateName !== "verify-before-push.sh");
    for (const qf of others) {
      expect(qf.executable, `${qf.templateName} should not be executable`).toBe(false);
    }
  });
});
