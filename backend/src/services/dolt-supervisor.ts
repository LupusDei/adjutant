/**
 * Backend Dolt supervisor service (adj-182.2.5).
 *
 * `ensureDoltSupervisor()` is the backend's on-boot self-heal entry point for the
 * supervised, pinned-port Dolt server (see specs/057-bd-dolt-stability). It:
 *   1. Loads the launchd LaunchAgent if it is not already loaded.
 *   2. Runs a health loop that SQL-probes the pinned port on an interval; on a
 *      probe FAILURE it `launchctl kickstart -k`s the agent AND re-inits the
 *      bd-client connection (reuse adj-182.2.4), so a churned endpoint recovers
 *      WITHOUT a backend restart.
 *
 * ┌─ CRITICAL GATE ───────────────────────────────────────────────────────────┐
 * │ The on-boot activation is GATED behind a default-OFF env flag              │
 * │ (ADJUTANT_DOLT_SUPERVISOR). When the flag is unset/0 (the DEFAULT),        │
 * │ ensureDoltSupervisor() is a NO-OP at boot — so merging this does NOT adopt │
 * │ the supervisor or trigger the live cutover on the running adjutant backend.│
 * │ The real cutover is a separate operator step (karax + the General) that    │
 * │ flips the flag. This module NEVER enables itself by default.               │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ALL external effects (flag read, agent load/probe/kickstart, bd-client re-init,
 * interval scheduling, logging) are INJECTED seams so the orchestration is
 * trivially unit-testable and never touches launchd, a real server, or the wall
 * clock unless a real caller supplies real seams.
 */

import { createConnection } from "net";
import { promisify } from "util";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir, userInfo } from "os";
import { join } from "path";

import { _resetDoltConnectionState } from "./bd-client.js";
import { logInfo, logWarn, logError } from "../utils/index.js";

const execFileAsync = promisify(execFile);

/** The on-boot gate env var. Default OFF — see the CRITICAL GATE banner above. */
export const DOLT_SUPERVISOR_FLAG = "ADJUTANT_DOLT_SUPERVISOR";

/**
 * Reverse-DNS supervisor label for a project's Dolt server. Mirrors
 * `cli/lib/dolt-supervisor.ts` `supervisorLabel()` — duplicated here (not
 * imported) because `backend/src` cannot import from the repo-root `cli/` tree
 * under the backend's `rootDir: ./src` build. Keep the two in lockstep: they
 * MUST produce the identical launchd label or the kickstart target will miss.
 */
export function supervisorLabel(projectId: string): string {
  return `com.adjutant.dolt.${projectId}`;
}

/** Default health-probe interval (ms). */
const DEFAULT_PROBE_INTERVAL_MS = 30_000;

/**
 * Interpret the gate flag value. ON only for an explicit truthy `1`/`true`
 * (case-insensitive); everything else — unset, empty, `0`, `false` — is OFF.
 * This makes the supervisor strictly opt-in.
 */
