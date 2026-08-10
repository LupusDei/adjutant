import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import { parse } from "parse5";
import type Database from "better-sqlite3";

import { composeArtifactDocument } from "../../src/services/artifact-html.js";
import type { Artifact } from "../../src/types/artifacts.js";
import type { ArtifactStore } from "../../src/services/artifact-store.js";

/**
 * adj-j7az6.5.1 — SECURITY-CRITICAL. The public route `GET /a/:token` serves the composed
 * artifact document to UNAUTHENTICATED viewers, so the sanitizer inside
 * {@link composeArtifactDocument} is the load-bearing boundary. This suite is a regression
 * gate that mirrors the proposal XSS/mXSS corpus (adj-200.2.3 /
 * proposal-sanitize{,-qa-probe}.test.ts) but drives it through the ARTIFACT composition +
 * public HTTP surface.
 *
 * Every known vector — <script>, inline on* handlers, javascript: URLs, external
 * http(s)/protocol-relative resource refs, <iframe>/<object>/<embed>, and the classic
 * mutation-XSS `<svg><style><img onerror>` re-parse — must be NEUTRALIZED both in the
 * composed string AND in a spec-compliant (parse5) re-parse of the served document.
 */

// ── parse5 DOM-level threat collector (browser / WKWebView-equivalent parse) ──
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

/**
 * Re-parse a FULL composed document through parse5 and collect anything that would execute
 * or fetch once the markup is live: on* event-handler attributes, <script> nodes,
 * <iframe>/<object>/<embed> nodes, and any resource attribute (src/href/xlink:href/srcset)
 * whose value is external (http(s), protocol-relative, or javascript:). String assertions
 * can be fooled by raw-text smuggling — the parsed tree cannot.
 */
