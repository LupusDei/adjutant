/**
 * Dolt pin writer (adj-182.1.2).
 *
 * `pinDoltPort(beadsDir, port)` writes the pinned Dolt SQL-server port into the
 * THREE places beads actually reads (plan §1 — NOT the global ~/.config/bd config,
 * which issue #2073 ignores):
 *   1. `<beadsDir>/metadata.json`        → `dolt_server_port`
 *   2. `<beadsDir>/dolt/config.yaml`     → `listener.port` AND `behavior.autocommit: true`
 *   3. project env (returned as the `BEADS_DOLT_SERVER_PORT=<port>` export line)
 *
 * Auto-commit (adj-182.2.6, raynor addendum B):
 *  - Dolt's SQL-server `behavior.autocommit` defaults OFF. With it off, `bd create`/
 *    `bd update` land in the working set and are INVISIBLE to `bd list` (a HEAD read)
 *    until a manual `bd dolt commit`. This bit the team live (adj-181's 32 beads, and
 *    again while wiring adj-182). We therefore force `behavior.autocommit: true` on the
 *    SAME config.yaml write as the port pin, so every supervised-server write is
 *    immediately HEAD-visible. Same targeted-edit discipline as the port pin: no YAML
 *    serializer, comments preserved, idempotent. The shipped template comments the whole
 *    `behavior:` block out (Dolt's own default applies), so we append/edit an ACTIVE
 *    block rather than relying on the commented suggestion line.
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metadataPath, "utf-8"));
  } catch (err) {
    throw new Error(`Dolt pin: failed to parse ${metadataPath}: ${(err as Error).message}`);
  }
  // adj-182.1.review.1: assert a PLAIN object. A JSON array would silently drop the
  // port assignment via JSON.stringify (leaving beads self-managed — the churn this
  // epic fixes); a JSON scalar (null/number) would throw a raw TypeError on the index
  // write. Reject both with the module's clean wrapped error.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Dolt pin: malformed metadata.json at ${metadataPath}: expected a JSON object`);
  }
  const meta = parsed as Record<string, unknown>;
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

  // adj-182.1.2.2: detect a FLOW-style listener (`listener: {host: ..., port: NNN}`).
  // The block-style detector below (`/^listener:\s*$/`) does NOT match flow style, so
  // without this branch we would append a SECOND `listener:` key — ambiguous YAML.
  // Edit the port inside the braces in place. If no `port:` exists inside the braces,
  // inject one before the closing brace.
  const flowIdx = lines.findIndex((l) => /^listener:\s*\{.*\}\s*$/.test(l));
  if (flowIdx !== -1) {
    const flowLine = lines[flowIdx] ?? "";
    if (/\bport:\s*\d+/.test(flowLine)) {
      lines[flowIdx] = flowLine.replace(/(\bport:\s*)\d+/, `$1${port}`);
    } else {
      // No port inside the flow map — insert before the closing brace.
      lines[flowIdx] = flowLine.replace(/\}\s*$/, `, port: ${port}}`);
    }
    return lines.join("\n");
  }

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
    // adj-182.1.2.1: preserve any trailing text after the port value (typically an
    // inline `# ...` comment). Rewriting as bare `port: <n>` dropped operator comments
    // and broke comment-preservation/idempotency on the live-cutover re-pin path.
    const trailing = existing.match(/^\s*port:\s*\d+(.*)$/)?.[1] ?? "";
    lines[portIdx] = `${indent}port: ${port}${trailing}`;
    return lines.join("\n");
  }

  // Listener block exists but has no active port line — insert one right after the
  // `listener:` header, matching the block's indentation (default two spaces).
  const headerIndentChild = "  ";
  lines.splice(listenerIdx + 1, 0, `${headerIndentChild}port: ${port}`);
  return lines.join("\n");
}

/**
 * Force an ACTIVE `behavior.autocommit: true` in the config (adj-182.2.6). Returns the
 * new YAML text. Comments and every other line are preserved verbatim — same targeted-
 * edit discipline as {@link applyListenerPort}, never a YAML serializer.
 *
 * Cases:
 *  0. (adj-182.2.6.r1) A FLOW-style active block (`behavior: {autocommit: false}`) → edit
 *     the autocommit value inside the braces in place, or inject one before the closing
 *     brace if absent. Mirrors the flow-style listener defense in {@link applyListenerPort};
 *     without it we would append a SECOND `behavior:` key (a duplicate, ambiguous YAML).
 *  1. A block-style `behavior:` block with an active `autocommit:` line → rewrite its
 *     value to `true`, preserving indentation and any trailing inline comment.
 *  2. A block-style `behavior:` block without an active `autocommit:` line → insert
 *     `autocommit: true` after the header, matching the block's EXISTING child indent
 *     (adj-182.2.6.r1 — inferred, not a hardcoded 2 spaces, so a 4-space hand-edited
 *     block doesn't get a mis-indented sibling that misparses).
 *  3. No active `behavior:` block (the shipped template comments it out) → append a
 *     fresh `behavior:\n  autocommit: true` block, leaving the commented template intact.
 *
 * NOTE: we only consider UNCOMMENTED lines active. The template's `# autocommit: true`
 * suggestion is a comment, so Dolt's real default (OFF) applies until we write a live one.
 */
