/**
 * Test: run capture-pane output through the OutputParser.
 * Simulates what the capture-pane polling does.
 *
 * Usage: npx tsx test-parser.ts [tmux-pane]
 *   default pane: adj-ai
 */
import { execFileSync } from "child_process";
import { OutputParser } from "./src/services/output-parser.js";

const pane = process.argv[2] || "adj-ai";

// Capture the pane
const raw = execFileSync("tmux", ["capture-pane", "-t", pane, "-p", "-S", "-500"], {
  encoding: "utf8",
});

// Extract conversation lines (same logic as SessionConnector)
const SEP = /^[─━═]{10,}/;
const CHROME = /^\s*(~?\/?[\w/.-]*\s+\d*%?\s*❯❯|⏵⏵|Update available|You've used|▐▛|▝▜|▘▘)/;
const lines = raw.split("\n");
const conversationLines: string[] = [];
let inConversation = false;

for (const line of lines) {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) continue;
  if (SEP.test(trimmed)) continue;
  if (CHROME.test(trimmed)) continue;

  if (/^[❯⏺]/.test(trimmed)) {
    inConversation = true;
    conversationLines.push(trimmed);
  } else if (inConversation && /^\s{2,}/.test(line)) {
    conversationLines.push(trimmed);
  } else {
    inConversation = false;
  }
}

console.log(`\n=== Conversation lines (${conversationLines.length}) ===\n`);
for (const line of conversationLines) {
  console.log(`  | ${line}`);
}

console.log(`\n=== Parsing ===\n`);

const parser = new OutputParser();
const allEvents: { line: string; events: unknown[] }[] = [];

for (const line of conversationLines) {
  const events = parser.parseLine(line);
  if (events.length > 0) {
    allEvents.push({ line, events });
  }
}

const finalEvents = parser.flush();
if (finalEvents.length > 0) {
  allEvents.push({ line: "(flush)", events: finalEvents });
}

let totalEvents = 0;
for (const { line, events } of allEvents) {
  totalEvents += events.length;
  console.log(`Line: ${JSON.stringify(line.slice(0, 100))}`);
  for (const evt of events) {
    const s = JSON.stringify(evt);
    console.log(`  → ${s.length > 150 ? s.slice(0, 150) + "..." : s}`);
  }
}

console.log(`\n=== Total: ${totalEvents} events from ${conversationLines.length} conversation lines ===\n`);
