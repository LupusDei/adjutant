import { describe, it, expect, beforeEach } from "vitest";
import {
  OutputParser,
  cleanTerminalOutput,
  stripAnsi,
  type OutputEvent,
} from "../../src/services/output-parser.js";

describe("OutputParser", () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  // ========================================================================
  // Helper
  // ========================================================================

  /** Feed multiple lines and collect all events (including flush). */
  function parseAll(lines: string[]): OutputEvent[] {
    const events: OutputEvent[] = [];
    for (const line of lines) {
      events.push(...parser.parseLine(line));
    }
    events.push(...parser.flush());
    return events;
  }

  // ========================================================================
  // Tool Use Recognition
  // ========================================================================

  describe("tool use markers", () => {
    it("should recognize Read(path)", () => {
      const events = parseAll(["⏺ Read(src/index.ts)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Read",
        input: { file_path: "src/index.ts" },
      });
    });

    it("should recognize Edit(path)", () => {
      const events = parseAll(["⏺ Edit(src/auth/login.ts)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Edit",
        input: { file_path: "src/auth/login.ts" },
      });
    });

    it("should recognize Write(path)", () => {
      const events = parseAll(["⏺ Write(new-file.ts)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Write",
        input: { file_path: "new-file.ts" },
      });
    });

    it("should recognize Bash(command)", () => {
      const events = parseAll(["⏺ Bash(npm test)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Bash",
        input: { command: "npm test" },
      });
    });

    it("should recognize Bash with complex commands", () => {
      const events = parseAll([
        '⏺ Bash(git log --oneline -5 | grep "fix")',
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Bash",
        input: { command: 'git log --oneline -5 | grep "fix"' },
      });
    });

    it("should recognize Glob(pattern)", () => {
      const events = parseAll(["⏺ Glob(src/**/*.ts)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Glob",
        input: { pattern: "src/**/*.ts" },
      });
    });

    it("should recognize Grep(pattern)", () => {
      const events = parseAll(["⏺ Grep(TODO|FIXME)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Grep",
        input: { pattern: "TODO|FIXME" },
      });
    });

    it("should recognize Task(description)", () => {
      const events = parseAll(["⏺ Task(explore the codebase)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Task",
        input: { description: "explore the codebase" },
      });
    });

    it("should recognize WebSearch(query)", () => {
      const events = parseAll(["⏺ WebSearch(node.js streams)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "WebSearch",
        input: { query: "node.js streams" },
      });
    });

    it("should recognize WebFetch(url)", () => {
      const events = parseAll(["⏺ WebFetch(https://example.com)"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "WebFetch",
        input: { url: "https://example.com" },
      });
    });

    it("should recognize 'Tool file: path' format", () => {
      const events = parseAll(["⏺ Read file: /Users/me/code/index.ts"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Read",
        input: { file_path: "/Users/me/code/index.ts" },
      });
    });

    it("should recognize bare tool name without args", () => {
      const events = parseAll(["⏺ Bash"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Bash",
        input: {},
      });
    });

    it("should not match unknown tool names", () => {
      const events = parseAll(["⏺ FooBar(something)"]);
      // Should be treated as a message, not a tool
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message");
    });
  });

  // ========================================================================
  // Tool Results
  // ========================================================================

  describe("tool results", () => {
    it("should capture indented lines as tool result", () => {
      const events = parseAll([
        "⏺ Read(src/index.ts)",
        "  1 | import express from 'express';",
        "  2 | const app = express();",
        "  3 | app.listen(3000);",
      ]);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("tool_use");
      expect(events[1]).toEqual({
        type: "tool_result",
        tool: "Read",
        output:
          "1 | import express from 'express';\n2 | const app = express();\n3 | app.listen(3000);",
      });
    });

    it("should capture ⎿ marker lines as tool result", () => {
      const events = parseAll([
        "⏺ Bash(echo hello)",
        "  ⎿ hello",
      ]);

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "tool_result",
        tool: "Bash",
        output: "hello",
      });
    });

    it("should handle multi-line tool results with blank lines", () => {
      // Blank lines within tool results are preserved as paragraph breaks
      const events = parseAll([
        "⏺ Bash(cat README.md)",
        "  # My Project",
        "  ",
        "  A description.",
      ]);

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "tool_result",
        tool: "Bash",
        output: "# My Project\n\nA description.",
      });
    });

    it("should detect truncated output", () => {
      const events = parseAll([
        "⏺ Bash(find . -name '*.ts')",
        "  ./src/index.ts",
        "  ./src/app.ts",
        "  ... (truncated)",
      ]);

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "tool_result",
        tool: "Bash",
        output: "./src/index.ts\n./src/app.ts\n... (truncated)",
        truncated: true,
      });
    });

    it("should end tool result when non-indented line appears", () => {
      const events = parseAll([
        "⏺ Bash(ls)",
        "  file1.ts",
        "  file2.ts",
        "⏺ The directory contains two files.",
      ]);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("tool_use");
      expect(events[1].type).toBe("tool_result");
      expect(events[2]).toEqual({
        type: "message",
        content: "The directory contains two files.",
      });
    });
  });

  // ========================================================================
  // Agent Messages
  // ========================================================================

  describe("agent messages", () => {
    it("should recognize bullet-prefixed messages", () => {
      const events = parseAll(["⏺ I'll help you fix the bug."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content: "I'll help you fix the bug.",
      });
    });

    it("should accumulate multi-line messages", () => {
      const events = parseAll([
        "⏺ I see the issue.",
        "The password comparison is using == instead of bcrypt.compare().",
        "Let me fix that.",
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content:
          "I see the issue.\nThe password comparison is using == instead of bcrypt.compare().\nLet me fix that.",
      });
    });

    it("should handle messages with paragraph breaks", () => {
      // Blank lines within messages are preserved as paragraph breaks
      const events = parseAll([
        "⏺ First paragraph.",
        "",
        "Second paragraph.",
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content: "First paragraph.\n\nSecond paragraph.",
      });
    });

    it("should flush message when tool use appears", () => {
      const events = parseAll([
        "⏺ Let me read the file.",
        "⏺ Read(src/index.ts)",
      ]);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "message",
        content: "Let me read the file.",
      });
      expect(events[1].type).toBe("tool_use");
    });

    it("should handle plain text without bullet prefix", () => {
      const events = parseAll(["Some output text without a bullet."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content: "Some output text without a bullet.",
      });
    });
  });

  // ========================================================================
  // Permission Prompts
  // ========================================================================

  describe("permission prompts", () => {
    it("should recognize 'Do you want to allow' pattern", () => {
      const events = parseAll([
        "Do you want to allow Bash(rm -rf node_modules)?",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "permission_request",
        requestId: "perm-1",
        action: "Bash(rm -rf node_modules)",
        details: "Do you want to allow Bash(rm -rf node_modules)?",
      });
    });

    it("should recognize 'Allow' pattern", () => {
      const events = parseAll(["Allow Read access to /etc/passwd?"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "permission_request",
        requestId: "perm-1",
        action: "Read access to /etc/passwd",
        details: "Allow Read access to /etc/passwd?",
      });
    });

    it("should increment requestId for multiple prompts", () => {
      const events = parseAll([
        "Do you want to allow Bash(echo 1)?",
        "Do you want to allow Bash(echo 2)?",
      ]);
      expect(events).toHaveLength(2);
      expect(events[0]).toHaveProperty("requestId", "perm-1");
      expect(events[1]).toHaveProperty("requestId", "perm-2");
    });

    it("should flush accumulated message before permission", () => {
      const events = parseAll([
        "⏺ I need to run a command.",
        "Do you want to allow Bash(dangerous command)?",
      ]);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message");
      expect(events[1].type).toBe("permission_request");
    });
  });

  // ========================================================================
  // Status Indicators
  // ========================================================================

  describe("status indicators", () => {
    it("should recognize thinking indicator", () => {
      const events = parseAll(["Thinking..."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "status", state: "thinking" });
    });

    it("should recognize thinking without dots", () => {
      const events = parseAll(["thinking"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "status", state: "thinking" });
    });

    it("should recognize working indicator", () => {
      const events = parseAll(["working..."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "status", state: "working" });
    });

    it("should recognize processing indicator", () => {
      const events = parseAll(["processing..."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "status", state: "working" });
    });

    it("should recognize idle prompt", () => {
      const events = parseAll([" > "]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "status", state: "idle" });
    });
  });

  // ========================================================================
  // Cost/Token Output
  // ========================================================================

  describe("cost and token output", () => {
    it("should parse cost line", () => {
      const events = parseAll(["Total cost: $1.42"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        cost: 1.42,
      });
    });

    it("should parse cost without dollar sign", () => {
      const events = parseAll(["Cost: 0.85"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        cost: 0.85,
      });
    });

    it("should parse input and output tokens", () => {
      const events = parseAll([
        "input tokens: 30,120 output tokens: 15,111",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        tokens: { input: 30120, output: 15111 },
      });
    });

    it("should parse cache read/write tokens", () => {
      const events = parseAll([
        "cache_read tokens: 5,000 cache_write tokens: 2,000",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        tokens: { cacheRead: 5000, cacheWrite: 2000 },
      });
    });

    it("should parse combined cost and tokens", () => {
      const events = parseAll([
        "Total cost: $0.42 input tokens: 30,120 output tokens: 15,111",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        cost: 0.42,
        tokens: { input: 30120, output: 15111 },
      });
    });

    it("should parse 'Total tokens: N' format", () => {
      const events = parseAll(["Total tokens: 45,231"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "cost_update",
        tokens: {},
      });
    });
  });

  // ========================================================================
  // Error Patterns
  // ========================================================================

  describe("error patterns", () => {
    it("should recognize Error: prefix", () => {
      const events = parseAll(["Error: Cannot find module 'foo'"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "error",
        message: "Cannot find module 'foo'",
      });
    });

    it("should recognize ERROR: prefix", () => {
      const events = parseAll(["ERROR: Connection refused"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "error",
        message: "Connection refused",
      });
    });

    it("should recognize cross-mark prefix", () => {
      const events = parseAll(["✗: Build failed"]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "error",
        message: "Build failed",
      });
    });
  });

  // ========================================================================
  // ANSI Handling
  // ========================================================================

  describe("ANSI escape handling", () => {
    it("should parse tool use through ANSI codes", () => {
      // Tool name with bold ANSI
      const events = parseAll([
        "⏺ \x1b[1mRead\x1b[0m(\x1b[36msrc/index.ts\x1b[0m)",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Read",
        input: { file_path: "src/index.ts" },
      });
    });

    it("should strip ANSI from messages", () => {
      const events = parseAll([
        "⏺ \x1b[32mSuccess!\x1b[0m The test passed.",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content: "Success! The test passed.",
      });
    });
  });

  // ========================================================================
  // Full Conversation Flow
  // ========================================================================

  describe("full conversation flow", () => {
    it("should parse a typical agent interaction", () => {
      const events = parseAll([
        "⏺ I'll investigate the login bug. Let me look at the auth code.",
        "⏺ Read(src/auth/login.ts)",
        "  1 | import { hash } from 'bcrypt';",
        "  2 | export function login(user, pass) {",
        "  3 |   return pass == user.hash;",
        "  4 | }",
        "⏺ I found the issue. Line 3 uses == instead of bcrypt.compare().",
        "⏺ Edit(src/auth/login.ts)",
        "  ⎿ Replaced 1 occurrence",
        "⏺ Bash(npm test)",
        "  ⎿ Tests passed: 42/42",
        "⏺ Fixed! The login function now uses bcrypt.compare() for secure comparison.",
      ]);

      expect(events).toHaveLength(9);

      // Message
      expect(events[0]).toEqual({
        type: "message",
        content:
          "I'll investigate the login bug. Let me look at the auth code.",
      });

      // Read tool
      expect(events[1]).toEqual({
        type: "tool_use",
        tool: "Read",
        input: { file_path: "src/auth/login.ts" },
      });

      // Read result
      expect(events[2].type).toBe("tool_result");
      expect(events[2]).toHaveProperty("tool", "Read");

      // Message after reading
      expect(events[3]).toEqual({
        type: "message",
        content:
          "I found the issue. Line 3 uses == instead of bcrypt.compare().",
      });

      // Edit tool
      expect(events[4]).toEqual({
        type: "tool_use",
        tool: "Edit",
        input: { file_path: "src/auth/login.ts" },
      });

      // Edit result
      expect(events[5]).toEqual({
        type: "tool_result",
        tool: "Edit",
        output: "Replaced 1 occurrence",
      });

      // Bash tool
      expect(events[6]).toEqual({
        type: "tool_use",
        tool: "Bash",
        input: { command: "npm test" },
      });

      // Bash result
      expect(events[7]).toEqual({
        type: "tool_result",
        tool: "Bash",
        output: "Tests passed: 42/42",
      });

      // Final message
      expect(events[8]).toEqual({
        type: "message",
        content:
          "Fixed! The login function now uses bcrypt.compare() for secure comparison.",
      });
    });

    it("should handle message → permission → response flow", () => {
      const events = parseAll([
        "⏺ I need to delete the build directory.",
        "Do you want to allow Bash(rm -rf dist/)?",
      ]);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message");
      expect(events[1].type).toBe("permission_request");
    });

    it("should handle tool → status → tool flow", () => {
      const events = parseAll([
        "⏺ Read(large-file.ts)",
        "  (file contents...)",
        "Thinking...",
        "⏺ Edit(large-file.ts)",
        "  ⎿ Applied 3 edits",
      ]);

      expect(events).toHaveLength(5);
      expect(events[0].type).toBe("tool_use");
      expect(events[1].type).toBe("tool_result");
      expect(events[2]).toEqual({ type: "status", state: "thinking" });
      expect(events[3].type).toBe("tool_use");
      expect(events[4].type).toBe("tool_result");
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe("edge cases", () => {
    it("should handle empty input", () => {
      const events = parseAll([]);
      expect(events).toHaveLength(0);
    });

    it("should handle only blank lines", () => {
      const events = parseAll(["", "  ", ""]);
      expect(events).toHaveLength(0);
    });

    it("should handle reset between conversations", () => {
      parser.parseLine("⏺ First message.");
      parser.flush();
      parser.reset();

      const events = parseAll(["⏺ Second message."]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message",
        content: "Second message.",
      });
    });

    it("should handle consecutive tool calls without results", () => {
      const events = parseAll([
        "⏺ Read(file1.ts)",
        "⏺ Read(file2.ts)",
        "⏺ Read(file3.ts)",
      ]);

      // Each tool use triggers, but no results since next line is another tool
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.type === "tool_use")).toBe(true);
    });

    it("should handle paths with spaces", () => {
      const events = parseAll([
        "⏺ Read(src/my project/file name.ts)",
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        tool: "Read",
        input: { file_path: "src/my project/file name.ts" },
      });
    });

    it("should handle flush with no accumulated state", () => {
      const events = parser.flush();
      expect(events).toHaveLength(0);
    });
  });
});

