#!/usr/bin/env node
/**
 * node-abi-stamp.mjs — refuse an install that would rebuild this tree for a
 * different native ABI than the one that built it (adj-juy35).
 *
 * THE OUTAGE IT PREVENTS (2026-09-02): an `npm install` run from a Node 22
 * shell recompiled better-sqlite3 for NODE_MODULE_VERSION 127 in the tree the
 * Node 20 launchd job runs. The backend then threw ERR_DLOPEN_FAILED at startup
 * — before binding its port — and launchd's KeepAlive restarted it forever. The
 * dashboard simply went dead, with an opaque dlopen line as the only clue. Two
 * node versions live on that box, so this is a standing hazard, not a one-off.
 *
 * WHY A MISMATCH GUARD RATHER THAN A VERSION PIN. The root package publishes
 * backend/ and installs its dependencies on end-user machines, where Node 22 is
 * a perfectly valid choice; an absolute `<21` engines pin would break them to
 * fix a local-machine problem. The invariant that actually matters is narrower
 * and true everywhere: **node_modules must be built by the same node that runs
 * the service.** So a fresh tree installs under anything, and only a *change*
 * of ABI against an already-built tree is refused.
 *
 * Usage (wired into backend/package.json):
 *   preinstall : node scripts/node-abi-stamp.mjs           -> enforce
 *   postinstall: node scripts/node-abi-stamp.mjs --stamp   -> record
 *
 * Escape hatch: ADJUTANT_ALLOW_NODE_ABI_SWITCH=1 for a deliberate switch. It
 * permits the install, which rebuilds everything for the new ABI — after which
 * the SERVICE must also run under that node.
 *
 * Fails open by design: a missing, unreadable, or malformed stamp allows the
 * install. A guard that blocks installs on a garbled file is an outage of its
 * own, and the ABI preflight (scripts/supervisor/node-abi-preflight.sh) is the
 * second line of defence at service start.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STAMP_PATH = join(process.cwd(), "node_modules", ".adjutant-node-abi");
const CURRENT = { modules: process.versions.modules, node: process.version };

/** Record the ABI this tree was just built with. */
function stamp() {
  const dir = join(process.cwd(), "node_modules");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STAMP_PATH, `${JSON.stringify(CURRENT, null, 2)}\n`);
}

/** The previously recorded ABI, or null when absent/unreadable/malformed. */
function previousAbi() {
  if (!existsSync(STAMP_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(STAMP_PATH, "utf8"));
    return typeof parsed.modules === "string" ? parsed : null;
  } catch {
    return null;
  }
}

if (process.argv.includes("--stamp")) {
  stamp();
  process.exit(0);
}

const previous = previousAbi();

if (previous === null || previous.modules === CURRENT.modules) {
  process.exit(0);
}

if (process.env["ADJUTANT_ALLOW_NODE_ABI_SWITCH"] === "1" || process.env["ADJUTANT_ALLOW_NODE_ABI_SWITCH"] === "true") {
  console.warn(
    `[node-abi] switching this tree from NODE_MODULE_VERSION ${previous.modules} (${previous.node}) to ` +
      `${CURRENT.modules} (${CURRENT.node}) — the service must now run under ${CURRENT.node} too.`,
  );
  process.exit(0);
}

console.error(
  [
    "",
    "REFUSING TO INSTALL — this would rebuild node_modules for a different Node ABI (adj-juy35).",
    "",
    `  built by : ${previous.node} (NODE_MODULE_VERSION ${previous.modules})`,
    `  you are  : ${CURRENT.node} (NODE_MODULE_VERSION ${CURRENT.modules})`,
    `  tree     : ${process.cwd()}`,
    "",
    "Native modules (better-sqlite3) are compiled per ABI. Installing under a different",
    "node silently swaps the binding, and the service that runs under the OTHER node then",
    "dies with ERR_DLOPEN_FAILED before it can bind its port — crash-looping invisibly",
    "behind launchd KeepAlive. That was the 2026-09-02 outage.",
    "",
    "What to do:",
    `  - Use the node this tree expects:  nvm use   (backend/.nvmrc)`,
    "  - Or switch this tree deliberately (rebuilds everything, and the SERVICE must",
    "    then run under this node too):",
    "      ADJUTANT_ALLOW_NODE_ABI_SWITCH=1 npm install",
    "",
  ].join("\n"),
);
process.exit(1);
