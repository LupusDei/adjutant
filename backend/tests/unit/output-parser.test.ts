import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  hasAnsi,
  parseLine,
  parseOutput,
} from "../../src/services/session/output-parser.js";

// ============================================================================
// stripAnsi
// ============================================================================

describe("stripAnsi", () => {
  it("should return plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("should return empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should strip SGR color codes (foreground)", () => {
    // Red text: ESC[31m ... ESC[0m
    expect(stripAnsi("\u001B[31mError\u001B[0m")).toBe("Error");
  });

  it("should strip SGR color codes (background)", () => {
    expect(stripAnsi("\u001B[41mHighlight\u001B[0m")).toBe("Highlight");
  });

  it("should strip bold/italic/underline", () => {
    expect(stripAnsi("\u001B[1mbold\u001B[0m")).toBe("bold");
    expect(stripAnsi("\u001B[3mitalic\u001B[0m")).toBe("italic");
    expect(stripAnsi("\u001B[4munderline\u001B[0m")).toBe("underline");
  });

  it("should strip 256-color codes", () => {
    // ESC[38;5;196m = foreground color 196
    expect(stripAnsi("\u001B[38;5;196mred\u001B[0m")).toBe("red");
  });

  it("should strip 24-bit true color codes", () => {
    // ESC[38;2;255;100;0m = RGB(255,100,0)
    expect(stripAnsi("\u001B[38;2;255;100;0morange\u001B[0m")).toBe("orange");
  });

  it("should strip multiple codes in one string", () => {
    const input = "\u001B[1m\u001B[31mBold Red\u001B[0m normal \u001B[32mGreen\u001B[0m";
    expect(stripAnsi(input)).toBe("Bold Red normal Green");
  });

  it("should strip cursor movement sequences", () => {
    // Cursor up (A), down (B), forward (C), back (D)
    expect(stripAnsi("\u001B[2Aup")).toBe("up");
    expect(stripAnsi("\u001B[3Bdown")).toBe("down");
    expect(stripAnsi("\u001B[5Cforward")).toBe("forward");
    expect(stripAnsi("\u001B[1Dback")).toBe("back");
  });

  it("should strip erase sequences", () => {
    // Erase in display (J), erase in line (K)
    expect(stripAnsi("\u001B[2Jclear")).toBe("clear");
    expect(stripAnsi("\u001B[Kerase")).toBe("erase");
  });

  it("should strip OSC sequences (window title)", () => {
    // ESC ] 0 ; title BEL
    expect(stripAnsi("\u001B]0;My Terminal\u0007prompt$")).toBe("prompt$");
  });

  it("should strip OSC sequences terminated by ST", () => {
    // ESC ] ... ESC backslash
    expect(stripAnsi("\u001B]0;title\u001B\\prompt")).toBe("prompt");
  });

  it("should strip hyperlink sequences", () => {
    // OSC 8 ; params ; uri ST text OSC 8 ; ; ST
    const link = "\u001B]8;;https://example.com\u0007Click\u001B]8;;\u0007";
    expect(stripAnsi(link)).toBe("Click");
  });

  it("should strip simple two-char escape sequences", () => {
    // ESC D (index), ESC M (reverse index), ESC 7 (save cursor)
    expect(stripAnsi("\u001BDtext")).toBe("text");
    expect(stripAnsi("\u001BMtext")).toBe("text");
    expect(stripAnsi("\u001B7text")).toBe("text");
  });

  it("should handle C1 control codes (8-bit CSI)", () => {
    // 0x9B is the 8-bit CSI (equivalent to ESC [)
    expect(stripAnsi("\u009B31mred\u009B0m")).toBe("red");
  });

  it("should preserve non-ANSI special characters", () => {
    expect(stripAnsi("⏺ Read file: test.ts")).toBe("⏺ Read file: test.ts");
    expect(stripAnsi("── thinking ──")).toBe("── thinking ──");
    expect(stripAnsi("100% complete ✓")).toBe("100% complete ✓");
  });

  it("should handle interleaved ANSI codes and text", () => {
    const input = "a\u001B[1mb\u001B[0mc\u001B[32md\u001B[0me";
    expect(stripAnsi(input)).toBe("abcde");
  });

  it("should strip reset-only sequences", () => {
    expect(stripAnsi("\u001B[0m")).toBe("");
    expect(stripAnsi("\u001B[m")).toBe("");
  });
});

// ============================================================================
// hasAnsi
// ============================================================================

