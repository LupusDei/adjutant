/**
 * Agent File Writer — TDD Tests
 *
 * Tests for writeAgentFile utility and sanitizePersonaName helper.
 * Covers: sanitization rules, directory creation, file writing, idempotency, frontmatter.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  sanitizePersonaName,
  writeAgentFile,
} from "../../src/services/agent-file-writer.js";

// ============================================================================
// sanitizePersonaName
// ============================================================================

describe("sanitizePersonaName", () => {
  it("should lowercase the name", () => {
    expect(sanitizePersonaName("Sentinel")).toBe("sentinel");
  });

  it("should convert spaces to hyphens", () => {
    expect(sanitizePersonaName("QA Lead")).toBe("qa-lead");
  });

  it("should strip special characters", () => {
    expect(sanitizePersonaName("C++_Expert")).toBe("c-expert");
  });

  it("should collapse consecutive hyphens", () => {
    expect(sanitizePersonaName("foo--bar---baz")).toBe("foo-bar-baz");
  });

  it("should strip slashes and other special chars", () => {
    expect(sanitizePersonaName("AI/ML Specialist")).toBe("aiml-specialist");
  });

  it("should trim leading and trailing hyphens", () => {
    expect(sanitizePersonaName("--test--")).toBe("test");
  });

  it("should handle underscores by converting to hyphens", () => {
    expect(sanitizePersonaName("my_cool_agent")).toBe("my-cool-agent");
  });

  it("should handle already clean names", () => {
    expect(sanitizePersonaName("sentinel")).toBe("sentinel");
  });

  it("should handle names with numbers", () => {
    expect(sanitizePersonaName("Agent 007")).toBe("agent-007");
  });

  it("should handle empty-ish names gracefully", () => {
    expect(sanitizePersonaName("+++")).toBe("agent");
  });
});

// ============================================================================
// writeAgentFile
// ============================================================================

describe("writeAgentFile", () => {
  const tmpDirs: string[] = [];

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "agent-file-writer-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("should create .claude/agents/ directory and write the file with frontmatter", async () => {
    const projectPath = await makeTmpDir();
    const prompt = "You are Sentinel. Watch for bugs.";

    const name = await writeAgentFile(projectPath, "Sentinel", prompt, "Bug-hunting QA agent");

    expect(name).toBe("sentinel");

    const filePath = join(projectPath, ".claude", "agents", "sentinel.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("---\nname: sentinel\n");
    expect(content).toContain('description: "Bug-hunting QA agent"');
    expect(content).toContain("---\n\n");
    expect(content).toContain(prompt);
  });

  it("should prepend YAML frontmatter before the prompt text", async () => {
    const projectPath = await makeTmpDir();
    const prompt = "# Agent Persona: Architect\n\nDesign systems.";

    await writeAgentFile(projectPath, "Architect", prompt, "Systems architect");

    const filePath = join(projectPath, ".claude", "agents", "architect.md");
    const content = await readFile(filePath, "utf-8");
    // Frontmatter must come first
    expect(content.startsWith("---\n")).toBe(true);
    // Prompt text must follow the closing frontmatter delimiter
    const afterFrontmatter = content.split("---\n\n")[1];
    expect(afterFrontmatter).toBe(prompt);
  });

  it("should use fallback description when none provided", async () => {
    const projectPath = await makeTmpDir();

    await writeAgentFile(projectPath, "Sentinel", "Watch for bugs.");

    const filePath = join(projectPath, ".claude", "agents", "sentinel.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain('description: "Persona agent: Sentinel"');
  });

  it("should escape quotes in description", async () => {
    const projectPath = await makeTmpDir();
    const desc = 'Agent who says "hello" a lot';

    await writeAgentFile(projectPath, "Greeter", "Hi!", desc);

    const filePath = join(projectPath, ".claude", "agents", "greeter.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain('description: "Agent who says \\"hello\\" a lot"');
  });

  it("should overwrite existing file (idempotent)", async () => {
    const projectPath = await makeTmpDir();

    // Write first version
    await writeAgentFile(projectPath, "Sentinel", "Version 1", "V1");
    // Write second version
    const name = await writeAgentFile(projectPath, "Sentinel", "Version 2", "V2");

    expect(name).toBe("sentinel");
    const filePath = join(projectPath, ".claude", "agents", "sentinel.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("Version 2");
    expect(content).not.toContain("Version 1");
  });

  it("should handle completely missing .claude/ directory", async () => {
    const projectPath = await makeTmpDir();
    const prompt = "# Agent Persona: QA Lead\n\nYou focus on quality.";

    const name = await writeAgentFile(projectPath, "QA Lead", prompt, "QA specialist");

    expect(name).toBe("qa-lead");
    const filePath = join(projectPath, ".claude", "agents", "qa-lead.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("name: qa-lead");
    expect(content).toContain(prompt);
  });

  it("should handle existing .claude/ directory without agents/ subdirectory", async () => {
    const projectPath = await makeTmpDir();
    await mkdir(join(projectPath, ".claude"), { recursive: true });
    await writeFile(join(projectPath, ".claude", "settings.json"), "{}");

    const name = await writeAgentFile(projectPath, "Architect", "Design things", "Architect agent");

    expect(name).toBe("architect");
    const filePath = join(projectPath, ".claude", "agents", "architect.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("name: architect");
    expect(content).toContain("Design things");
  });

  it("should return the sanitized name used for the file", async () => {
    const projectPath = await makeTmpDir();

    const name = await writeAgentFile(projectPath, "C++_Expert", "Low-level wizardry", "C expert");

    expect(name).toBe("c-expert");
    const filePath = join(projectPath, ".claude", "agents", "c-expert.md");
    const s = await stat(filePath);
    expect(s.isFile()).toBe(true);
  });
});
