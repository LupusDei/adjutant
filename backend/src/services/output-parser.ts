/**
 * Claude Code output pattern recognizer.
 *
 * Stateful line-by-line parser that converts raw terminal output from Claude Code
 * into structured OutputEvent objects. Best-effort parsing — terminal mode is
 * always available as ground truth.
 *
 * Recognized patterns:
 * - Tool use markers (Read, Edit, Write, Bash, Glob, Grep, Task, etc.)
 * - Agent messages (text between tool calls)
 * - Tool results (indented output after tool calls)
 * - Permission prompts
 * - Status indicators (thinking, working)
 * - Cost/token output
 */

// ============================================================================
// Types
// ============================================================================

export type OutputEvent =
  | { type: "message"; content: string }
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; output: string; truncated?: boolean }
  | { type: "status"; state: "thinking" | "working" | "idle" }
  | {
      type: "permission_request";
      requestId: string;
      action: string;
      details: string;
    }
  | { type: "error"; message: string }
  | {
      type: "cost_update";
      tokens?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
      cost?: number;
    }
  | { type: "raw"; data: string };

type ParserMode = "idle" | "message" | "tool_result";

// ============================================================================
// Patterns
// ============================================================================

// Tool use: "⏺ ToolName(args)" or "⏺ ToolName file: path"
// The ⏺ character is U+23FA (BLACK CIRCLE FOR RECORD) used by Claude Code
const TOOL_USE_PAREN = /^⏺\s+(\w+)\((.*)$/;
const TOOL_USE_COLON = /^⏺\s+(\w+)\s+file:\s*(.+)$/;
const TOOL_USE_BARE = /^⏺\s+(Read|Edit|Write|Bash|Glob|Grep|Task|WebSearch|WebFetch|NotebookEdit|AskUserQuestion)\s*$/;

// Known tool names for matching
const KNOWN_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Glob",
  "Grep",
  "Task",
  "WebSearch",
  "WebFetch",
  "NotebookEdit",
  "AskUserQuestion",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
  "TodoWrite",
  "TodoRead",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);

// Tool result prefix: indented lines or ⎿ marker
const TOOL_RESULT_PREFIX = /^(\s{2,}|  ⎿\s?)/;
const TOOL_RESULT_MARKER = /^\s*⎿\s*/;

// Permission prompt patterns
const PERMISSION_ALLOW = /(?:Do you want to allow|Allow)\s+(.+?)(?:\s*\?\s*(?:\[y\/n\]|\(y\/n\))?)?$/i;
const PERMISSION_PROMPT = /^\s*(?:Allow|Approve|Permit)\s+(?:this\s+)?(?:action|tool\s+call|execution).*\?\s*/i;
const PERMISSION_YN = /(?:yes|no|y\/n|\[Y\/n\]|\(y\/n\))\s*$/;

// Status indicators
const THINKING_PATTERN = /(?:thinking|Thinking)\s*\.{0,3}\s*$/;
const WORKING_PATTERN = /(?:working|processing|generating)\s*\.{0,3}\s*$/i;
const IDLE_PATTERN = /^\s*[>❯]\s*$/; // The idle prompt ">" or "❯"

