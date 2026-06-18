import { parseFragment } from "parse5";
import { describe, it, expect } from "vitest";

import { sanitizeProposalHtml } from "../../src/services/proposal-sanitize.js";

/**
 * Walk the sanitizer OUTPUT through parse5 — the SAME spec-compliant parser a browser
 * (and iOS WKWebView `loadHTMLString`) uses — and collect anything that would execute
 * or fetch once the markup is live. This is the DOM-level mXSS gate (adj-200.2.3.1):
 * string assertions can be fooled by raw-text smuggling, so we assert on the parsed tree.
 */
function liveThreats(html: string): {
  eventHandlerAttrs: string[];
  scriptNodes: number;
  externalImgSrcs: string[];
} {
  // parse5 element node shape (subset we touch). Typed locally to avoid `any`.
  interface P5Attr {
    name: string;
    value: string;
  }
  interface P5Node {
    tagName?: string;
    nodeName: string;
    attrs?: P5Attr[];
    childNodes?: P5Node[];
  }
  const eventHandlerAttrs: string[] = [];
  const externalImgSrcs: string[] = [];
  let scriptNodes = 0;

  const walk = (node: P5Node): void => {
    if (node.tagName === "script") scriptNodes++;
    for (const attr of node.attrs ?? []) {
      if (/^on/i.test(attr.name)) eventHandlerAttrs.push(`${node.tagName}.${attr.name}`);
      if (node.tagName === "img" && attr.name === "src" && !/^data:/i.test(attr.value)) {
        externalImgSrcs.push(attr.value);
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parseFragment(html) as unknown as P5Node);

  return { eventHandlerAttrs, scriptNodes, externalImgSrcs };
}

/**
 * adj-200 QA (nova) — ADVERSARIAL probe suite. Each test encodes an attack the
 * existing regression suite did NOT cover. A FAILING test here is a real finding:
 * either a script-execution / external-fetch vector that survives sanitization, or
 * an over-aggressive transform that mangles legitimate content. Probe tests are
 * grouped by claimed-property so a failure names the violated contract.
 *
 * Convention: each `it` asserts the SAFE expectation. If it fails, the sanitizer
 * leaked the payload.
 */
describe("QA probe: sanitizer bypass attempts", () => {
  // ── External-resource (NFR-002 / SC-002): served doc must reference NOTHING external ──
  describe("external resource neutralization (NFR-002 / SC-002)", () => {
    it("PROBE: CSS-escaped url() function name in inline style", () => {
      // `\75rl(...)` decodes to `url(...)` in a real CSS parser, but layer-2's regex
      // matches the literal ascii `url(`. Browser would still fetch the external ref.
      const out = sanitizeProposalHtml(
        `<div style="background:\\75rl(https://evil.example.com/x.png)">x</div>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: CSS-escaped url() with full hex escape (\\000075)", () => {
      const out = sanitizeProposalHtml(
        `<div style="background:\\000075rl(https://evil.example.com/y.png)">x</div>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    // NOTE: `url/**/(...)` is INERT per CSS Syntax §4 (a function token requires the
    // ident immediately followed by `(`; an intervening comment breaks it), so it does
    // NOT fetch and is intentionally NOT treated as a finding here.

    it("PROBE: @import without trailing semicolon followed by real content", () => {
      // `@import url(...)` with no `;` — the greedy `[^;]*` should still strip the host.
      const out = sanitizeProposalHtml(
        `<style>@import url(https://evil.example.com/a.css)\n.safe{color:red}</style>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: image-set() external reference in CSS", () => {
      const out = sanitizeProposalHtml(
        `<div style="background:image-set(url(https://evil.example.com/2x.png) 2x)">x</div>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: SVG <image> href external reference", () => {
      const out = sanitizeProposalHtml(
        `<svg><image href="https://evil.example.com/i.png" /></svg>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: SVG <use> external href", () => {
      const out = sanitizeProposalHtml(
        `<svg><use href="https://evil.example.com/sprite.svg#x" /></svg>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: CSS @font-face src url external", () => {
      const out = sanitizeProposalHtml(
        `<style>@font-face{font-family:x;src:url(https://evil.example.com/f.woff2)}</style>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: <img srcset> external candidate", () => {
      const out = sanitizeProposalHtml(
        `<img srcset="https://evil.example.com/2x.png 2x" src="data:image/png;base64,iVBORw0KGgo=">`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("PROBE: <svg> fill via url() reference to external paint server", () => {
      const out = sanitizeProposalHtml(
        `<svg><rect fill="url(https://evil.example.com/p.svg#g)" width="10" height="10"/></svg>`,
      );
      expect(out).not.toContain("evil.example.com");
    });
  });

  // ── Script execution (NFR-001) ──
  describe("script-execution neutralization (NFR-001)", () => {
    it("PROBE: SVG <a> with href (non-xlink) javascript URI", () => {
      const out = sanitizeProposalHtml(
        `<svg><a href="javascript:alert(1)"><text x="0" y="0">x</text></a></svg>`,
      );
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out).not.toContain("alert");
    });

    it("PROBE: <style> breakout via stray </style> then <img onerror>", () => {
      const out = sanitizeProposalHtml(
        `<style>x{}</style><img src=x onerror="alert(1)">`,
      );
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out).not.toContain("alert");
    });

    it("PROBE: mXSS — <svg><style> harboring an img onerror", () => {
      const out = sanitizeProposalHtml(
        `<svg><style><img src=1 href=1 onerror=alert(1) //>`,
      );
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out).not.toContain("alert(1)");
    });

    it("PROBE: <title> RCDATA breakout (title is allowed as SVG element)", () => {
      // <title> is on the allowlist (SVG). In a body context the HTML parser treats
      // <title> as RCDATA, so an unescaped child could re-parse as markup → mXSS.
      const out = sanitizeProposalHtml(
        `<title><img src=x onerror=alert(1)></title>`,
      );
      // The dangerous markup must not survive as live markup. Acceptable outcomes:
      // title stripped, or its content escaped. It must NOT contain a live onerror img.
      expect(out).not.toMatch(/<img[^>]+onerror/i);
    });

    it("PROBE: noscript-wrapped payload (parsing-mode confusion)", () => {
      const out = sanitizeProposalHtml(
        `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>`,
      );
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out).not.toContain("alert(1)");
    });

    it("PROBE: javascript URI with embedded tab/newline/entities in href", () => {
      const out = sanitizeProposalHtml(
        `<a href="java\tscript:alert(1)">x</a><a href="java&#09;script:alert(1)">y</a>`,
      );
      expect(out).not.toMatch(/script:alert/i);
    });

    it("PROBE: <a href> data:text/html (navigable script context)", () => {
      // data:text/html on <a href> would open an attacker-controlled HTML doc on click.
      const out = sanitizeProposalHtml(
        `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
      );
      expect(out.toLowerCase()).not.toContain("data:text/html");
    });

    it("PROBE: event handler with uppercase + surrounding whitespace", () => {
      const out = sanitizeProposalHtml(
        `<div OnClick = "alert(1)">x</div><div\nonmouseover="alert(2)">y</div>`,
      );
      expect(out.toLowerCase()).not.toContain("onclick");
      expect(out.toLowerCase()).not.toContain("onmouseover");
      expect(out).not.toContain("alert");
    });
  });

  // ── Over-aggressive transform (correctness — legitimate content must survive) ──
  describe("legitimate content preservation (correctness)", () => {
    it("PROBE: literal text 'url(http://x)' in a <code> block is mangled by layer-2", () => {
      // Layer-2 operates on the whole doc string, so it rewrites url(...) even inside
      // visible code/text. Documenting: a user writing CSS docs loses their example.
      const out = sanitizeProposalHtml(
        `<pre><code>background: url(https://example.com/a.png)</code></pre>`,
      );
      // The visible example URL should be preserved in displayed text. If this fails,
      // layer-2 is corrupting innocent prose/code (warning-level correctness bug).
      expect(out).toContain("https://example.com/a.png");
    });

    it("PROBE: data:image/svg+xml in CSS background is preserved", () => {
      const out = sanitizeProposalHtml(
        `<div style="background:url(data:image/svg+xml,%3Csvg%3E%3C/svg%3E)">x</div>`,
      );
      expect(out).toContain("data:image/svg+xml");
    });
  });

  // ── DOM-level mXSS gate (adj-200.2.3.1): re-parse OUTPUT through parse5 and assert ──
  // ── the live tree carries no script / event-handler / external-fetch nodes.        ──
  describe("spec-parser re-parse leaves no live threats (NFR-001 / NFR-002)", () => {
    // Each payload is a known parser-confusion / mutation-XSS vector. After sanitize,
    // a browser-equivalent re-parse of the output must yield ZERO live event handlers,
    // ZERO live <script>, and ZERO external <img src>.
    const mutationVectors: [string, string][] = [
      ["svg>style harbors img onerror", `<svg><style><img src=1 href=1 onerror=alert(1) //>`],
      ["svg>style breakout to script", `<svg><style></style><script>alert(1)</script></svg>`],
      ["math>style harbors img onerror", `<math><style><img src=1 onerror=alert(1)></style></math>`],
      ["noscript-wrapped onerror img", `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>`],
      ["title RCDATA breakout", `<title><img src=x onerror=alert(1)></title>`],
      ["stray </style> then onerror img", `<style>x{}</style><img src=x onerror="alert(1)">`],
    ];

    for (const [name, payload] of mutationVectors) {
      it(`PROBE(DOM): "${name}" yields no live handler/script/external-img after re-parse`, () => {
        const threats = liveThreats(sanitizeProposalHtml(payload));
        expect(threats.eventHandlerAttrs).toEqual([]);
        expect(threats.scriptNodes).toBe(0);
        expect(threats.externalImgSrcs).toEqual([]);
      });
    }

    it("PROBE(DOM): a legitimate data: image survives the re-parse as a real node", () => {
      // Sanity: the gate is not vacuously passing by nuking everything. A safe data:
      // image must remain a live <img> with its data: src intact (no external src).
      const out = sanitizeProposalHtml(
        `<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">`,
      );
      const threats = liveThreats(out);
      expect(threats.eventHandlerAttrs).toEqual([]);
      expect(threats.externalImgSrcs).toEqual([]);
      expect(out).toContain("data:image/png;base64");
    });
  });
});