export function isDoltSupervisorFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** All external effects {@link ensureDoltSupervisor} needs. Each is an injected seam. */
export interface DoltSupervisorSeams {
  /** Project UUID — used to derive the supervisor label. */
  projectId: string;
  /** The pinned Dolt port to probe (reserved band 17000–17999). */
  pinnedPort: number;
  /** Read the gate flag. Default seam reads ADJUTANT_DOLT_SUPERVISOR from env. */
  isFlagEnabled: () => boolean;
  /** Is the launchd agent currently loaded? */
  isAgentLoaded: () => Promise<boolean>;
  /** Load the launchd agent. Returns true on success. */
  loadAgent: () => Promise<boolean>;
  /** `launchctl kickstart -k` the agent to force a restart. */
  kickstartAgent: () => Promise<void>;
  /** SQL/TCP health probe against the pinned port (NOT the PID). */
  sqlProbe: (port: number) => Promise<boolean>;
  /**
   * Write-path liveness probe against the supervised server (adj-iw0vy).
   *
   * The handshake {@link sqlProbe} only proves the server ACCEPTS connections — it
   * passes even when every WRITE wedges (the bd server-mode auto-import hang, a dolt
   * write deadlock, a read-only/disk-full server). Such a server is "alive" to the
   * handshake probe forever, so it never self-heals. This probe runs a scratch write;
   * a write-wedged-but-reachable server fails it and gets kickstarted.
   *
   * OPTIONAL: when omitted, only the handshake is checked (legacy behavior). Resolves
   * a boolean (never rejects). Receives the pinned port for symmetry/logging; the
   * production impl routes via the repo dir.
   */
  writeProbe?: (port: number) => Promise<boolean>;
  /** Re-initialise the bd-client connection (reuse adj-182.2.4 breaker reset). */
  reinitBdClient: () => void;
  /** Health-probe interval (ms). */
  probeIntervalMs: number;
  /**
   * Interval scheduler seam (injected for tests). Receives the async health tick
   * directly so tests can capture and await it; the production seam wraps it in
   * `void` for the real `setInterval`.
   */
  setIntervalFn: (fn: () => void | Promise<void>, ms: number) => ReturnType<typeof setInterval>;
  /** Interval clearer seam (injected for tests). */
  clearIntervalFn: (handle: ReturnType<typeof setInterval>) => void;
  /** Structured logger seam. */
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

/** Handle returned by {@link ensureDoltSupervisor} for lifecycle control. */
export interface DoltSupervisorHandle {
  /** True iff the gate flag was on and the supervisor activated. */
  enabled: boolean;
  /** Stop the health loop. Safe to call when disabled (no-op). */
  stop: () => void;
}

/**
 * Ensure the supervised Dolt server is loaded and self-healing.
 *
 * GATED: when {@link DoltSupervisorSeams.isFlagEnabled} returns false (the
 * default), this returns immediately with `enabled: false` and performs NO side
 * effects — no agent load, no probe, no interval. This is what keeps merging
 * adj-182.2.5 safe: it does not adopt the supervisor on the running backend.
 *
 * When enabled it loads the agent (if not already loaded) and starts a health
 * loop. Each tick probes the pinned port; on failure it kickstarts the agent and
 * re-inits the bd-client connection. Probe errors are swallowed so a transient
 * failure never kills the loop or the boot path.
 */
export async function ensureDoltSupervisor(
  seams: DoltSupervisorSeams,
): Promise<DoltSupervisorHandle> {
  if (!seams.isFlagEnabled()) {
    seams.log("info", "Dolt supervisor disabled (flag off) — boot no-op", {
      flag: DOLT_SUPERVISOR_FLAG,
    });
    return { enabled: false, stop: () => {} };
  }

  const label = supervisorLabel(seams.projectId);
  seams.log("info", "Dolt supervisor enabled — ensuring agent + health loop", {
    label,
    port: seams.pinnedPort,
  });

  // 1. Load the agent only if it is not already loaded (idempotent).
  const loaded = await seams.isAgentLoaded();
  if (!loaded) {
    const ok = await seams.loadAgent();
    seams.log(ok ? "info" : "warn", ok ? "Dolt supervisor agent loaded" : "Dolt supervisor agent load failed", {
      label,
    });
  }

  // 2. One health-loop tick: probe → self-heal on failure. Errors are swallowed
  //    so a transient probe failure never kills the loop.
  const selfHeal = async (reason: string): Promise<void> => {
    seams.log("warn", `Dolt health probe failed (${reason}) — kickstarting agent + re-init bd-client`, {
      label,
      port: seams.pinnedPort,
    });
    await seams.kickstartAgent();
    // Re-init the bd-client so it drops the open in-process breaker and
    // reconnects to the (restarted) endpoint without a backend restart.
    seams.reinitBdClient();
  };

  const tick = async (): Promise<void> => {
    try {
      // Phase 1 — handshake/liveness (cheap). A failed handshake means crashed or
      // unreachable; heal immediately and skip the more expensive write probe.
      const reachable = await seams.sqlProbe(seams.pinnedPort);
      if (!reachable) {
        await selfHeal("server unreachable");
        return;
      }
      // Phase 2 — write-path liveness (adj-iw0vy). A reachable server can still be
      // WRITE-WEDGED (handshake passes, every write hangs). Without this, such a
      // server never self-heals. Only runs when a writeProbe seam is supplied.
      if (seams.writeProbe) {
        const writable = await seams.writeProbe(seams.pinnedPort);
        if (!writable) {
          await selfHeal("reachable but write-wedged");
          return;
        }
      }
      // Healthy: reachable AND (no write probe configured OR writable).
    } catch (err) {
      seams.log("error", "Dolt health tick threw — swallowed to keep the loop alive", {
        error: String(err),
      });
    }
  };

  // 3. Schedule the loop. We pass the async tick directly; the production
  //    setIntervalFn wraps it in `void` for the real timer. We store the handle
  //    so stop() can clear it.
  const handle = seams.setIntervalFn(tick, seams.probeIntervalMs);

  return {
    enabled: true,
    stop: () => { seams.clearIntervalFn(handle); },
  };
}

// ── Production seam implementations ──────────────────────────────────────────

/** The per-user launchd `gui/<uid>` domain target. */
function guiDomainTarget(uid: number, label: string): string {
  return `gui/${uid}/${label}`;
}

/** Is the launchd agent loaded? `launchctl print <target>` exits 0 only when it is. */
async function realIsAgentLoaded(uid: number, label: string): Promise<boolean> {
  try {
    await execFileAsync("launchctl", ["print", guiDomainTarget(uid, label)]);
    return true;
  } catch {
    return false;
  }
}

/** Load the agent: `launchctl bootstrap gui/<uid> <plistPath>`. */
async function realLoadAgent(uid: number, plistPath: string): Promise<boolean> {
  try {
    await execFileAsync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    return true;
  } catch {
    return false;
  }
}

/** Force-restart the agent: `launchctl kickstart -k gui/<uid>/<label>`. */
async function realKickstartAgent(uid: number, label: string): Promise<void> {
  try {
    await execFileAsync("launchctl", ["kickstart", "-k", guiDomainTarget(uid, label)]);
  } catch (err) {
    // Surface but do not throw — the loop should survive a transient kickstart error.
    logWarn("Dolt supervisor kickstart failed", { label, error: String(err) });
  }
}

/**
 * Validate that a buffer is a MySQL-protocol Initial Handshake Packet (v10) —
 * the greeting Dolt's sql-server sends the instant a client connects. This is the
 * load-bearing distinction between a real SQL server and a PORT SQUATTER: a bare
 * TCP connect succeeds against ANY listener (an unrelated service, `nc -l`, a
 * half-dead socket), but only a MySQL-wire server emits a valid v10 handshake.
 * Using a bare connect to assert "reachable" therefore false-passes — and the
 * self-heal loop then fails to kickstart a wedged endpoint (adj-182.2.1.r3).
 *
 * Packet layout we validate (no external mysql client — dependency-free):
 *   bytes [0..2] : payload length, 3-byte little-endian
 *   byte  [3]    : sequence id — the SERVER's first packet is always 0
 *   byte  [4]    : protocol version — 0x0a (10) for the modern handshake
 * We also reject an ERR packet (payload first byte 0xff) — a server that rejects
 * the connection is NOT a healthy reachable SQL endpoint — and reject an absurd
 * declared payload length so a random byte stream is very unlikely to pass.
 */
export function isMysqlHandshakePacket(buf: Buffer): boolean {
  // Need at least the 4-byte header + protocol-version byte.
  if (buf.length < 5) return false;
  const declaredPayloadLen = buf.readUIntLE(0, 3);
  const sequenceId = buf[3];
  const protocolVersion = buf[4];
  // The server's first packet uses sequence id 0.
  if (sequenceId !== 0) return false;
  // Modern handshake is protocol v10. (0xff here would be an ERR packet — a
  // rejecting server, not a healthy greeting — and is excluded by this check.)
  if (protocolVersion !== 0x0a) return false;
  // A real handshake payload is small (tens to ~hundreds of bytes); guard against
  // an implausibly large declared length and against a length that cannot fit a
  // protocol byte. This keeps a random byte stream from passing by coincidence.
  if (declaredPayloadLen < 1 || declaredPayloadLen > 0xffff) return false;
  return true;
}

/**
 * SQL-handshake probe against the pinned port (loopback). Connects, reads the
 * server's first packet, and confirms it is a MySQL v10 Initial Handshake — so a
 * bare TCP squatter on the port does NOT false-pass "reachable" (adj-182.2.1.r3).
 * Mirrors doctor.ts intent but upgrades from a bare connect to a real handshake.
 */
function realSqlProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    // A bare connect is NO LONGER sufficient — we wait for the SQL greeting. If the
    // server connects but never sends a valid handshake (squatter), the timeout
    // fires and we fail closed.
    socket.once("data", (chunk: Buffer) => { done(isMysqlHandshakePacket(chunk)); });
    socket.once("timeout", () => { done(false); });
    socket.once("error", () => { done(false); });
  });
}