// Cost/token patterns
const COST_PATTERN = /(?:Total\s+)?[Cc]ost:\s*\$?([\d,.]+)/;
const TOKENS_PATTERN =
  /[Tt]okens?:\s*([\d,]+)\s*(?:\(?\s*(?:input|in):\s*([\d,]+))?/;
const INPUT_TOKENS = /input(?:\s+tokens)?:\s*([\d,]+)/i;
const OUTPUT_TOKENS = /output(?:\s+tokens)?:\s*([\d,]+)/i;
const CACHE_READ_TOKENS = /cache[\s_-]?read(?:\s+tokens)?:\s*([\d,]+)/i;
const CACHE_WRITE_TOKENS = /cache[\s_-]?write(?:\s+tokens)?:\s*([\d,]+)/i;

// Agent message: starts with ⏺ but doesn't match a tool pattern
const AGENT_BULLET = /^⏺\s+/;

// Error patterns
const ERROR_PATTERN = /^(?:Error|ERROR|✗|✘|error\[):\s*(.+)/;

// Truncation indicator in tool results
const TRUNCATED_PATTERN = /\.\.\.\s*(?:\(truncated\)|output truncated|\d+ more lines?)/i;

// ============================================================================
// Parser
// ============================================================================

export class OutputParser {
  private mode: ParserMode = "idle";
  private currentTool: string | null = null;
  private resultLines: string[] = [];
  private messageLines: string[] = [];
  private permCounter = 0;

  /**
   * Parse a single line of terminal output.
   * Returns zero or more structured events.
   */
  parseLine(line: string): OutputEvent[] {
    // Clean terminal output — may produce multiple sublines from \r splits
    const cleaned = cleanTerminalOutput(line);
    if (cleaned === "") return [];

    // If cleaning produced multiple lines, process each and flush at end
    const sublines = cleaned.split("\n");
    if (sublines.length > 1) {
      const events: OutputEvent[] = [];
      for (const sub of sublines) {
        events.push(...this.parseSingleLine(sub));
      }
      // Flush any pending state — a complete TUI redraw chunk was received
      events.push(...this.flushCurrent());
      return events;
    }

    return this.parseSingleLine(cleaned);
  }

  /**
   * Parse a single cleaned line of output.
   */
  private parseSingleLine(clean: string): OutputEvent[] {
    const events: OutputEvent[] = [];

    // Skip empty lines in idle mode
    if (clean.trim() === "" && this.mode === "idle") {
      return events;
    }

    // Check for tool use marker — always takes priority
    const toolMatch = this.matchToolUse(clean);
    if (toolMatch) {
      // Flush any accumulated state first
      events.push(...this.flushCurrent());

      events.push({
        type: "tool_use",
        tool: toolMatch.tool,
        input: toolMatch.input,
      });

      this.mode = "tool_result";
      this.currentTool = toolMatch.tool;
      this.resultLines = [];
      return events;
    }

    // Check for permission prompt
    const permEvent = this.matchPermission(clean);
    if (permEvent) {
      events.push(...this.flushCurrent());
      events.push(permEvent);
      this.mode = "idle";
      return events;
    }

    // Check for status indicators
    const statusEvent = this.matchStatus(clean);
    if (statusEvent) {
      events.push(...this.flushCurrent());
      events.push(statusEvent);
      this.mode = "idle";
      return events;
    }

    // Check for cost/token output
    const costEvent = this.matchCost(clean);
    if (costEvent) {
      events.push(...this.flushCurrent());
      events.push(costEvent);
      this.mode = "idle";
      return events;
    }

    // Check for error patterns
    const errorMatch = clean.match(ERROR_PATTERN);
    if (errorMatch) {
      events.push(...this.flushCurrent());
      events.push({ type: "error", message: (errorMatch[1] ?? "").trim() });
      this.mode = "idle";
      return events;
    }

    // Mode-specific handling
    switch (this.mode) {
      case "tool_result": {
        // Check if this line is indented (part of tool result)
        if (
          TOOL_RESULT_PREFIX.test(clean) ||
          TOOL_RESULT_MARKER.test(clean)
        ) {
          // Strip the result marker/indent for cleaner output
          const stripped = clean.replace(TOOL_RESULT_MARKER, "").replace(/^\s{2,}/, "");
          this.resultLines.push(stripped);
        } else if (clean.trim() === "" && this.resultLines.length > 0) {
          // Blank line within tool result — keep it
          this.resultLines.push("");
        } else {
          // Not indented — end of tool result, start of something else
          events.push(...this.flushCurrent());

          // This line might be an agent message
          if (AGENT_BULLET.test(clean)) {
            this.mode = "message";
            this.messageLines = [clean.replace(AGENT_BULLET, "")];
          } else if (clean.trim() !== "") {
            this.mode = "message";
            this.messageLines = [clean];
          }
        }
        break;
      }

      case "message": {
        if (clean.trim() === "" && this.messageLines.length > 0) {
          // Blank line — might be paragraph break or end of message
          // Keep accumulating — we'll flush when we see a tool or new section
          this.messageLines.push("");
        } else if (AGENT_BULLET.test(clean)) {
          // New bullet point — could be continuation of same message
          this.messageLines.push(clean.replace(AGENT_BULLET, ""));
        } else if (clean.trim() !== "") {
          this.messageLines.push(clean);
        } else {
          // Multiple blank lines — flush the message
          events.push(...this.flushCurrent());
        }
        break;
      }

      case "idle":
      default: {
        if (AGENT_BULLET.test(clean)) {
          this.mode = "message";
          this.messageLines = [clean.replace(AGENT_BULLET, "")];
        } else if (clean.trim() !== "") {
          // Non-empty line that doesn't match anything specific
          // Could be agent output without a bullet
          this.mode = "message";
          this.messageLines = [clean];
        }
        break;
      }
    }

    return events;
  }

  /**
   * Flush any accumulated state and return pending events.
   * Call this when the stream ends or when switching contexts.
   */
  flush(): OutputEvent[] {
    return this.flushCurrent();
  }

  /**
   * Reset the parser to its initial state.
   */
  reset(): void {
    this.mode = "idle";
    this.currentTool = null;
    this.resultLines = [];
    this.messageLines = [];
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private flushCurrent(): OutputEvent[] {
    const events: OutputEvent[] = [];

    if (this.mode === "tool_result" && this.resultLines.length > 0) {
      const output = this.resultLines.join("\n").trimEnd();
      const truncated = TRUNCATED_PATTERN.test(output);
      events.push({
        type: "tool_result",
        tool: this.currentTool ?? "unknown",
        output,
        ...(truncated ? { truncated: true } : {}),
      });
    }

    if (this.mode === "message" && this.messageLines.length > 0) {
      const content = this.messageLines.join("\n").trimEnd();
      if (content.length > 0) {
        events.push({ type: "message", content });
      }
    }

    this.mode = "idle";
    this.currentTool = null;
    this.resultLines = [];
    this.messageLines = [];

    return events;
  }

  private matchToolUse(
    line: string,
  ): { tool: string; input: Record<string, unknown> } | null {
    // Pattern 1: ⏺ Tool(args)
    let match = line.match(TOOL_USE_PAREN);
    if (match && match[1] && match[2] !== undefined) {
      const tool = match[1];
      if (KNOWN_TOOLS.has(tool)) {
        let args = match[2];
        // Strip trailing ) if present
        if (args.endsWith(")")) {
          args = args.slice(0, -1);
        }
        return { tool, input: this.parseToolArgs(tool, args) };
      }
    }

    // Pattern 2: ⏺ Tool file: /path
    match = line.match(TOOL_USE_COLON);
    if (match && match[1] && match[2]) {
      const tool = match[1];
      if (KNOWN_TOOLS.has(tool)) {
        return { tool, input: { file_path: match[2].trim() } };
      }
    }

    // Pattern 3: ⏺ Tool (bare, no args)
    match = line.match(TOOL_USE_BARE);
    if (match && match[1]) {
      return { tool: match[1], input: {} };
    }

    return null;
  }

  private parseToolArgs(
    tool: string,
    rawArgs: string,
  ): Record<string, unknown> {
    const args = rawArgs.trim();

    switch (tool) {
      case "Read":
      case "Write":
      case "Edit":
      case "NotebookEdit":
        return { file_path: args };

      case "Bash":
        return { command: args };

      case "Glob":
        return { pattern: args };

      case "Grep":
        return { pattern: args };

      case "Task":
        return { description: args };

      case "WebSearch":
        return { query: args };

      case "WebFetch":
        return { url: args };

      default:
        return args ? { args } : {};
    }
  }

  private matchPermission(line: string): OutputEvent | null {
    const trimmed = line.trim();

    // "Do you want to allow X?" or "Allow X?"
    const allowMatch = trimmed.match(PERMISSION_ALLOW);
    if (allowMatch) {
      this.permCounter++;
      return {
        type: "permission_request",
        requestId: `perm-${this.permCounter}`,
        action: (allowMatch[1] ?? "").trim(),
        details: trimmed,
      };
    }

    // Generic permission prompt
    if (PERMISSION_PROMPT.test(trimmed) && PERMISSION_YN.test(trimmed)) {
      this.permCounter++;
      return {
        type: "permission_request",
        requestId: `perm-${this.permCounter}`,
        action: trimmed,
        details: trimmed,
      };
    }

    return null;
  }

  private matchStatus(line: string): OutputEvent | null {
    const trimmed = line.trim();

    if (THINKING_PATTERN.test(trimmed)) {
      return { type: "status", state: "thinking" };
    }
    if (WORKING_PATTERN.test(trimmed)) {
      return { type: "status", state: "working" };
    }
    if (IDLE_PATTERN.test(line)) {
      return { type: "status", state: "idle" };
    }

    return null;
  }

  private matchCost(line: string): OutputEvent | null {
    const trimmed = line.trim();
    let hasCostInfo = false;

    const event: {
      type: "cost_update";
      tokens?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
      cost?: number;
    } = { type: "cost_update" };

    // Check for cost
    const costMatch = trimmed.match(COST_PATTERN);
    if (costMatch) {
      event.cost = parseFloat((costMatch[1] ?? "0").replace(/,/g, ""));
      hasCostInfo = true;
    }

    // Check for token counts
    const inputMatch = trimmed.match(INPUT_TOKENS);
    const outputMatch = trimmed.match(OUTPUT_TOKENS);
    const cacheReadMatch = trimmed.match(CACHE_READ_TOKENS);
    const cacheWriteMatch = trimmed.match(CACHE_WRITE_TOKENS);

    if (inputMatch || outputMatch || cacheReadMatch || cacheWriteMatch) {
      event.tokens = {};
      if (inputMatch) {
        event.tokens.input = parseInt((inputMatch[1] ?? "0").replace(/,/g, ""), 10);
      }
      if (outputMatch) {
        event.tokens.output = parseInt((outputMatch[1] ?? "0").replace(/,/g, ""), 10);
      }
      if (cacheReadMatch) {
        event.tokens.cacheRead = parseInt(
          (cacheReadMatch[1] ?? "0").replace(/,/g, ""),
          10,
        );
      }
      if (cacheWriteMatch) {
        event.tokens.cacheWrite = parseInt(
          (cacheWriteMatch[1] ?? "0").replace(/,/g, ""),
          10,
        );
      }
      hasCostInfo = true;
    }

    // Fallback: "Total tokens: N"
    if (!hasCostInfo) {
      const tokensMatch = trimmed.match(TOKENS_PATTERN);
      if (tokensMatch) {
        event.tokens = {};
        if (tokensMatch[2]) {
          event.tokens.input = parseInt(
            tokensMatch[2].replace(/,/g, ""),
            10,
          );
        }
        hasCostInfo = true;
      }
    }

    return hasCostInfo ? event : null;
  }
}

// ============================================================================
// Terminal Output Cleaning
// ============================================================================

/**
 * Clean raw tmux pipe-pane output into parseable text.
 *
 * pipe-pane captures VT100 screen rendering data, not a clean text stream.
 * Claude Code's TUI uses cursor movement for layout:
 *   - \x1b[nC (cursor forward n) as spacing between words
 *   - \r (carriage return) within screen redraws
 *   - \x1b[nA (cursor up) for spinner animation redraws
 *
 * This function converts that into clean text the parser can match.
 */
export function cleanTerminalOutput(str: string): string {
  let result = str;

  // 1. Replace cursor-forward (\x1b[nC) with a single space.
  //    Claude Code's TUI uses this as word spacing.
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\[\d*C/g, " ");

  // 2. Strip all remaining CSI sequences including DEC private modes (\x1b[?...l/h)
  //    The [?!>] handles private mode prefixes like \x1b[?2026h (kitty keyboard protocol)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\[[?!>]?[0-9;]*[A-Za-z]/g, "");

  // 3. Strip OSC sequences (title setting, hyperlinks)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");

  // 4. Strip other ESC sequences (single-char escapes)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b[^[\]]/g, "");

  // 5. Replace \r with \n so we can split into sublines
  result = result.replace(/\r/g, "\n");

  // 6. Collapse multiple blank lines / trim
  result = result
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .join("\n");

  return result;
}

/**
 * Strip ANSI escape codes from a string.
 * Simpler version — replaces cursor-forward with space, strips the rest.
 */
export function stripAnsi(str: string): string {
  return cleanTerminalOutput(str);
}