function applyBehaviorAutocommit(yaml: string): string {
  const lines = yaml.split("\n");

  // 0. adj-182.2.6.r1 — FLOW-style active behavior block (`behavior: {…}`). Edit in place.
  const flowIdx = lines.findIndex((l) => /^behavior:\s*\{.*\}\s*$/.test(l));
  if (flowIdx !== -1) {
    const flowLine = lines[flowIdx] ?? "";
    if (/\bautocommit:\s*\S+/.test(flowLine)) {
      // Rewrite the value, preserving the rest of the flow map. Stop the value match at a
      // brace/comma so we don't swallow the closing `}` or sibling keys.
      lines[flowIdx] = flowLine.replace(/(\bautocommit:\s*)[^,}\s]+/, `$1true`);
    } else {
      // No autocommit inside the flow map — inject before the closing brace, handling both
      // a populated map (`{read_only: false}`) and an empty one (`{}`).
      lines[flowIdx] = /\{\s*\}/.test(flowLine)
        ? flowLine.replace(/\{\s*\}/, `{autocommit: true}`)
        : flowLine.replace(/\}\s*$/, `, autocommit: true}`);
    }
    return lines.join("\n");
  }

  // Active, block-style `behavior:` header on its own line (not a comment, not flow style).
  const behaviorIdx = lines.findIndex((l) => /^behavior:\s*$/.test(l));

  if (behaviorIdx === -1) {
    // No active behavior block — append one. The commented template (`# behavior:` ...)
    // is left untouched; YAML ignores the duplicate-looking commented key.
    const base = yaml.endsWith("\n") || yaml === "" ? yaml : yaml + "\n";
    const lead = base === "" ? "" : "\n";
    return base + `${lead}behavior:\n  autocommit: true\n`;
  }

  // Find an active (uncommented, indented) `autocommit:` line inside the behavior block,
  // stopping at the next top-level key. Also capture the FIRST child's indent so an insert
  // can match it (adj-182.2.6.r1).
  let acIdx = -1;
  let childIndent: string | null = null;
  for (let i = behaviorIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isTopLevelKey(line)) break; // left the behavior block
    const indentMatch = line.match(/^(\s+)\S/);
    if (indentMatch && childIndent === null) childIndent = indentMatch[1];
    if (/^\s+autocommit:\s*\S+/.test(line)) {
      acIdx = i;
      break;
    }
  }

  if (acIdx !== -1) {
    const existing = lines[acIdx] ?? "";
    const indent = existing.match(/^(\s*)/)?.[1] ?? "  ";
    // Preserve any trailing text after the value (typically an inline `# ...` comment),
    // mirroring the port-pin comment-preservation fix (adj-182.1.2.1).
    const trailing = existing.match(/^\s*autocommit:\s*\S+(.*)$/)?.[1] ?? "";
    lines[acIdx] = `${indent}autocommit: true${trailing}`;
    return lines.join("\n");
  }

  // Behavior block exists but has no active autocommit line — insert one right after the
  // `behavior:` header, matching the block's EXISTING child indentation (inferred above;
  // default two spaces when the block has no other children).
  lines.splice(behaviorIdx + 1, 0, `${childIndent ?? "  "}autocommit: true`);
  return lines.join("\n");
}

/**
 * Write `listener.port` AND `behavior.autocommit: true` into dolt/config.yaml, creating
 * the file/block(s) if needed. Both edits are targeted (comment-preserving, idempotent).
 */
function pinConfigYaml(configPath: string, port: number): void {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const withPort = applyListenerPort(existing, port);
  const withAutocommit = applyBehaviorAutocommit(withPort);
  writeFileSync(configPath, withAutocommit, "utf-8");
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
