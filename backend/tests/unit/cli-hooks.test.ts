import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

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

import { registerHooks } from "../../../cli/lib/hooks.js";

describe("cli/lib/hooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns skipped when hooks already registered", () => {
    const hookEntry = {
      matcher: "",
      hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ hooks: { SessionStart: [hookEntry], PreCompact: [hookEntry] } }),
    );

    const result = registerHooks();
    expect(result.status).toBe("skipped");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates hooks from scratch when no settings file exists", () => {
    // First call: adjutantHookRegistered check — no file
    // After write: adjutantHookRegistered returns true
    let callCount = 0;
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        throw new Error("ENOENT");
      }
      // After write, return the written data
      const hookEntry = {
        matcher: "",
        hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }],
      };
      return JSON.stringify({ hooks: { SessionStart: [hookEntry], PreCompact: [hookEntry] } });
    });

    const result = registerHooks();
    expect(result.status).toBe("created");
    expect(fs.mkdirSync).toHaveBeenCalledWith("/home/test/.claude", { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();

    // Verify the written JSON has both hook events
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(String(writeCall[1]));
    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.PreCompact).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(
      "cat .adjutant/PRIME.md 2>/dev/null || true",
    );
  });

  it("merges hooks without clobbering existing ones", () => {
    const existingHook = {
      matcher: "",
      hooks: [{ type: "command", command: "bd prime" }],
    };

    let callCount = 0;
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        // Initial reads: settings has existing hooks but not adjutant
        return JSON.stringify({
          hooks: { SessionStart: [existingHook], PreCompact: [existingHook] },
          otherSetting: true,
        });
      }
      // Post-write verification read
      const adjHook = {
        matcher: "",
        hooks: [{ type: "command", command: "cat .adjutant/PRIME.md 2>/dev/null || true" }],
      };
      return JSON.stringify({
        hooks: {
          SessionStart: [existingHook, adjHook],
          PreCompact: [existingHook, adjHook],
        },
        otherSetting: true,
      });
    });

    const result = registerHooks();
    expect(result.status).toBe("created");

    // Verify existing hooks were preserved
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(String(writeCall[1]));
    expect(written.hooks.SessionStart).toHaveLength(2);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe("bd prime");
    expect(written.hooks.SessionStart[1].hooks[0].command).toBe(
      "cat .adjutant/PRIME.md 2>/dev/null || true",
    );
    expect(written.otherSetting).toBe(true);
  });

  it("returns fail when write doesn't persist", () => {
    // All reads return empty/no hooks
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = registerHooks();
    expect(result.status).toBe("fail");
  });
});
