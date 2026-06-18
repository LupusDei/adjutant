/**
 * adj-201.6.1 — Proposal-page drift-lint.
 *
 * Enforcement of the per-project style guide + dark/accessible/friendly baseline
 * (spec 059) is AUTHORING-ONLY: the server never injects project tokens into a
 * published page. Agents read the guide via `get_project_style` and author the page
 * to match. This module is the SAFETY NET for that model — a static linter that
 * inspects a COMPOSED / published proposal HTML document and reports when it has
 * drifted off-brand, lost dark-mode support, or broken accessibility basics.
 *
 * It is intentionally a lightweight STATIC inspection (string/regex), not a full
 * DOM or CSS engine: it runs in CI / QA flows where a heavy headless browser is
 * undesirable, and it only needs to catch the obvious, high-signal drifts. False
 * negatives (a subtle contrast failure it cannot see) are acceptable; false
 * positives on the shipped compliant baseline are NOT — every check below is
 * validated against a real `composeProposalDocument(...)` output in the test suite.
 */

import { isValidHexColor } from "./projects-service.js";

/** Severity of a single drift finding. `error` flips `ok` to false; `warning` does not. */
export type LintSeverity = "error" | "warning";

/** A machine-readable lint finding code (stable identifiers for callers/CI). */
export type LintFindingCode =
  | "missing-accent-color"
  | "invalid-expected-color"
  | "no-dark-mode"
  | "missing-lang"
  | "missing-landmark"
  | "contrast-red-flag";

export interface LintFinding {
  code: LintFindingCode;
  severity: LintSeverity;
  message: string;
}

export interface LintProposalPageOptions {
  /**
   * The project's primary brand color (hex, `#RGB` or `#RRGGBB`). When provided, the
   * lint flags the doc if that color does not appear anywhere in it. When omitted, the
   * accent check is skipped entirely (a page for a project with no style guide is valid).
   */
  expectedBrandColor?: string | undefined;
}

export interface LintProposalPageResult {
  findings: LintFinding[];
  /** True when there are zero `error`-severity findings. */
  ok: boolean;
}

/**
 * Expand a hex color to its canonical lowercase 6-digit form so `#RGB` and `#RRGGBB`
 * compare equal: `#F60` → `ff6600`, `#ff6600` → `ff6600`. Returns null for non-hex
 * input. The `#` is dropped so we can match either `#ff6600` or bare `ff6600` in the
 * document text.
 */
function normalizeHex(value: string): string | null {
  if (!isValidHexColor(value)) {
    return null;
  }
  const hex = value.slice(1).toLowerCase();
  if (hex.length === 3) {
    // #RGB → #RRGGBB by doubling each nibble.
    return hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return hex;
}

/**
 * Collect every hex color literal that appears in the document, each normalized to its
 * canonical 6-digit lowercase form, so the accent comparison is robust to case and to
 * `#RGB` vs `#RRGGBB` shorthand on EITHER side.
 */
function collectNormalizedHexes(html: string): Set<string> {
  const out = new Set<string>();
  const re = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const normalized = normalizeHex(match[0]);
    if (normalized) {
      out.add(normalized);
    }
  }
  return out;
}

/** (a) Accent-color presence — only when an expected brand color is supplied. */
function checkAccentColor(html: string, expected: string | undefined, findings: LintFinding[]): void {
  if (expected === undefined) {
    return; // No project guide → nothing to enforce.
  }

  const normalizedExpected = normalizeHex(expected);
  if (normalizedExpected === null) {
    findings.push({
      code: "invalid-expected-color",
      severity: "error",
      message: `expectedBrandColor "${expected}" is not a valid hex color (#RGB or #RRGGBB); cannot lint accent presence.`,
    });
    return;
  }

  const present = collectNormalizedHexes(html);
  if (!present.has(normalizedExpected)) {
    findings.push({
      code: "missing-accent-color",
      severity: "error",
      message: `Expected brand color #${normalizedExpected} does not appear anywhere in the proposal page — the page has drifted off-brand.`,
    });
  }
}

