import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/test"),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import {
  fileExists,
  dirExists,
  parseJsonFile,
  writeJsonFile,
  commandAvailable,
  nodeVersionOk,
  mcpJsonValid,
  adjutantHookRegistered,
} from "../../../cli/lib/checks.js";

describe("cli/lib/checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("fileExists", () => {
    it("returns true when file exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(fileExists("/some/path")).toBe(true);
    });

    it("returns false when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(fileExists("/some/path")).toBe(false);
    });
  });

  describe("dirExists", () => {
    it("returns true when directory exists", () => {
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      expect(dirExists("/some/dir")).toBe(true);
    });

    it("returns false when path is a file", () => {
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);
      expect(dirExists("/some/file")).toBe(false);
    });

    it("returns false when path does not exist", () => {
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(dirExists("/nonexistent")).toBe(false);
    });
  });

  describe("parseJsonFile", () => {
    it("parses valid JSON file", () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{"key": "value"}');
      expect(parseJsonFile("/some/file.json")).toEqual({ key: "value" });
    });

    it("returns null for invalid JSON", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("not json");
      expect(parseJsonFile("/some/file.json")).toBeNull();
    });

    it("returns null when file cannot be read", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(parseJsonFile("/nonexistent.json")).toBeNull();
    });
  });

  describe("writeJsonFile", () => {
    it("creates parent directories and writes formatted JSON", () => {
      writeJsonFile("/some/dir/file.json", { key: "value" });
      expect(fs.mkdirSync).toHaveBeenCalledWith("/some/dir", { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/some/dir/file.json",
        '{\n  "key": "value"\n}\n',
        "utf-8",
      );
    });
  });

  describe("commandAvailable", () => {
    it("returns true when command exists", async () => {
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));
      expect(commandAvailable("bd")).toBe(true);
    });

    it("returns false when command not found", async () => {
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(commandAvailable("nonexistent")).toBe(false);
    });

    it("rejects commands with shell metacharacters", () => {
      expect(commandAvailable("bd; rm -rf /")).toBe(false);
      expect(commandAvailable("bd && evil")).toBe(false);
      expect(commandAvailable("$(whoami)")).toBe(false);
    });

    it("accepts valid command names", async () => {
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));
      expect(commandAvailable("node")).toBe(true);
      expect(commandAvailable("my-tool")).toBe(true);
      expect(commandAvailable("tool_v2")).toBe(true);
    });
  });

  describe("nodeVersionOk", () => {
    it("returns ok true for current Node.js (>= 20)", () => {
      const result = nodeVersionOk();
      expect(result.ok).toBe(true);
      expect(result.version).toBe(process.versions.node);
    });
  });

  describe("mcpJsonValid", () => {
    it("returns not exists when file is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(mcpJsonValid("/project")).toEqual({
        exists: false,
        hasAdjutant: false,
        malformed: false,
      });
    });

    it("returns malformed for invalid JSON", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not json");
      expect(mcpJsonValid("/project")).toEqual({
        exists: true,
        hasAdjutant: false,
        malformed: true,
      });
    });

    it("returns hasAdjutant false when entry missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"mcpServers": {}}');
      expect(mcpJsonValid("/project")).toEqual({
        exists: true,
        hasAdjutant: false,
        malformed: false,
      });
    });

    it("returns hasAdjutant true when configured", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        '{"mcpServers": {"adjutant": {"command": "npx"}}}',
      );
      expect(mcpJsonValid("/project")).toEqual({
        exists: true,
        hasAdjutant: true,
        malformed: false,
      });
    });
  });

  describe("adjutantHookRegistered", () => {
    it("returns false when no settings file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(adjutantHookRegistered()).toBe(false);
    });

    it("returns false when hooks section missing", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      expect(adjutantHookRegistered()).toBe(false);
    });

    it("returns false when only SessionStart registered", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          hooks: {
            SessionStart: [
              { matcher: "", hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }] },
            ],
          },
        }),
      );
      expect(adjutantHookRegistered()).toBe(false);
    });

    it("returns true when both events registered", () => {
      const hookEntry = {
        matcher: "",
        hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          hooks: {
            SessionStart: [hookEntry],
            PreCompact: [hookEntry],
          },
        }),
      );
      expect(adjutantHookRegistered()).toBe(true);
    });
  });
});