// ============================================================================
// Mutation-killing tests
// ============================================================================

describe("OutputParser mutation tests", () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  /** Feed multiple lines and collect all events (including flush). */
  function parseAll(lines: string[]): OutputEvent[] {
    const events: OutputEvent[] = [];
    for (const line of lines) {
      events.push(...parser.parseLine(line));
    }
    events.push(...parser.flush());
    return events;
  }

  // Mutation 3: SEPARATOR_LINE filter
  it("should filter out separator lines (────────)", () => {
    const events = parseAll(["────────────────────"]);
    expect(events).toHaveLength(0);
  });

  it("should filter separator lines mid-conversation", () => {
    const events = parseAll([
      "⏺ Here is the result.",
      "━━━━━━━━━━━━━━━━━━━━",
      "⏺ Read(file.ts)",
    ]);
    // Should get message + tool_use, no message for the separator
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", content: "Here is the result." });
    expect(events[1].type).toBe("tool_use");
  });

  // Mutation 4: SPINNER_CHARS filter
  it("should filter out solo spinner characters during message accumulation", () => {
    // Put parser into message mode first, then a spinner appears
    // Without SPINNER_CHARS filter, the spinner would be accumulated as message content
    const events = parseAll([
      "⏺ Agent is working on something.",
      "✳",
      "⏺ Read(file.ts)",
    ]);
    // Should get: message, tool_use -- the spinner should NOT appear in message content
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", content: "Agent is working on something." });
    expect(events[1].type).toBe("tool_use");
  });

  it("should filter all spinner character variants", () => {
    const spinners = ["✳", "✶", "✻", "✽", "✢", "·", "⊹", "⋆", "∗"];
    for (const s of spinners) {
      // Test during message mode to bypass the short-line filter
      const p = new OutputParser();
      const evts: OutputEvent[] = [];
      evts.push(...p.parseLine("⏺ Some message."));
      evts.push(...p.parseLine(s));
      evts.push(...p.parseLine("⏺ Read(file.ts)"));
      evts.push(...p.flush());
      // Should be message + tool_use only, no spinner in message
      const msgs = evts.filter(e => e.type === "message");
      expect(msgs).toHaveLength(1);
      expect((msgs[0] as any).content).not.toContain(s);
    }
  });

  // Mutation 5: THINKING_STATUS pattern
  it("should emit thinking status for TUI status phrases like 'Baking...'", () => {
    const events = parseAll(["Baking..."]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "status", state: "thinking" });
  });

  it("should emit thinking status for spinner + status phrase like '✳ Nucleating...'", () => {
    const events = parseAll(["✳ Nucleating..."]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "status", state: "thinking" });
  });

  it("should emit thinking for all THINKING_STATUS words", () => {
    const phrases = ["Fermenting...", "Distilling...", "Brewing...", "Crystallizing..."];
    for (const phrase of phrases) {
      const p = new OutputParser();
      const evts: OutputEvent[] = [];
      evts.push(...p.parseLine(phrase));
      evts.push(...p.flush());
      expect(evts).toHaveLength(1);
      expect(evts[0]).toEqual({ type: "status", state: "thinking" });
    }
  });

  // Mutation 6: IDLE_PATTERN early check — equivalent mutation (matchStatus also catches it)
  // The early check is redundant with matchStatus but provides a fast path.
  // Test verifies idle detection works during message accumulation.
  it("should flush accumulated message when idle prompt appears", () => {
    const events = parseAll([
      "⏺ Working on the task.",
      " > ",
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", content: "Working on the task." });
    expect(events[1]).toEqual({ type: "status", state: "idle" });
  });

  it("should detect idle prompt with ❯ character", () => {
    const events = parseAll([" ❯ "]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "status", state: "idle" });
  });

  // Mutation 7: Short line filter (< 4 chars)
  it("should filter out very short lines (< 4 chars) in idle mode as streaming noise", () => {
    const events = parseAll(["ab"]);
    expect(events).toHaveLength(0);
  });

  it("should filter single-char lines in idle mode", () => {
    const events = parseAll(["x"]);
    expect(events).toHaveLength(0);
  });

  it("should not filter short lines that are agent bullets", () => {
    // "⏺ " + something short is still valid
    const events = parseAll(["⏺ Hi"]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
  });

  // Mutation 9: content.length > 0 check in flushCurrent — equivalent mutation
  // The guard is defensive: through normal parsing paths, messageLines entries always
  // have non-empty content because cleanTerminalOutput + trim checks prevent empty
  // strings from entering messageLines. Verified via mutation analysis that removing
  // the guard does not change observable behavior. Test below confirms non-empty
  // messages are always emitted correctly.
  it("should always emit non-empty message content from flushed message state", () => {
    const events = parseAll([
      "⏺ Real content here.",
      "",
      "More content.",
    ]);
    const messages = events.filter(e => e.type === "message");
    expect(messages).toHaveLength(1);
    expect((messages[0] as any).content.length).toBeGreaterThan(0);
  });

  // Mutation 12: \r to \n replacement in cleanTerminalOutput
  it("should split carriage-return separated lines into sublines", () => {
    // Simulates TUI redraws that use \r
    const result = cleanTerminalOutput("line1\rline2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    // \r should become \n, so split should work
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("should parse tool use from \\r-separated terminal output", () => {
    const events = parseAll(["spinner\r⏺ Bash(ls)"]);
    const toolEvents = events.filter(e => e.type === "tool_use");
    expect(toolEvents.length).toBeGreaterThanOrEqual(1);
    expect(toolEvents[0]).toEqual({
      type: "tool_use",
      tool: "Bash",
      input: { command: "ls" },
    });
  });

  // Mutation 13: Cursor-forward replacement
  it("should replace cursor-forward escape sequences with spaces", () => {
    const result = cleanTerminalOutput("hello\x1b[5Cworld");
    expect(result).toBe("hello world");
  });

  it("should parse tool use with cursor-forward spacing", () => {
    // TUI might render "⏺ Read(file.ts)" with cursor-forward between tokens
    const events = parseAll(["⏺\x1b[3CRead(file.ts)"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_use",
      tool: "Read",
      input: { file_path: "file.ts" },
    });
  });

  // Mutation 14: USER_INPUT pattern detection
  it("should recognize user input lines with arrow prompt", () => {
    const events = parseAll(["❯ fix the bug please"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "user_input",
      content: "fix the bug please",
    });
  });

  it("should flush accumulated message before user input", () => {
    const events = parseAll([
      "⏺ Agent message here.",
      "❯ user typed this",
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", content: "Agent message here." });
    expect(events[1]).toEqual({ type: "user_input", content: "user typed this" });
  });
});

// ============================================================================
// stripAnsi tests
// ============================================================================

describe("stripAnsi", () => {
  it("should strip color codes", () => {
    expect(stripAnsi("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("should strip bold/underline", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m")).toBe(
      "bold underline",
    );
  });

  it("should strip 256-color codes", () => {
    expect(stripAnsi("\x1b[38;5;196mtext\x1b[0m")).toBe("text");
  });

  it("should strip RGB color codes", () => {
    expect(stripAnsi("\x1b[38;2;255;0;0mtext\x1b[0m")).toBe("text");
  });

  it("should strip cursor movement", () => {
    expect(stripAnsi("\x1b[2Aup two lines")).toBe("up two lines");
  });

  it("should strip OSC sequences (title setting)", () => {
    expect(stripAnsi("\x1b]0;My Title\x07rest")).toBe("rest");
  });

  it("should strip OSC sequences with ST terminator", () => {
    expect(stripAnsi("\x1b]0;My Title\x1b\\rest")).toBe("rest");
  });

  it("should leave plain text unchanged", () => {
    expect(stripAnsi("Hello, world!")).toBe("Hello, world!");
  });

  it("should handle empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should handle string with only ANSI codes", () => {
    expect(stripAnsi("\x1b[32m\x1b[0m")).toBe("");
  });

  it("should handle mixed content", () => {
    expect(
      stripAnsi("⏺ \x1b[1mRead\x1b[0m(\x1b[36msrc/index.ts\x1b[0m)"),
    ).toBe("⏺ Read(src/index.ts)");
  });
});
