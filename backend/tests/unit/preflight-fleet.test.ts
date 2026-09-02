/**
 * Regression tests for scripts/preflight-fleet.sh (adj-z9dqs).
 *
 * The 2026-09-02 fleet-down incident: launchd already supervised the backend
 * (:4201) and frontend (:4200), then someone additionally ran ./scripts/dev.sh.
 * Its second Vite found 4200 taken, fell back to 4201, and bound IPv6 (::1).
 * `localhost` resolves ::1 first, so every MCP/REST call to localhost:4201 hit
 * Vite and got index.html — while 127.0.0.1:4201/health stayed green, which is
 * why nothing looked down.
 *
 * The preflight is the prevention: dev.sh must refuse to start when the
 * supervised fleet is already up. These tests pin the two properties that make
 * it worth having — it detects an IPv6-only squatter (the exact shape that
 * fooled the old health check), and it detects a launchd-supervised fleet even
 * when the ports look free.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:net";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/preflight-fleet.sh");

/** launchctl stub that reports NO adjutant jobs, so port checks are isolated. */
const LAUNCHCTL_ABSENT = "#!/bin/sh\nexit 1\n";
/** launchctl stub that reports the queried job as loaded and running (has a PID). */
const LAUNCHCTL_RUNNING = ['#!/bin/sh', 'echo "{ \\"PID\\" = 4242; };"', "exit 0", ""].join("\n");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const openServers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close(() => {
            resolveClose();
          });
        }),
    ),
  );
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

/** Bind a listener on `host` and return the ephemeral port it actually got. */
async function listenOn(host: string): Promise<number> {
  const server = createServer();
  openServers.push(server);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host, port: 0, ipv6Only: host === "::1" }, () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address.port;
}

/** Reserve then release a port, so it is known-free at the moment of the call. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  const { port } = address;
  await new Promise<void>((resolveClose) => {
    server.close(() => {
      resolveClose();
    });
  });
  return port;
}

/** Write an executable launchctl stub and return its path. */
function launchctlStub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  tempDirs.push(dir);
  const path = join(dir, "launchctl");
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

async function runPreflight(env: Record<string, string>): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(SCRIPT, [], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("preflight-fleet.sh", () => {
  it("should exit 0 when no fleet is running and both ports are free", async () => {
    const [backendPort, frontendPort] = await Promise.all([freePort(), freePort()]);

    const result = await runPreflight({
      ADJUTANT_BACKEND_PORT: String(backendPort),
      ADJUTANT_FRONTEND_PORT: String(frontendPort),
      ADJUTANT_LAUNCHCTL_BIN: launchctlStub(LAUNCHCTL_ABSENT),
    });

    expect(result.code).toBe(0);
  });

  it("should refuse to start when the backend port is already bound on IPv4", async () => {
    const [backendPort, frontendPort] = await Promise.all([listenOn("127.0.0.1"), freePort()]);

    const result = await runPreflight({
      ADJUTANT_BACKEND_PORT: String(backendPort),
      ADJUTANT_FRONTEND_PORT: String(frontendPort),
      ADJUTANT_LAUNCHCTL_BIN: launchctlStub(LAUNCHCTL_ABSENT),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(String(backendPort));
  });

  it("should refuse to start when a port is bound on IPv6 ONLY (the adj-z9dqs shadowing shape)", async () => {
    // The incident's exact failure: an IPv6-only listener on the backend port.
    // A 127.0.0.1-only probe reports "free" here — that blind spot is the bug.
    const [backendPort, frontendPort] = await Promise.all([listenOn("::1"), freePort()]);

    const result = await runPreflight({
      ADJUTANT_BACKEND_PORT: String(backendPort),
      ADJUTANT_FRONTEND_PORT: String(frontendPort),
      ADJUTANT_LAUNCHCTL_BIN: launchctlStub(LAUNCHCTL_ABSENT),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(String(backendPort));
  });

  it("should refuse to start when launchd reports a supervised job running even if ports look free", async () => {
    const [backendPort, frontendPort] = await Promise.all([freePort(), freePort()]);

    const result = await runPreflight({
      ADJUTANT_BACKEND_PORT: String(backendPort),
      ADJUTANT_FRONTEND_PORT: String(frontendPort),
      ADJUTANT_LAUNCHCTL_BIN: launchctlStub(LAUNCHCTL_RUNNING),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("com.adjutant.backend");
  });

  it("should allow an explicit override via ADJUTANT_ALLOW_DUPLICATE_DEV", async () => {
    const [backendPort, frontendPort] = await Promise.all([listenOn("127.0.0.1"), freePort()]);

    const result = await runPreflight({
      ADJUTANT_BACKEND_PORT: String(backendPort),
      ADJUTANT_FRONTEND_PORT: String(frontendPort),
      ADJUTANT_LAUNCHCTL_BIN: launchctlStub(LAUNCHCTL_RUNNING),
      ADJUTANT_ALLOW_DUPLICATE_DEV: "1",
    });

    expect(result.code).toBe(0);
  });
});