/** Default write-probe timeout (ms). The wedge HANGS, so the timeout IS the detector. */
const DEFAULT_WRITE_PROBE_TIMEOUT_MS = 5_000;

/** Scratch write the {@link doltWriteProbe} runs. TEMPORARY → no persistent/synced state. */
const WRITE_PROBE_SQL =
  "CREATE TEMPORARY TABLE _adj_write_probe (x INT); " +
  "INSERT INTO _adj_write_probe VALUES (1); " +
  "DROP TABLE _adj_write_probe;";

/** The exec seam {@link doltWriteProbe} drives (injected so tests never spawn `dolt`). */
export type WriteProbeExec = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number },
) => Promise<unknown>;

/**
 * Write-path liveness probe (adj-iw0vy). Runs a scratch CREATE TEMPORARY TABLE /
 * INSERT / DROP via the `dolt` CLI in `doltRepoDir`, which routes to the running
 * supervised sql-server. Resolves `true` only when the write COMPLETES.
 *
 * The wedge case (auto-import hang / write deadlock) HANGS the statement, so the exec
 * `timeout` fires, the child is killed, the promise rejects, and we resolve `false` —
 * the timeout IS the write-wedge detector. Any other error also resolves `false`
 * (fail-closed). The TEMPORARY table is session-scoped, so the live fleet-synced issue
 * DB is never polluted and the working set stays clean.
 *
 * Never rejects — always resolves a boolean — so the health tick treats it as a plain
 * predicate.
 */
