/**
 * Output parser for Session Bridge.
 *
 * Strips ANSI escape codes from raw terminal output and converts
 * raw terminal lines into structured events for chat-mode rendering.
 * Raw bytes are preserved separately for terminal-mode clients.
 */

// ============================================================================
// ANSI Stripping
// ============================================================================

/**
 * Matches all standard ANSI escape sequences per ECMA-48 / ISO 6429:
 * - OSC sequences: ESC ] ... BEL/ST (window titles, hyperlinks)
 * - CSI sequences: ESC [ ... final_byte (colors, cursor, erase)
 * - 8-bit CSI (C1): 0x9B ... final_byte
 * - Fe escapes: ESC + 0x40-0x5F (RI, IND, NEL, etc. — excluding [ and ])
 * - Fp private: ESC + 0x30-0x3F (DECSC, DECRC, etc.)
 * - Intermediate sequences: ESC + intermediate(s) + final byte
 *
 * Order matters: OSC must precede CSI so ESC ] isn't consumed by CSI.
 */
const ANSI_PATTERN = new RegExp(
  [
    // OSC: ESC ] ... (BEL | ESC \) — must come first to avoid ESC ] being eaten by CSI
    "\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)",
    // CSI: ESC [ (parameter bytes 0x30-3F)* (intermediate bytes 0x20-2F)* (final byte 0x40-7E)
    "\\u001B\\[[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]",
    // 8-bit CSI (C1 control code 0x9B)
    "\\u009B[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]",
    // Fe escape sequences: ESC + 0x40-0x5F (excluding 0x5B=[, 0x5D=])
    "\\u001B[\\x40-\\x5A\\x5C\\x5E\\x5F]",
    // Fp private sequences: ESC + 0x30-0x3F (DEC private like DECSC/DECRC)
    "\\u001B[\\x30-\\x3F]",
    // Intermediate sequences: ESC + intermediate(s) + final byte
    "\\u001B[\\x20-\\x2F]+[\\x30-\\x7E]",
  ].join("|"),
  "g",
);

/**
 * Strip all ANSI escape codes from a string.
 *
 * Returns plain text suitable for chat-mode rendering.
 * Does not modify the input — returns a new string.
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/**
 * Check whether a string contains any ANSI escape codes.
 */
export function hasAnsi(input: string): boolean {
  ANSI_PATTERN.lastIndex = 0;
  return ANSI_PATTERN.test(input);
}

// ============================================================================
// Structured Output Events
// ============================================================================

export interface ToolUseEvent {
  type: "tool_use";
  tool: string;
  detail: string;
}

export interface MessageEvent {
  type: "message";
  content: string;
}

export interface PermissionRequestEvent {
  type: "permission_request";
  action: string;
}

export interface StatusEvent {
  type: "status";
  state: string;
}

export type OutputEvent =
  | ToolUseEvent
  | MessageEvent
  | PermissionRequestEvent
  | StatusEvent;

// ============================================================================
// Line Parsing
// ============================================================================

// Tool use: "⏺ ToolName", "⏺ ToolName(detail)", "⏺ ToolName: detail",
// or "⏺ ToolName extra words: detail"
const TOOL_USE_RE = /^⏺\s+(\w+)(?:\((.+)\)|[:\s]+(.+))?$/;

// Permission prompt patterns
const PERMISSION_RE = /^(?:Allow|Do you want to|Approve)\??\s*\(?([yn/]*)\)?/i;

// Status/thinking indicators
const STATUS_RE = /^[─–—]{2,}\s*(\w+)\s*[─–—]{2,}$/;

/**
 * Parse a single stripped (no ANSI) line into a structured event.
 *
 * Returns `null` for lines that don't match any known pattern —
 * callers should accumulate these as message content.
 */
export function parseLine(line: string): OutputEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Tool use
  const toolMatch = TOOL_USE_RE.exec(trimmed);
  if (toolMatch) {
    const tool = toolMatch[1]!.toLowerCase();
    const detail = toolMatch[2] ?? toolMatch[3] ?? "";
    return { type: "tool_use", tool, detail };
  }

  // Permission prompt
  const permMatch = PERMISSION_RE.exec(trimmed);
  if (permMatch) {
    return { type: "permission_request", action: trimmed };
  }

  // Status indicator (e.g., "── thinking ──")
  const statusMatch = STATUS_RE.exec(trimmed);
  if (statusMatch) {
    return { type: "status", state: statusMatch[1]!.toLowerCase() };
  }

  return null;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process a chunk of raw terminal output.
 *
 * 1. Strips ANSI codes from each line.
 * 2. Parses recognized patterns into structured events.
 * 3. Accumulates unrecognized lines into message events.
 *
 * Returns an array of structured events in order.
 */
export function parseOutput(raw: string): OutputEvent[] {
  const events: OutputEvent[] = [];
  const lines = raw.split("\n");
  let messageAccum: string[] = [];

  function flushMessage(): void {
    if (messageAccum.length > 0) {
      events.push({ type: "message", content: messageAccum.join("\n") });
      messageAccum = [];
    }
  }

  for (const line of lines) {
    const clean = stripAnsi(line);
    const event = parseLine(clean);

    if (event) {
      flushMessage();
      events.push(event);
    } else if (clean.trim()) {
      messageAccum.push(clean);
    }
  }

  flushMessage();
  return events;
}
