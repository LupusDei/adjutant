import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Structural tests verifying build infrastructure configuration.
 * These read actual config files and validate they contain the expected settings.
 */

const ROOT_DIR = resolve(__dirname, "../../..");
const BACKEND_DIR = resolve(__dirname, "../..");
const FRONTEND_DIR = resolve(ROOT_DIR, "frontend");

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readFile(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("Build Infrastructure", () => {
  describe("Root package.json scripts", () => {
    const rootPkg = readJson(resolve(ROOT_DIR, "package.json"));
    const scripts = rootPkg.scripts as Record<string, string>;

    it("should have a test script", () => {
      expect(scripts.test).toBeDefined();
      expect(scripts.test).toContain("backend");
      expect(scripts.test).toContain("frontend");
      expect(scripts.test).toContain("npm test");
    });

    it("should have a test:coverage script", () => {
      expect(scripts["test:coverage"]).toBeDefined();
      expect(scripts["test:coverage"]).toContain("test:coverage");
    });

    it("should have a lint script", () => {
      expect(scripts.lint).toBeDefined();
      expect(scripts.lint).toContain("backend");
      expect(scripts.lint).toContain("frontend");
      expect(scripts.lint).toContain("npm run lint");
    });
  });

  describe("Backend package.json build script", () => {
    const backendPkg = readJson(resolve(BACKEND_DIR, "package.json"));
    const scripts = backendPkg.scripts as Record<string, string>;

    it("should include lint in the build script", () => {
      expect(scripts.build).toContain("npm run lint &&");
    });
  });

  describe("Frontend package.json build script", () => {
    const frontendPkg = readJson(resolve(FRONTEND_DIR, "package.json"));
    const scripts = frontendPkg.scripts as Record<string, string>;

    it("should include lint in the build script", () => {
      expect(scripts.build).toContain("npm run lint &&");
    });
  });

  describe("Backend vitest.config.ts coverage thresholds", () => {
    const config = readFile(resolve(BACKEND_DIR, "vitest.config.ts"));

    it("should have coverage thresholds configured", () => {
      expect(config).toContain("thresholds");
      expect(config).toContain("lines:");
      expect(config).toContain("branches:");
      expect(config).toContain("functions:");
    });

    it("should set lines threshold to 75", () => {
      expect(config).toMatch(/lines:\s*75/);
    });

    it("should set branches threshold to 65", () => {
      expect(config).toMatch(/branches:\s*65/);
    });

    it("should set functions threshold to 55", () => {
      expect(config).toMatch(/functions:\s*55/);
    });
  });

  describe("Frontend vitest.config.ts coverage thresholds", () => {
    const config = readFile(resolve(FRONTEND_DIR, "vitest.config.ts"));

    it("should have coverage thresholds configured", () => {
      expect(config).toContain("thresholds");
      expect(config).toContain("lines:");
      expect(config).toContain("branches:");
      expect(config).toContain("functions:");
    });

    it("should set lines threshold to 75", () => {
      expect(config).toMatch(/lines:\s*75/);
    });

    it("should set branches threshold to 65", () => {
      expect(config).toMatch(/branches:\s*65/);
    });

    it("should set functions threshold to 55", () => {
      expect(config).toMatch(/functions:\s*55/);
    });
  });
});