/** (b) Dark-mode support — a `prefers-color-scheme` query OR a theme-toggle mechanism. */
function checkDarkMode(html: string, findings: LintFinding[]): void {
  const hasMediaQuery = /prefers-color-scheme/i.test(html);
  // The baseline ships a CSS-only checkbox toggle; recognize the toggle by its hook
  // class (the composed page) or a generic theme-toggle affordance an author might use.
  const hasToggle = /proposal-doc__theme-(?:input|toggle)/.test(html) || /theme-toggle/i.test(html);

  if (!hasMediaQuery && !hasToggle) {
    findings.push({
      code: "no-dark-mode",
      severity: "error",
      message:
        "No dark-mode support detected: the page has neither a `prefers-color-scheme` media query nor a theme-toggle mechanism. Pages are dark-by-default and must honor the reader's color-scheme preference.",
    });
  }
}

/** (c) a11y basics — `lang`, a semantic landmark, and an obvious static contrast red-flag. */
function checkAccessibility(html: string, findings: LintFinding[]): void {
  // lang: the <html> open tag must carry a non-empty lang attribute.
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  const hasLang = htmlTag !== null && /\blang\s*=\s*["']?[^"'\s>]+/i.test(htmlTag[0]);
  if (!hasLang) {
    findings.push({
      code: "missing-lang",
      severity: "error",
      message: "The <html> element is missing a `lang` attribute — screen readers cannot determine the document language.",
    });
  }

  // landmark: at least one <main> or <header> semantic landmark.
  const hasLandmark = /<main\b/i.test(html) || /<header\b/i.test(html);
  if (!hasLandmark) {
    findings.push({
      code: "missing-landmark",
      severity: "error",
      message: "No semantic landmark found (<main> or <header>) — the page lacks navigable document structure.",
    });
  }

  checkContrastRedFlag(html, findings);
}

/**
 * A deliberately conservative STATIC contrast red-flag: flag any inline style or CSS
 * rule that sets an explicit `color` and `background-color` to the SAME hex value
 * (text the exact color of its own background → invisible). This is the one contrast
 * failure detectable without a layout/cascade engine; we do not attempt full WCAG
 * ratio math (that needs resolved computed styles). A real `composeProposalDocument`
 * output never sets matching color/background, so the compliant baseline stays clean.
 */
function checkContrastRedFlag(html: string, findings: LintFinding[]): void {
  // Match declaration blocks (between { } or within a style="" attribute is harder to
  // bound; we scan the whole doc for co-located color + background-color declarations
  // within a small window and compare their hex values).
  const declRe = /\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  const flagged = (): void => {
    findings.push({
      code: "contrast-red-flag",
      severity: "error",
      message:
        "Found a rule where `color` and `background-color` are the same value — text would be invisible against its background (a contrast red-flag).",
    });
  };

  const sameColorBg = (segment: string): boolean => {
    const color = /(?:^|[;{\s])color\s*:\s*(#[0-9a-fA-F]{3,6})\b/i.exec(segment);
    const bg = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})\b/i.exec(segment);
    if (!color?.[1] || !bg?.[1]) {
      return false;
    }
    const c = normalizeHex(color[1]);
    const b = normalizeHex(bg[1]);
    return c !== null && b !== null && c === b;
  };

  while ((block = declRe.exec(html)) !== null) {
    if (block[1] !== undefined && sameColorBg(block[1])) {
      flagged();
      return;
    }
  }

  // Also scan inline style="" attributes (no surrounding braces).
  const styleAttrRe = /style\s*=\s*["']([^"']*)["']/gi;
  let attr: RegExpExecArray | null;
  while ((attr = styleAttrRe.exec(html)) !== null) {
    if (attr[1] !== undefined && sameColorBg(attr[1])) {
      flagged();
      return;
    }
  }
}

/**
 * Statically inspect a composed/published proposal HTML document for style-guide and
 * accessibility drift. See the module docstring for the enforcement model.
 *
 * @param html  The full composed document (output of `composeProposalDocument`, or a
 *              published page fetched from `GET /p/:token`).
 * @param opts  Optional `expectedBrandColor` to assert accent presence.
 * @returns     `{ findings, ok }` — `ok` is true iff there are no `error` findings.
 */
export function lintProposalPage(html: string, opts: LintProposalPageOptions = {}): LintProposalPageResult {
  const findings: LintFinding[] = [];
  const doc = html ?? "";

  checkAccentColor(doc, opts.expectedBrandColor, findings);
  checkDarkMode(doc, findings);
  checkAccessibility(doc, findings);

  const ok = findings.every((f) => f.severity !== "error");
  return { findings, ok };
}
