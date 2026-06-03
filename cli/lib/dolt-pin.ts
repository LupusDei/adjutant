/**
 * Dolt pin writer (adj-182.1.2).
 *
 * `pinDoltPort(beadsDir, port)` writes the pinned Dolt SQL-server port into the
 * THREE places beads actually reads (plan §1 — NOT the global ~/.config/bd config,
 * which issue #2073 ignores):
 *   1. `<beadsDir>/metadata.json`        → `dolt_server_port`
 *   2. `<beadsDir>/dolt/config.yaml`     → `listener.port`
 *   3. project env (returned as the `BEADS_DOLT_SERVER_PORT=<port>` export line)
 *
 * Setting `dolt_server_port` in metadata puts beads into externally-managed mode
 * (`IsAutoStartDisabled()` true) so it connects to the supervised server instead
 * of spawning/killing one — killing the ephemeral-port churn at the source.
 *
 * Preservation guarantee:
 *  - metadata.json is JSON; we parse → set → re-serialize, so all other keys survive.
 *  - config.yaml is a comment-heavy template; we do a TARGETED edit of the single
 *    active `port:` line inside the `listener:` block (or append a listener block if
 *    none exists). We never run it through a YAML serializer — that would strip every
 *    comment and reorder the file.
 *
 * Idempotent: re-running with the same port yields byte-identical files and the same
 * return value.
 *
 * SAFETY: operates only under the caller-supplied `beadsDir`. Never the live `.beads/`
 * unless the caller passes it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { DOLT_PORT_BAND_START, DOLT_PORT_BAND_END } from "./dolt-port-registry.js";

/** Default loopback host used when we synthesize a listener block. */
const DEFAULT_LISTENER_HOST = "127.0.0.1";

/** Validate the port is a real integer inside the reserved band. */
function assertBandPort(port: number): void {
  if (!Number.isInteger(port) || port < DOLT_PORT_BAND_START || port > DOLT_PORT_BAND_END) {
    throw new Error(
      `Dolt port ${port} is outside the reserved band ${DOLT_PORT_BAND_START}-${DOLT_PORT_BAND_END}`,
    );
  }
}

/** Write `dolt_server_port` into metadata.json, preserving all other keys. */
function pinMetadata(metadataPath: string, port: number): void {
  if (!existsSync(metadataPath)) {
    throw new Error(`Dolt pin: metadata.json not found at ${metadataPath}`);
  }
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Dolt pin: failed to parse ${metadataPath}: ${(err as Error).message}`);
  }
  meta["dolt_server_port"] = port;
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/**
 * Detect whether `line` is the start of a top-level YAML key (zero indentation,
 * not a comment, not a list item). Used to bound the `listener:` block.
 */
function isTopLevelKey(line: string): boolean {
  return /^[A-Za-z_][\w-]*:/.test(line);
}

/**
 * Rewrite the active `port:` line within an existing `listener:` block, or append
 * a fresh listener block. Returns the new YAML text. Comments and every other line
 * are preserved verbatim.
 */
function applyListenerPort(yaml: string, port: number): string {
  const lines = yaml.split("\n");
  const listenerIdx = lines.findIndex((l) => /^listener:\s*$/.test(l));

  // No listener block at all — append one (preserving a single trailing newline).
  if (listenerIdx === -1) {
    const base = yaml.endsWith("\n") ? yaml : yaml + "\n";
    return (
      base +
      `\nlistener:\n  host: ${DEFAULT_LISTENER_HOST}\n  port: ${port}\n`
    );
  }

  // Find the active (uncommented, indented) `port:` line inside the listener block,
  // stopping at the next top-level key.
  let portIdx = -1;
  for (let i = listenerIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isTopLevelKey(line)) break; // left the listener block
    if (/^\s+port:\s*\d+/.test(line)) {
      portIdx = i;
      break;
    }
  }

  if (portIdx !== -1) {
    const existing = lines[portIdx] ?? "";
    const indent = existing.match(/^(\s*)/)?.[1] ?? "  ";
    lines[portIdx] = `${indent}port: ${port}`;
    return lines.join("\n");
  }

  // Listener block exists but has no active port line — insert one right after the
  // `listener:` header, matching the block's indentation (default two spaces).
  const headerIndentChild = "  ";
  lines.splice(listenerIdx + 1, 0, `${headerIndentChild}port: ${port}`);
  return lines.join("\n");
}

/** Write `listener.port` into dolt/config.yaml, creating the file/block if needed. */
function pinConfigYaml(configPath: string, port: number): void {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const updated = applyListenerPort(existing, port);
  writeFileSync(configPath, updated, "utf-8");
}

/**
 * Pin the Dolt SQL-server port across metadata.json, dolt/config.yaml, and return
 * the env export line.
 *
 * @param beadsDir absolute path to the project's `.beads` directory.
 * @param port     the pinned port (must be in the reserved 17000-17999 band).
 * @returns the `BEADS_DOLT_SERVER_PORT=<port>` export line for the project env.
 * @throws if `beadsDir`/metadata.json is missing or the port is out of band.
 */
export function pinDoltPort(beadsDir: string, port: number): string {
  assertBandPort(port);

  if (!existsSync(beadsDir)) {
    throw new Error(`Dolt pin: .beads directory not found at ${beadsDir}`);
  }

  const metadataPath = join(beadsDir, "metadata.json");
  const configPath = join(beadsDir, "dolt", "config.yaml");

  pinMetadata(metadataPath, port);

  // Ensure the dolt/ subdir exists before writing config.yaml.
  mkdirSync(join(beadsDir, "dolt"), { recursive: true });
  pinConfigYaml(configPath, port);

  return `BEADS_DOLT_SERVER_PORT=${port}`;
}
