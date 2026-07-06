#!/usr/bin/env python3
# ============================================================================
# dolt-write-probe.py — write-path liveness probe for a supervised Dolt server.
#
# WHY (adj-iw0vy): the dolt-heal watchdog only checked the MySQL handshake, which
# passes even when EVERY write hangs (the bd server-mode auto-import write-deadlock,
# or a read-only / disk-full server). Such a server is "alive" to the handshake
# probe forever, so the supervisor never self-heals it. This probe runs a scratch
# write and reports whether it COMPLETES — the wedge HANGS the statement, so the
# timeout IS the detector.
#
# It routes to the RUNNING supervised server exactly like `bd`: `dolt sql` executed
# in the server's data dir connects to that dir's live sql-server (via
# .dolt/sql-server.info) as a loopback client — no credentials, no embedded lock
# conflict. The write is a session-scoped TEMPORARY table, so the fleet-synced issue
# DB is never polluted and the working set stays clean.
#
# Mirrors the tested TS `doltWriteProbe` (backend/src/services/dolt-supervisor.ts)
# so the live launchd watchdog and the (gated) in-process supervisor share one
# write-wedge definition.
#
# Usage:   dolt-write-probe.py <dolt-data-dir>
# Env:     ADJ_WRITE_PROBE_TIMEOUT  seconds before a hung write is called wedged (default 8)
# Exit:    0 = write completed        -> server is writable
#          1 = write FAILED (wedged)  -> timed out or dolt errored -> caller should heal
#          2 = could not probe        -> not a dolt data dir / no `dolt` on PATH ->
#                                        caller SKIPS the write check (handshake-only);
#                                        NEVER kickstart on this, so a missing dir can
#                                        never false-fail a healthy server.
# ============================================================================
import os
import shutil
import subprocess
import sys

# Session-scoped scratch write: create a TEMPORARY table (never persisted / synced),
# insert a row, drop it. Exercises the full write path without touching real state.
WRITE_PROBE_SQL = (
    "CREATE TEMPORARY TABLE _adj_write_probe (x INT); "
    "INSERT INTO _adj_write_probe VALUES (1); "
    "DROP TABLE _adj_write_probe;"
)

EXIT_WRITABLE = 0
EXIT_WEDGED = 1
EXIT_CANNOT_PROBE = 2


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1]:
        return EXIT_CANNOT_PROBE
    data_dir = sys.argv[1]

    # Only probe a real Dolt data dir. A dir with no .dolt/ is not a supervised
    # server dir; probing it would false-fail. Degrade to handshake-only (skip).
    if not os.path.isdir(data_dir) or not os.path.isdir(os.path.join(data_dir, ".dolt")):
        return EXIT_CANNOT_PROBE

    # No `dolt` on PATH -> we cannot run the write probe. Skip, never false-fail.
    if shutil.which("dolt") is None:
        return EXIT_CANNOT_PROBE

    try:
        timeout = float(os.environ.get("ADJ_WRITE_PROBE_TIMEOUT", "8"))
    except ValueError:
        timeout = 8.0

    try:
        result = subprocess.run(
            ["dolt", "sql", "-q", WRITE_PROBE_SQL],
            cwd=data_dir,
            timeout=timeout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        # The write HUNG past the deadline: this is the write-wedge signature.
        # subprocess.run has already killed the child before raising.
        return EXIT_WEDGED
    except Exception:
        # Any other failure (spawn error, etc.) -> fail closed and let the caller heal.
        return EXIT_WEDGED

    return EXIT_WRITABLE if result.returncode == 0 else EXIT_WEDGED


if __name__ == "__main__":
    sys.exit(main())
