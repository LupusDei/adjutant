/**
 * adj-139.5 (Track E) — `transition: all` is banned in stylesheets.
 *
 * Two reasons, one of them a rule violation rather than a micro-optimization:
 *
 * 1. The theme system swaps `[data-theme]` on the root, which changes padding,
 *    border-width, border-radius, font-weight and font-size on the SAME
 *    elements that carry the transition. Under `transition: all` those become
 *    ANIMATED LAYOUT PROPERTIES on every theme switch — explicitly forbidden by
 *    .claude/rules/05-ui-theme.md ("Avoid animating layout properties").
 * 2. `all` makes the browser set up a transition for every animatable property
 *    on every state change, on elements (buttons, nav tabs) that exist in bulk.
 *
 * The fix is to name the properties each rule's own :hover/:active/:focus/.active
 * states actually change. This test keeps it from drifting back — a one-time
 * cleanup without a guard is just a slower regression.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const STYLE_ROOT = join(__dirname, "../../src");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("CSS transition budget (adj-139.5)", () => {
  it("should find stylesheets to check", () => {
    // Guards against the suite silently passing because the glob broke.
    expect(cssFiles(STYLE_ROOT).length).toBeGreaterThan(0);
  });

  it("should not use `transition: all` in any stylesheet", () => {
    const offenders: string[] = [];

    for (const file of cssFiles(STYLE_ROOT)) {
      // Strip comments first — prose ABOUT this rule (including the comments
      // explaining why a given rule stopped using `all`) is not a violation.
      // Newlines inside comments are preserved so reported line numbers stay true.
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
        m.replace(/[^\n]/g, " "),
      );
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        // `transition: all ...` and the longhand `transition-property: all`.
        if (/transition(-property)?\s*:\s*[^;]*\ball\b/.test(line)) {
          offenders.push(`${relative(STYLE_ROOT, file)}:${i + 1} — ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