describe("hasAnsi", () => {
  it("should return false for plain text", () => {
    expect(hasAnsi("hello world")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(hasAnsi("")).toBe(false);
  });

  it("should return true for colored text", () => {
    expect(hasAnsi("\u001B[31mred\u001B[0m")).toBe(true);
  });

  it("should return true for bold text", () => {
    expect(hasAnsi("\u001B[1mbold\u001B[0m")).toBe(true);
  });

  it("should return true for cursor movement", () => {
    expect(hasAnsi("\u001B[2A")).toBe(true);
  });

  it("should return false for unicode without ANSI", () => {
    expect(hasAnsi("⏺ Read file")).toBe(false);
  });
});

// ============================================================================
// parseLine
// ============================================================================

describe("parseLine", () => {
  describe("tool use detection", () => {
    it("should parse tool use with colon detail", () => {
      const event = parseLine("⏺ Read file: /path/to/file.ts");
      expect(event).toEqual({
        type: "tool_use",
        tool: "read",
        detail: "file: /path/to/file.ts",
      });
    });

    it("should parse tool use with parenthetical detail", () => {
      const event = parseLine("⏺ Bash(ls -la)");
      expect(event).toEqual({
        type: "tool_use",
        tool: "bash",
        detail: "ls -la",
      });
    });

    it("should parse tool use with no detail", () => {
      const event = parseLine("⏺ Write");
      expect(event).toEqual({
        type: "tool_use",
        tool: "write",
        detail: "",
      });
    });

    it("should parse Edit tool", () => {
      const event = parseLine("⏺ Edit: src/index.ts");
      expect(event).toEqual({
        type: "tool_use",
        tool: "edit",
        detail: "src/index.ts",
      });
    });
  });

  describe("permission request detection", () => {
    it("should detect Allow? prompt", () => {
      const event = parseLine("Allow? (y/n)");
      expect(event).toEqual({
        type: "permission_request",
        action: "Allow? (y/n)",
      });
    });

    it("should detect Do you want to prompt", () => {
      const event = parseLine("Do you want to run this command?");
      expect(event).toEqual({
        type: "permission_request",
        action: "Do you want to run this command?",
      });
    });

    it("should detect Approve prompt", () => {
      const event = parseLine("Approve? (y/n)");
      expect(event).toEqual({
        type: "permission_request",
        action: "Approve? (y/n)",
      });
    });
  });

  describe("status indicator detection", () => {
    it("should detect thinking indicator", () => {
      const event = parseLine("── thinking ──");
      expect(event).toEqual({
        type: "status",
        state: "thinking",
      });
    });

    it("should detect working indicator with em dashes", () => {
      const event = parseLine("—— working ——");
      expect(event).toEqual({
        type: "status",
        state: "working",
      });
    });

    it("should detect indicator with en dashes", () => {
      const event = parseLine("–– processing ––");
      expect(event).toEqual({
        type: "status",
        state: "processing",
      });
    });
  });

  describe("non-matching lines", () => {
    it("should return null for plain text", () => {
      expect(parseLine("Hello, how can I help?")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseLine("")).toBeNull();
    });

    it("should return null for whitespace-only", () => {
      expect(parseLine("   ")).toBeNull();
    });
  });
});

// ============================================================================
// parseOutput
// ============================================================================

describe("parseOutput", () => {
  it("should handle empty input", () => {
    expect(parseOutput("")).toEqual([]);
  });

  it("should parse plain text as a message event", () => {
    const events = parseOutput("Hello world");
    expect(events).toEqual([{ type: "message", content: "Hello world" }]);
  });

  it("should accumulate consecutive plain lines into one message", () => {
    const events = parseOutput("Line 1\nLine 2\nLine 3");
    expect(events).toEqual([
      { type: "message", content: "Line 1\nLine 2\nLine 3" },
    ]);
  });

  it("should split messages around tool use events", () => {
    const input = "Some text\n⏺ Bash(ls)\nMore text";
    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "message", content: "Some text" },
      { type: "tool_use", tool: "bash", detail: "ls" },
      { type: "message", content: "More text" },
    ]);
  });

  it("should strip ANSI codes before parsing", () => {
    const input = "\u001B[1m\u001B[31m⏺ Read: file.ts\u001B[0m";
    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "tool_use", tool: "read", detail: "file.ts" },
    ]);
  });

  it("should handle mixed ANSI and structured content", () => {
    const input = [
      "\u001B[32mAgent response:\u001B[0m",
      "Here is the fix.",
      "\u001B[33m⏺ Edit: src/main.ts\u001B[0m",
      "  applied changes",
      "── thinking ──",
    ].join("\n");

    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "message", content: "Agent response:\nHere is the fix." },
      { type: "tool_use", tool: "edit", detail: "src/main.ts" },
      { type: "message", content: "  applied changes" },
      { type: "status", state: "thinking" },
    ]);
  });

  it("should skip blank lines between content", () => {
    const input = "Hello\n\n\nWorld";
    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "message", content: "Hello\nWorld" },
    ]);
  });

  it("should handle permission prompts in output", () => {
    const input = "Running command...\nAllow? (y/n)\nContinuing...";
    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "message", content: "Running command..." },
      { type: "permission_request", action: "Allow? (y/n)" },
      { type: "message", content: "Continuing..." },
    ]);
  });

  it("should handle multiple tool uses in sequence", () => {
    const input = "⏺ Read: a.ts\n⏺ Read: b.ts\n⏺ Edit: c.ts";
    const events = parseOutput(input);
    expect(events).toEqual([
      { type: "tool_use", tool: "read", detail: "a.ts" },
      { type: "tool_use", tool: "read", detail: "b.ts" },
      { type: "tool_use", tool: "edit", detail: "c.ts" },
    ]);
  });

  it("should handle real-world Claude Code output with heavy ANSI", () => {
    // Simulate typical Claude Code output with nested SGR codes
    const input = [
      "\u001B[38;2;100;200;50m\u001B[1m⏺ Bash\u001B[0m\u001B[38;5;240m(npm test)\u001B[0m",
      "\u001B[2m  > vitest run\u001B[0m",
      "\u001B[32m  ✓ All tests passed\u001B[0m",
      "",
      "\u001B[1mDone.\u001B[0m",
    ].join("\n");

    const events = parseOutput(input);
    // Blank lines don't split messages — text accumulates until a structural event
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "tool_use",
      tool: "bash",
      detail: "npm test",
    });
    expect(events[1]).toEqual({
      type: "message",
      content: "  > vitest run\n  ✓ All tests passed\nDone.",
    });
  });
});