export function doltWriteProbe(
  doltRepoDir: string,
  options: { exec?: WriteProbeExec; timeoutMs?: number } = {},
): Promise<boolean> {
  const exec: WriteProbeExec =
    options.exec ?? ((file, args, o) => execFileAsync(file, args, o));
  const timeoutMs = options.timeoutMs ?? DEFAULT_WRITE_PROBE_TIMEOUT_MS;
  return exec("dolt", ["sql", "-q", WRITE_PROBE_SQL], { cwd: doltRepoDir, timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/** Options for building the production seam set. */
export interface ProductionSupervisorOptions {
  /** Project UUID. */
  projectId: string;
  /** Caller uid for the launchd `gui/<uid>` domain. */
  uid: number;
  /** Absolute path to the LaunchAgent plist. */
  plistPath: string;
  /**
   * Pinned Dolt port. Resolved by the CALLER (e.g. from the central registry via
   * `getDoltPort`, or the `BEADS_DOLT_SERVER_PORT` env). Passing `null`/undefined
   * means no port is known, so the supervisor cannot run and is skipped. We do not
   * read the registry here because `backend/src` cannot import the repo-root
   * `cli/` tree under the backend build.
   */
  pinnedPort?: number | null;
  /** Override the probe interval (ms). */
  probeIntervalMs?: number;
  /**
   * Dolt repo/data dir the write probe runs `dolt sql` in (adj-iw0vy). Must be a dir
   * that routes to the supervised server (the beads `dolt` data-dir). When omitted or
   * non-existent, the write probe is skipped (handshake-only, legacy behavior) — we
   * never wire a probe that would false-fail against a missing dir.
   */
  doltRepoDir?: string | null;
}

/**
 * Build the production seam set: read the gate from env, drive launchctl for
 * load/probe/kickstart, re-init the bd-client via its breaker reset, and use the
 * real timers + logger.
 *
 * Returns null when no pinned port is supplied (no port ⇒ nothing to supervise)
 * so the caller can skip activation cleanly.
 */
export function buildProductionSupervisorSeams(
  opts: ProductionSupervisorOptions,
): DoltSupervisorSeams | null {
  const port = opts.pinnedPort ?? null;
  if (typeof port !== "number") {
    logWarn("Dolt supervisor: no pinned port supplied — skipping", { projectId: opts.projectId });
    return null;
  }
  const label = supervisorLabel(opts.projectId);
  // adj-iw0vy: wire the write-path probe only when a real dolt repo dir is available,
  // so a missing dir degrades to handshake-only rather than false-failing every tick.
  const repoDir = opts.doltRepoDir ?? null;
  const writeProbe =
    typeof repoDir === "string" && existsSync(repoDir)
      ? (_port: number) => doltWriteProbe(repoDir)
      : undefined;
  if (!writeProbe) {
    logWarn("Dolt supervisor: no usable doltRepoDir — write-wedge probe disabled (handshake-only)", {
      projectId: opts.projectId,
      doltRepoDir: repoDir,
    });
  }
  return {
    projectId: opts.projectId,
    pinnedPort: port,
    isFlagEnabled: () => isDoltSupervisorFlagEnabled(process.env[DOLT_SUPERVISOR_FLAG]),
    isAgentLoaded: () => realIsAgentLoaded(opts.uid, label),
    loadAgent: () => realLoadAgent(opts.uid, opts.plistPath),
    kickstartAgent: () => realKickstartAgent(opts.uid, label),
    sqlProbe: realSqlProbe,
    ...(writeProbe ? { writeProbe } : {}),
    // adj-182.2.4: clearing the in-process Dolt connection state IS the bd-client
    // re-init — the next execBd re-reads the pinned endpoint and reconnects.
    reinitBdClient: () => { _resetDoltConnectionState(); },
    probeIntervalMs: opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
    setIntervalFn: (fn, ms) =>
      setInterval(() => {
        // The real timer is fire-and-forget; the tick swallows its own errors.
        void fn();
      }, ms),
    clearIntervalFn: (h) => { clearInterval(h); },
    log: (level, msg, meta) => {
      if (level === "info") logInfo(msg, meta);
      else if (level === "warn") logWarn(msg, meta);
      else logError(msg, meta);
    },
  };
}

/**
 * Boot entry point: build the production seams and ensure the supervisor.
 *
 * Safe to call unconditionally at backend boot — when the gate flag is off (the
 * default) it is a no-op. Returns a disabled handle when no port can be resolved
 * or the flag is off, so the backend never blocks on it.
 */
export async function startDoltSupervisorOnBoot(
  opts: ProductionSupervisorOptions,
): Promise<DoltSupervisorHandle> {
  // Fast-path the gate BEFORE building seams so a disabled backend does no work
  // (no registry read, no label compute).
  if (!isDoltSupervisorFlagEnabled(process.env[DOLT_SUPERVISOR_FLAG])) {
    return { enabled: false, stop: () => {} };
  }
  const seams = buildProductionSupervisorSeams(opts);
  if (!seams) return { enabled: false, stop: () => {} };
  return ensureDoltSupervisor(seams);
}

/**
 * Backend-boot wrapper resolving every supervisor input from the environment.
 *
 * This is the single line index.ts calls. It is SAFE to call unconditionally:
 * when ADJUTANT_DOLT_SUPERVISOR is unset/0 (the default) it returns a disabled
 * handle WITHOUT reading anything else or touching launchd — preserving the
 * critical gate (no supervisor adoption / no cutover on merge).
 *
 * When the operator flips the flag on, they also provide:
 *   - ADJUTANT_DOLT_PROJECT_ID  — project UUID for the launchd label
 *   - BEADS_DOLT_SERVER_PORT    — the pinned port to probe
 *   - ADJUTANT_DOLT_PLIST       — plist path (defaults to the conventional
 *                                 ~/Library/LaunchAgents/com.adjutant.dolt.<id>.plist)
 *   - ADJUTANT_DOLT_PROBE_MS    — optional probe interval override
 *   - ADJUTANT_DOLT_REPO_DIR    — optional dolt data-dir for the write-wedge probe
 *                                 (adj-iw0vy); defaults to <cwd>/.beads/dolt
 */
export async function startDoltSupervisorFromEnv(): Promise<DoltSupervisorHandle> {
  if (!isDoltSupervisorFlagEnabled(process.env[DOLT_SUPERVISOR_FLAG])) {
    return { enabled: false, stop: () => {} };
  }

  const projectId = process.env["ADJUTANT_DOLT_PROJECT_ID"]?.trim();
  if (!projectId) {
    logWarn("Dolt supervisor flag on but ADJUTANT_DOLT_PROJECT_ID unset — skipping");
    return { enabled: false, stop: () => {} };
  }

  const portRaw = process.env["BEADS_DOLT_SERVER_PORT"]?.trim();
  const pinnedPort = portRaw ? Number.parseInt(portRaw, 10) : NaN;
  if (!Number.isInteger(pinnedPort) || pinnedPort <= 0) {
    logWarn("Dolt supervisor flag on but BEADS_DOLT_SERVER_PORT invalid — skipping", { portRaw });
    return { enabled: false, stop: () => {} };
  }

  const plistPath =
    process.env["ADJUTANT_DOLT_PLIST"]?.trim() ||
    join(homedir(), "Library", "LaunchAgents", `${supervisorLabel(projectId)}.plist`);

  const probeRaw = process.env["ADJUTANT_DOLT_PROBE_MS"]?.trim();
  const probeIntervalMs = probeRaw ? Number.parseInt(probeRaw, 10) : undefined;

  // adj-iw0vy: the write-wedge probe runs `dolt sql` here. Default to the conventional
  // beads data-dir under the backend's cwd; buildProductionSupervisorSeams disables the
  // probe if the dir does not exist (degrades to handshake-only, never false-fails).
  const doltRepoDir =
    process.env["ADJUTANT_DOLT_REPO_DIR"]?.trim() || join(process.cwd(), ".beads", "dolt");

  return startDoltSupervisorOnBoot({
    projectId,
    uid: userInfo().uid,
    plistPath,
    pinnedPort,
    doltRepoDir,
    ...(probeIntervalMs && probeIntervalMs > 0 ? { probeIntervalMs } : {}),
  });
}
