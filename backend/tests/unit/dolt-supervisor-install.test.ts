/**
 * Tests for installSupervisor() orchestration (adj-182.1.4, T004a/b).
 *
 * `installSupervisor(opts)` is the orchestration step that turns the PURE plist
 * generator (adj-182.1.3) + pin writer (adj-182.1.2) into an actually-installed,
 * loaded, supervised Dolt server. It:
 *   1. Pins the port (metadata.json/config.yaml) → puts beads into externally-
 *      managed mode (`dolt_server_port` present).
 *   2. Writes the launchd plist to the LaunchAgents path.
 *   3. Installs the agent idempotently: `launchctl bootout` (best-effort, may fail
 *      if not loaded) THEN `launchctl bootstrap` (load fresh).
 *   4. Verifies the server is reachable via the INJECTED SQL-probe seam.
 *
 * Every external effect (exec, fs, the SQL probe) is INJECTED so this test never
 * touches launchd or the live Dolt server. SAFETY: no real cutover, no real
 * launchctl, no real fs writes outside what the seams capture.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { installSupervisor, type InstallSupervisorOptions } from "../../../cli/lib/dolt-supervisor.js";

/** A recorded exec invocation. */
interface ExecCall {
  cmd: string;
  args: readonly string[];
}

/** Build a fully-seamed options object with capturing fakes. */
function makeOpts(overrides: Partial<InstallSupervisorOptions> = {}): {
  opts: InstallSupervisorOptions;
  execCalls: ExecCall[];
  writes: Map<string, string>;
  probeCalls: number;
} {
  const execCalls: ExecCall[] = [];
  const writes = new Map<string, string>();
  const probeState = { calls: 0 };

  const opts: InstallSupervisorOptions = {
    projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    beadsDir: "/Users/me/proj/.beads",
    port: 17005,
    doltBin: "/usr/local/bin/dolt",
    plistPath: "/Users/me/Library/LaunchAgents/com.adjutant.dolt.a1b2c3d4.plist",
    logPath: "/Users/me/proj/.beads/dolt-server.log",
    uid: 501,
    // seams
    exec: vi.fn(async (cmd: string, args: readonly string[]) => {
      execCalls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    }),
    pinPort: vi.fn((_beadsDir: string, _port: number) => `BEADS_DOLT_SERVER_PORT=${_port}`),
    writePlist: vi.fn((path: string, contents: string) => {
      writes.set(path, contents);
    }),
    sqlProbe: vi.fn(async () => {
      probeState.calls += 1;
      return true;
    }),
    ...overrides,
  };

  return {
    opts,
    execCalls,
    writes,
    get probeCalls() {
      return probeState.calls;
    },
  };
}

describe("installSupervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pin the port (externally-managed) before installing the agent", async () => {
    const h = makeOpts();
    await installSupervisor(h.opts);
    expect(h.opts.pinPort).toHaveBeenCalledWith("/Users/me/proj/.beads", 17005);
  });

  it("should write the launchd plist to the configured plistPath", async () => {
    const h = makeOpts();
    await installSupervisor(h.opts);
    expect(h.opts.writePlist).toHaveBeenCalledTimes(1);
    const written = h.writes.get(h.opts.plistPath);
    expect(written).toBeDefined();
    // The plist embeds the supervisor label derived from the projectId.
    expect(written).toContain("com.adjutant.dolt.a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(written).toContain("<key>KeepAlive</key>");
    expect(written).toContain("sql-server");
  });

  it("should install idempotently: bootout (best-effort) THEN bootstrap", async () => {
    const h = makeOpts();
    await installSupervisor(h.opts);

    const launchctlCalls = h.execCalls.filter((c) => c.cmd === "launchctl");
    const bootoutIdx = launchctlCalls.findIndex((c) => c.args.includes("bootout"));
    const bootstrapIdx = launchctlCalls.findIndex((c) => c.args.includes("bootstrap"));

    expect(bootoutIdx).toBeGreaterThanOrEqual(0);
    expect(bootstrapIdx).toBeGreaterThanOrEqual(0);
    expect(bootoutIdx).toBeLessThan(bootstrapIdx);
  });

  it("should target the per-user gui domain with the caller uid in launchctl args", async () => {
    const h = makeOpts();
    await installSupervisor(h.opts);
    const bootstrap = h.execCalls.find(
      (c) => c.cmd === "launchctl" && c.args.includes("bootstrap"),
    );
    expect(bootstrap).toBeDefined();
    // bootstrap gui/<uid> <plistPath>
    expect(bootstrap?.args).toContain("gui/501");
    expect(bootstrap?.args).toContain(h.opts.plistPath);
  });

  it("should tolerate a failing bootout (agent not yet loaded) and still bootstrap", async () => {
    // bootout returns non-zero when the agent isn't loaded — that's expected on a
    // first install and MUST NOT abort the install.
    const h = makeOpts({
      exec: vi.fn(async (cmd: string, args: readonly string[]) => {
        if (args.includes("bootout")) {
          return { code: 3, stdout: "", stderr: "Boot-out failed: 3: No such process" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    });
    const result = await installSupervisor(h.opts);
    expect(result.ok).toBe(true);
    // bootstrap still ran
    const calls = (h.opts.exec as ReturnType<typeof vi.fn>).mock.calls as [string, string[]][];
    expect(calls.some(([cmd, args]) => cmd === "launchctl" && args.includes("bootstrap"))).toBe(true);
  });

  it("should verify the server via the injected SQL probe after bootstrap", async () => {
    const h = makeOpts();
    const result = await installSupervisor(h.opts);
    expect(h.opts.sqlProbe).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("should probe the pinned port (not the PID — #2670)", async () => {
    const probe = vi.fn(async (port: number) => {
      expect(port).toBe(17005);
      return true;
    });
    const h = makeOpts({ sqlProbe: probe });
    await installSupervisor(h.opts);
    expect(probe).toHaveBeenCalledWith(17005);
  });

  it("should report failure (ok=false) when the SQL probe never succeeds", async () => {
    // Inject a no-op sleep + small retry budget so the retry loop runs instantly.
    const h = makeOpts({
      sqlProbe: vi.fn(async () => false),
      probeAttempts: 3,
      sleep: vi.fn(async () => {}),
    });
    const result = await installSupervisor(h.opts);
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
  });

  it("should NOT run bootstrap when bootstrap exec itself fails hard", async () => {
    const h = makeOpts({
      exec: vi.fn(async (_cmd: string, args: readonly string[]) => {
        if (args.includes("bootstrap")) {
          return { code: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }),
    });
    const result = await installSupervisor(h.opts);
    // A hard bootstrap failure → install not ok, and we should not falsely verify.
    expect(result.ok).toBe(false);
  });
});
