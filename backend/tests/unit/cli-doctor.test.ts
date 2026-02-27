import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all external dependencies before importing
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

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import * as fs from "fs";
import { execSync } from "child_process";
import { runDoctor } from "../../../cli/commands/doctor.js";

// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});

describe("cli/commands/doctor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Default: simulate a healthy environment
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return '{"mcpServers": {"adjutant": {"command": "npx"}}}';
      }
      if (p.endsWith("settings.json")) {
        const hookEntry = {
          matcher: "",
          hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }],
        };
        return JSON.stringify({ hooks: { SessionStart: [hookEntry], PreCompact: [hookEntry] } });
      }
      return "{}";
    });
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    mockFetch.mockResolvedValue({ status: 200 });
  });

  it("returns 0 when all checks pass", async () => {
    const exitCode = await runDoctor();
    expect(exitCode).toBe(0);
  });

  it("returns 1 when PRIME.md is missing", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("PRIME.md")) return false;
      return true;
    });
    const exitCode = await runDoctor();
    expect(exitCode).toBe(1);
  });

  it("returns 1 when .mcp.json is missing", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith(".mcp.json")) return false;
      return true;
    });
    const exitCode = await runDoctor();
    expect(exitCode).toBe(1);
  });

  it("returns 1 when backend is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const exitCode = await runDoctor();
    expect(exitCode).toBe(1);
  });

  it("returns 0 when optional checks fail (WARN only)", async () => {
    // bd CLI not installed + SQLite DB missing + hooks not registered + no API keys
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("adjutant.db")) return false;
      if (s.includes("api-keys.json")) return false;
      return true;
    });
    vi.mocked(fs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      if (p.endsWith(".mcp.json")) {
        return '{"mcpServers": {"adjutant": {"command": "npx"}}}';
      }
      // No hooks registered
      return "{}";
    });
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
    // Override existsSync to also exclude mcp-tools/SKILL.md (plugin check)
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("adjutant.db")) return false;
      if (s.includes("api-keys.json")) return false;
      if (s.includes("mcp-tools/SKILL.md")) return false;
      return true;
    });

    const exitCode = await runDoctor();
    // WARN items don't cause exit code 1
    expect(exitCode).toBe(0);
  });

  it("returns 1 when node_modules are missing", async () => {
    vi.mocked(fs.statSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("node_modules")) {
        throw new Error("ENOENT");
      }
      return { isDirectory: () => true } as fs.Stats;
    });
    const exitCode = await runDoctor();
    expect(exitCode).toBe(1);
  });
});
