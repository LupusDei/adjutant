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
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

// child_process: execSync (existing checks) + execFile (the checkDolt real seams,
// adj-182.2.1). execFile is promisified at module load, so it must exist on the mock.
vi.mock("child_process", () => ({
  execSync: vi.fn(),
  execFile: vi.fn((_cmd: string, _args: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
    if (typeof cb === "function") cb(new Error("not available in test"), { stdout: "", stderr: "" });
  }),
}));

// net: the SQL probe seam dials a TCP socket; stub it so the unit test never connects.
vi.mock("net", () => ({
  createConnection: vi.fn(() => ({
    setTimeout: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      // Immediately signal an error so realSqlProbe resolves false without I/O.
      if (event === "error") handler();
    }),
    destroy: vi.fn(),
  })),
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
        return "{}";
      }
      return "{}";
    });
    // claude CLI and bd available; claude plugin list shows adjutant
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("claude plugin list")) {
        return Buffer.from("adjutant-agent@adjutant-marketplace (user, enabled)");
      }
      return Buffer.from("");
    });
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

  it("returns 0 when optional checks warn (bd missing, db missing)", async () => {
    // bd CLI not installed + SQLite DB missing + no API keys
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("claude plugin list")) {
        return Buffer.from("adjutant-agent@adjutant-marketplace (user, enabled)");
      }
      if (typeof cmd === "string" && cmd.includes("command -v claude")) {
        return Buffer.from("/usr/local/bin/claude");
      }
      // bd not found
      throw new Error("not found");
    });
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("adjutant.db")) return false;
      if (s.includes("api-keys.json")) return false;
      return true;
    });
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);

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
