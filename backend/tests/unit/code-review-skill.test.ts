import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const SKILL_PATH = resolve(
  __dirname,
  "../../../.claude/skills/code-review/SKILL.md"
);

describe("Code Review Skill (SKILL.md)", () => {
  it("should exist at .claude/skills/code-review/SKILL.md", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  describe("frontmatter", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SKILL_PATH, "utf-8");
    });

    it("should have valid YAML frontmatter delimiters", () => {
      expect(content.startsWith("---\n")).toBe(true);
      const secondDelimiter = content.indexOf("---", 4);
      expect(secondDelimiter).toBeGreaterThan(4);
    });

    it("should have a name field set to 'code-review'", () => {
      const frontmatter = extractFrontmatter(content);
      expect(frontmatter).toContain("name: code-review");
    });

    it("should have a description field", () => {
      const frontmatter = extractFrontmatter(content);
      expect(frontmatter).toMatch(/description:\s*.+/);
    });
  });

  describe("trigger words", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SKILL_PATH, "utf-8");
    });

    it("should reference /code-review trigger", () => {
      expect(content).toContain("/code-review");
    });

    it("should mention 'review code' or 'code review' as triggers", () => {
      const hasReviewCode = content.includes("review code");
      const hasCodeReview = content.includes("code review");
      expect(hasReviewCode || hasCodeReview).toBe(true);
    });

    it("should mention 'review my changes' as a trigger", () => {
      expect(content.toLowerCase()).toContain("review my changes");
    });
  });

  describe("process steps", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SKILL_PATH, "utf-8");
    });

    it("should include diff retrieval via git diff", () => {
      expect(content).toContain("git diff");
    });

    it("should analyze test coverage", () => {
      const lower = content.toLowerCase();
      expect(lower).toContain("test coverage");
    });

    it("should analyze code quality", () => {
      const lower = content.toLowerCase();
      expect(lower).toContain("code quality");
    });

    it("should analyze architecture conformance", () => {
      const lower = content.toLowerCase();
      expect(lower).toContain("architecture");
    });

    it("should analyze security", () => {
      const lower = content.toLowerCase();
      expect(lower).toContain("security");
    });

    it("should analyze error handling", () => {
      const lower = content.toLowerCase();
      expect(lower).toContain("error handling");
    });
  });

  describe("output format", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SKILL_PATH, "utf-8");
    });

    it("should define Critical, Warning, and Suggestion severity levels", () => {
      expect(content).toContain("Critical");
      expect(content).toContain("Warning");
      expect(content).toContain("Suggestion");
    });

    it("should include structured output with Summary section", () => {
      expect(content).toContain("### Summary");
    });

    it("should include Critical Issues section in output template", () => {
      expect(content).toContain("### Critical Issues");
    });

    it("should include Warnings section in output template", () => {
      expect(content).toContain("### Warnings");
    });

    it("should include Test Coverage Assessment section", () => {
      expect(content).toContain("### Test Coverage Assessment");
    });

    it("should include file:line reference format in output", () => {
      // The output template uses [path/to/file.ts:42] format
      expect(content).toMatch(/\[.*\.ts:\d+\]/);
    });
  });

  describe("bead creation for findings", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SKILL_PATH, "utf-8");
    });

    it("should reference bead creation for critical findings", () => {
      // Should mention creating bug beads for critical issues
      expect(content).toContain("--type=bug");
    });

    it("should reference bead creation for warning findings", () => {
      // Should mention creating task beads for warnings
      expect(content).toMatch(/--type=task/);
    });

    it("should use bd create for bead creation", () => {
      expect(content).toContain("bd create");
    });

    it("should wire dependencies with bd dep add", () => {
      expect(content).toContain("bd dep add");
    });

    it("should not create beads for suggestions", () => {
      expect(content.toLowerCase()).toContain(
        "suggestions do not get beads"
      );
    });
  });
});

/** Extract the frontmatter string between the two --- delimiters */
function extractFrontmatter(content: string): string {
  const start = content.indexOf("---");
  const end = content.indexOf("---", start + 3);
  if (start === -1 || end === -1) return "";
  return content.slice(start + 3, end).trim();
}