function liveThreats(html: string): {
  eventHandlerAttrs: string[];
  scriptNodes: number;
  externalResourceRefs: string[];
  iframeLikeNodes: string[];
} {
  const eventHandlerAttrs: string[] = [];
  const externalResourceRefs: string[] = [];
  const iframeLikeNodes: string[] = [];
  let scriptNodes = 0;

  const isExternal = (value: string): boolean =>
    /^\s*(?:https?:)?\/\//i.test(value) || /^\s*javascript:/i.test(value);

  const walk = (node: P5Node): void => {
    const tag = node.tagName;
    if (tag === "script") scriptNodes++;
    if (tag === "iframe" || tag === "object" || tag === "embed") iframeLikeNodes.push(tag);
    for (const attr of node.attrs ?? []) {
      if (/^on/i.test(attr.name)) eventHandlerAttrs.push(`${tag}.${attr.name}`);
      // src/href/xlink:href/srcset on any element must be data: or in-document only.
      if (/^(?:src|href|xlink:href|srcset)$/i.test(attr.name) && isExternal(attr.value)) {
        externalResourceRefs.push(`${tag}.${attr.name}=${attr.value}`);
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parse(html) as unknown as P5Node);

  return { eventHandlerAttrs, scriptNodes, externalResourceRefs, iframeLikeNodes };
}

/** Build a minimal Artifact around a hostile html body (title kept benign). */
function artifactWith(html: string, title = "Artifact"): Artifact {
  const now = new Date().toISOString();
  return {
    id: "art-test",
    title,
    html,
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Compose the public document for a hostile html body. */
function compose(html: string, title = "Artifact"): string {
  return composeArtifactDocument(artifactWith(html, title));
}

describe("public artifact document — XSS/mXSS neutralization (composeArtifactDocument)", () => {
  describe("script execution (must be neutralized)", () => {
    it("should strip <script> blocks", () => {
      const out = compose(`<p>ok</p><script>alert('xss')</script>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
      expect(out).toContain("ok");
    });

    it("should strip case-varied <SCRIPT> tags", () => {
      const out = compose(`<SCRIPT>alert(1)</SCRIPT><ScRiPt>alert(2)</ScRiPt><p>keep</p>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
      expect(out).toContain("keep");
    });

    it("should strip <script> nested inside <svg>", () => {
      const out = compose(`<svg><script>alert('svg')</script><path d="M0 0"/></svg>`);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toContain("alert");
      expect(out).toMatch(/<svg/i);
      expect(out).toMatch(/<path/i);
    });

    it("should strip inline event handlers (onerror, onclick, onload, onmouseover)", () => {
      const out = compose(
        `<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">` +
          `<div onclick="steal()" onload="boom()">hi</div>` +
          `<div\nonmouseover="alert(2)">y</div>`,
      );
      const lower = out.toLowerCase();
      expect(lower).not.toContain("onerror");
      expect(lower).not.toContain("onclick");
      expect(lower).not.toContain("onload");
      expect(lower).not.toContain("onmouseover");
      expect(out).not.toContain("alert");
      expect(out).not.toContain("steal");
      // legitimate data: image survives
      expect(out).toMatch(/data:image\/png/);
    });

    it("should strip event handlers with uppercase names and surrounding whitespace", () => {
      const out = compose(`<div OnClick = "alert(1)">x</div>`);
      expect(out.toLowerCase()).not.toContain("onclick");
      expect(out).not.toContain("alert");
    });

    it("should strip javascript: URLs in href", () => {
      const out = compose(`<a href="javascript:alert(document.cookie)">click</a>`);
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out).not.toContain("alert");
      expect(out).toContain("click");
    });

    it("should strip obfuscated javascript: URLs (tab/entity split)", () => {
      const out = compose(
        `<a href="java\tscript:alert(1)">x</a><a href="java&#09;script:alert(1)">y</a>`,
      );
      expect(out).not.toMatch(/script:alert/i);
    });

    it("should strip data:text/html in <a href> (navigable script context)", () => {
      const out = compose(`<a href="data:text/html,<script>alert(1)</script>">x</a>`);
      expect(out.toLowerCase()).not.toContain("data:text/html");
    });

    it("should reject non-image data: URIs in <img src>", () => {
      const out = compose(`<img src="data:text/html,<script>alert(1)</script>">`);
      expect(out).not.toContain("text/html");
      expect(out.toLowerCase()).not.toContain("alert");
    });

    it("should strip javascript: in an SVG anchor (xlink and plain href)", () => {
      const out = compose(
        `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a>` +
          `<a href="javascript:alert(2)"><text>y</text></a></svg>`,
      );
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out).not.toContain("alert");
    });
  });

  describe("external resource references (self-contained guarantee)", () => {
    it("should strip external http(s) <img src>", () => {
      const out = compose(`<img src="https://evil.example.com/pixel.png?c=secret">`);
      expect(out).not.toContain("evil.example.com");
      expect(out).not.toMatch(/src=["']https?:/i);
    });

    it("should strip protocol-relative <img src>", () => {
      const out = compose(`<img src="//evil.example.com/p.png">`);
      expect(out).not.toContain("evil.example.com");
    });

    it("should strip external <img srcset> candidates", () => {
      const out = compose(
        `<img srcset="https://evil.example.com/2x.png 2x" src="data:image/png;base64,iVBORw0KGgo=">`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize external url() in inline style", () => {
      const out = compose(`<div style="background-image:url('https://evil.example.com/bg.png')">x</div>`);
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize external url() and @import inside a <style> block", () => {
      const out = compose(
        `<style>@import url("https://evil.example.com/a.css"); body{background:url(https://evil.example.com/b.png)}</style>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize CSS-escaped url() function name (\\75rl / \\000075rl)", () => {
      const out = compose(
        `<div style="background:\\75rl(https://evil.example.com/x.png)">a</div>` +
          `<div style="background:\\000075rl(https://evil.example.com/y.png)">b</div>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize @font-face src url external", () => {
      const out = compose(
        `<style>@font-face{font-family:x;src:url(https://evil.example.com/f.woff2)}</style>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should neutralize external SVG <image>/<use>/paint-server references", () => {
      const out = compose(
        `<svg><image href="https://evil.example.com/i.png"/>` +
          `<use href="https://evil.example.com/sprite.svg#x"/>` +
          `<rect fill="url(https://evil.example.com/p.svg#g)" width="4" height="4"/></svg>`,
      );
      expect(out).not.toContain("evil.example.com");
    });

    it("should preserve an in-document #fragment paint reference (self-contained)", () => {
      const out = compose(
        `<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="4" height="4"/></svg>`,
      );
      expect(out).toContain("url(#g)");
    });

    it("should neutralize CSS expression() and javascript: inside url()", () => {
      const out = compose(
        `<div style="width:expression(alert(1))">x</div>` +
          `<div style="background:url(javascript:alert(1))">y</div>`,
      );
      expect(out.toLowerCase()).not.toContain("expression(");
      expect(out.toLowerCase()).not.toContain("javascript:");
    });
  });

  describe("embedded frames / plugins (must be stripped)", () => {
    it("should strip <iframe>, <object>, and <embed>", () => {
      const out = compose(
        `<iframe src="https://evil.example.com"></iframe>` +
          `<object data="evil.swf"></object>` +
          `<embed src="evil.swf">`,
      );
      expect(out).not.toMatch(/<iframe/i);
      expect(out).not.toMatch(/<object/i);
      expect(out).not.toMatch(/<embed/i);
      expect(out).not.toContain("evil.example.com");
    });
  });

  describe("mutation-XSS (mXSS) — must not resurrect a live handler on re-parse", () => {
    // The signature mXSS vector: <svg><style> content is RAWTEXT inside <svg>, but when the
    // sanitized output is re-parsed by a spec-compliant HTML parser it can foreign-content
    // switch and turn `<img ... onerror=...>` back into a LIVE element. The compose pipeline
    // runs a parse5 re-serialize fixpoint to defeat this.
    it("should neutralize <svg><style><img src=x onerror=alert(1)> (string level)", () => {
      const out = compose(`<svg><style><img src=x onerror=alert(1) //></style></svg>`);
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out).not.toContain("alert(1)");
    });

    const mutationVectors: [string, string][] = [
      ["svg>style harbors img onerror", `<svg><style><img src=1 href=1 onerror=alert(1) //>`],
      ["svg>style breakout to script", `<svg><style></style><script>alert(1)</script></svg>`],
      ["math>style harbors img onerror", `<math><style><img src=1 onerror=alert(1)></style></math>`],
      ["noscript-wrapped onerror img", `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>`],
      ["title RCDATA breakout", `<title><img src=x onerror=alert(1)></title>`],
      ["stray </style> then onerror img", `<style>x{}</style><img src=x onerror="alert(1)">`],
    ];

    for (const [name, payload] of mutationVectors) {
      it(`re-parse of composed doc yields no live handler/script/external-img: "${name}"`, () => {
        const threats = liveThreats(compose(payload));
        expect(threats.eventHandlerAttrs).toEqual([]);
        expect(threats.scriptNodes).toBe(0);
        expect(threats.externalResourceRefs).toEqual([]);
        expect(threats.iframeLikeNodes).toEqual([]);
      });
    }

    it("should NOT be vacuously safe — a legitimate data: image survives re-parse as a real node", () => {
      const out = compose(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">`);
      const threats = liveThreats(out);
      expect(threats.eventHandlerAttrs).toEqual([]);
      expect(threats.externalResourceRefs).toEqual([]);
      expect(out).toContain("data:image/png;base64");
    });
  });

  describe("legitimate content preservation (correctness)", () => {
    it("should preserve semantic markup, inline styles, <style> blocks, and inline SVG", () => {
      const out = compose(
        `<style>.doc h1{color:#222}</style>` +
          `<h1 class="doc">Title</h1><p style="color:red">styled</p>` +
          `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#abc"/></svg>` +
          `<pre><code>const x = 1;</code></pre>`,
      );
      expect(out).toMatch(/<style/i);
      expect(out).toContain("color:#222");
      expect(out).toMatch(/<h1[ >]/i);
      expect(out).toContain("color:red");
      expect(out).toMatch(/<svg[ >]/i);
      expect(out).toMatch(/<rect[ >]/i);
      expect(out).toContain("const x = 1;");
    });
  });
});

// ── End-to-end: the SAME corpus must be neutralized through the public HTTP surface ──
describe("GET /a/:token — hostile artifacts are neutralized end-to-end", () => {
  let testDir: string;
  let db: Database.Database;
  let app: express.Express;
  let store: ArtifactStore;

  function freshTestDir(): string {
    const dir = join(
      tmpdir(),
      `adjutant-artifact-sec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Persist + publish a hostile artifact, returning its share token. */
  function publishHostile(html: string, title = "Hostile"): string {
    const created = store.createArtifact({ title, html, slug: "hostile" });
    const published = store.publishArtifact(created.id);
    return published?.shareToken ?? "";
  }

  beforeEach(async () => {
    testDir = freshTestDir();
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    db = createDatabase(join(testDir, "test.db"));
    runMigrations(db);

    const { createArtifactStore } = await import("../../src/services/artifact-store.js");
    const { createPublicArtifactsRouter } = await import("../../src/routes/public-artifacts.js");
    store = createArtifactStore(db);

    app = express();
    app.use("/a", createPublicArtifactsRouter(store));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should serve a script/handler/external-ref-laden artifact with ALL vectors neutralized", async () => {
    const token = publishHostile(
      `<h1>hello</h1>` +
        `<script>alert('pwn')</script>` +
        `<img src="https://evil.example.com/pixel.png" onerror="alert(2)">` +
        `<a href="javascript:alert(3)">x</a>` +
        `<iframe src="https://evil.example.com"></iframe>` +
        `<svg><style><img src=1 onerror=alert(4) //></style></svg>`,
    );

    const res = await request(app).get(`/a/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    const body = res.text;
    // string-level
    expect(body).not.toMatch(/<script/i);
    expect(body.toLowerCase()).not.toContain("onerror");
    expect(body.toLowerCase()).not.toContain("javascript:");
    expect(body).not.toMatch(/<iframe/i);
    expect(body).not.toContain("evil.example.com");
    expect(body).not.toContain("alert");
    // legitimate content survives
    expect(body).toContain("hello");

    // DOM-level: re-parse the served document — zero live threats.
    const threats = liveThreats(body);
    expect(threats.eventHandlerAttrs).toEqual([]);
    expect(threats.scriptNodes).toBe(0);
    expect(threats.externalResourceRefs).toEqual([]);
    expect(threats.iframeLikeNodes).toEqual([]);
  });

  it("should set a strict deny-by-default CSP header on the served document", async () => {
    const token = publishHostile(`<p>ok</p>`);
    const res = await request(app).get(`/a/${token}`);
    const csp = res.headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    // no script-src permits execution
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/i);
  });

  it("should neutralize the same vectors on the /download surface", async () => {
    const token = publishHostile(
      `<script>alert(1)</script><img src="https://evil.example.com/x.png" onerror="alert(2)">`,
    );
    const res = await request(app).get(`/a/${token}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const body = res.text;
    expect(body).not.toMatch(/<script/i);
    expect(body.toLowerCase()).not.toContain("onerror");
    expect(body).not.toContain("evil.example.com");
    const threats = liveThreats(body);
    expect(threats.eventHandlerAttrs).toEqual([]);
    expect(threats.scriptNodes).toBe(0);
    expect(threats.externalResourceRefs).toEqual([]);
  });
});
