/**
 * Artifacts may run JavaScript — but may not TALK (adj-artifact-js).
 *
 * Artifacts were static-only: the sanitizer stripped <script> and on* handlers, the document CSP
 * forbade scripts, and the viewer iframe withheld allow-scripts. That made charts, toggles,
 * simulations and any interactive page impossible to author.
 *
 * The containment that replaces "no scripts" is NOT origin isolation, because origin isolation
 * does not hold here: the backend runs `app.use(cors())` (wildcard Access-Control-Allow-Origin)
 * and apiKeyAuth is in open mode with zero keys configured, so ANY script — even one in an
 * opaque-origin sandboxed iframe — could fetch the fleet API and read messages, agents and beads.
 *
 * So the rule is: SCRIPTS MAY RUN, SCRIPTS MAY NOT TALK. `connect-src 'none'` plus
 * `default-src 'none'` removes fetch/XHR/WebSocket/beacon and outbound image loads, which is the
 * exfiltration surface. Everything a good artifact needs (DOM, canvas, animation, state) is local
 * and unaffected.
 *
 * PROPOSALS ARE DELIBERATELY UNCHANGED. They share the sanitizer module but not this contract, so
 * every test here has a proposal-side counterpart proving scripts are still stripped there.
 */

import { describe, it, expect } from "vitest";

import { sanitizeProposalHtml, sanitizeArtifactHtml } from "../../src/services/proposal-sanitize.js";
import { composeArtifactDocument, ARTIFACT_DOCUMENT_CSP } from "../../src/services/artifact-html.js";
import type { Artifact } from "../../src/types/artifacts.js";

function artifact(html: string): Artifact {
  return {
    id: "a1",
    title: "Interactive",
    html,
    isPublic: false,
    createdAt: "2026-08-30 00:00:00",
    updatedAt: "2026-08-30 00:00:00",
  };
}

describe("sanitizeArtifactHtml — inline scripts survive", () => {
  it("should preserve an inline <script> and its body verbatim, including < and & operators", () => {
    const html = '<div id="app"></div><script>const a=1; if (a<2 && a>0) { render("ok") }</script>';

    const out = sanitizeArtifactHtml(html);

    expect(out).toContain("<script>");
    // The body must not be entity-mangled — `a<2 && a>0` has to survive as executable JS.
    expect(out).toContain("a<2 && a>0");
  });

  it("should preserve on* event handlers", () => {
    const out = sanitizeArtifactHtml('<button onclick="toggle()">Toggle</button>');

    expect(out).toContain("onclick");
  });

  it("should still DROP an external script src — self-containment is not negotiable", () => {
    const out = sanitizeArtifactHtml('<script src="https://evil.example/x.js"></script>');

    expect(out).not.toContain("evil.example");
    expect(out).not.toMatch(/src\s*=/i);
  });

  it("should still strip external stylesheets and remote images", () => {
    const out = sanitizeArtifactHtml(
      '<link rel="stylesheet" href="https://evil.example/a.css"><img src="https://evil.example/p.png">',
    );

    expect(out).not.toContain("evil.example");
  });

  it("should survive the mXSS re-parse fixpoint without corrupting script text", () => {
    const html = "<svg><style><script>if(1<2){go()}</script></style></svg><script>keep(2>1)</script>";

    const out = sanitizeArtifactHtml(html);

    // Stable output: sanitizing again changes nothing (the fixpoint held).
    expect(sanitizeArtifactHtml(out)).toBe(out);
    expect(out).toContain("keep(2>1)");
  });
});

describe("sanitizeProposalHtml — REGRESSION: proposals stay script-free", () => {
  it("should still strip <script> from a proposal", () => {
    const out = sanitizeProposalHtml('<p>hi</p><script>steal()</script>');

    expect(out).not.toContain("<script");
    expect(out).not.toContain("steal()");
    expect(out).toContain("<p>hi</p>");
  });

  it("should still strip on* handlers from a proposal", () => {
    const out = sanitizeProposalHtml('<button onclick="steal()">x</button>');

    expect(out).not.toContain("onclick");
  });
});

describe("ARTIFACT_DOCUMENT_CSP — run, but do not talk", () => {
  it("should permit inline scripts", () => {
    expect(ARTIFACT_DOCUMENT_CSP).toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("should forbid every outbound channel a script could exfiltrate through", () => {
    // fetch / XHR / WebSocket / sendBeacon
    expect(ARTIFACT_DOCUMENT_CSP).toMatch(/connect-src 'none'/);
    // no remote anything by default
    expect(ARTIFACT_DOCUMENT_CSP).toMatch(/default-src 'none'/);
    // image beacons: data: only, never a remote host
    expect(ARTIFACT_DOCUMENT_CSP).not.toMatch(/img-src[^;]*https?:/);
    expect(ARTIFACT_DOCUMENT_CSP).toMatch(/form-action 'none'/);
    expect(ARTIFACT_DOCUMENT_CSP).toMatch(/base-uri 'none'/);
  });

  it("should not permit a remote script host", () => {
    expect(ARTIFACT_DOCUMENT_CSP).not.toMatch(/script-src[^;]*https?:/);
  });
});

describe("composeArtifactDocument — end to end", () => {
  it("should carry a working inline script through into the composed document", () => {
    const doc = composeArtifactDocument(
      artifact('<div id="c"></div><script>document.getElementById("c").textContent = 1+1;</script>'),
    );

    expect(doc).toContain("<script>");
    expect(doc).toContain("1+1");
    expect(doc).toContain(ARTIFACT_DOCUMENT_CSP);
  });

  it("should still refuse to embed an external script even inside a full document", () => {
    const doc = composeArtifactDocument(artifact('<script src="https://evil.example/x.js"></script>'));

    expect(doc).not.toContain("evil.example");
  });
});
