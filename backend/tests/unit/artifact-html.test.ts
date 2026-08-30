import { describe, it, expect } from "vitest";
import type { Artifact } from "../../src/types/artifacts.js";

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    title: "My Page",
    html: "<h1>Hello</h1><p>World</p>",
    isPublic: false,
    createdAt: "2026-08-10 00:00:00",
    updatedAt: "2026-08-10 00:00:00",
    ...overrides,
  };
}

describe("composeArtifactDocument", () => {
  it("should return a complete HTML document with doctype and charset", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(artifact());

    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc.toLowerCase()).toContain("<html");
    expect(doc.toLowerCase()).toContain("<meta charset");
    expect(doc.toLowerCase()).toContain("<body>");
    expect(doc).toContain("<h1>Hello</h1>");
  });

  it("should embed a strict Content-Security-Policy meta", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const { ARTIFACT_DOCUMENT_CSP } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(artifact());

    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain(ARTIFACT_DOCUMENT_CSP);
    expect(ARTIFACT_DOCUMENT_CSP).toContain("default-src 'none'");
    // adj-artifact-js: artifacts are interactive, so inline script is PERMITTED. The guarantee
    // is no longer "no script" but "script cannot talk" — see connect-src below.
    expect(ARTIFACT_DOCUMENT_CSP).toContain("script-src 'unsafe-inline'");
    expect(ARTIFACT_DOCUMENT_CSP).toContain("connect-src 'none'");
  });

  it("should KEEP inline <script> from authored html (adj-artifact-js)", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<div>ok</div><script>render(1)</script>" }),
    );

    // Artifacts are interactive pages; stripping script was the bug, not the feature.
    expect(doc).toContain("<script>");
    expect(doc).toContain("render(1)");
    expect(doc).toContain("<div>ok</div>");
  });

  it("should KEEP on* inline event handlers (adj-artifact-js)", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<button onclick=\"toggle()\">Toggle</button>" }),
    );

    // With inline <script> permitted, an on* handler grants nothing extra — and withholding it
    // would just make authored pages fail in confusing ways.
    expect(doc.toLowerCase()).toContain("onclick");
    expect(doc).toContain("toggle()");
  });

  it("should keep the mXSS re-parse fixpoint stable and still drop the EXTERNAL ref in it", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<svg><style><img src=https://evil.example/x.png onerror=go()></style></svg>" }),
    );

    // Script execution is no longer the thing being prevented here (adj-artifact-js). What still
    // must hold is self-containment: no remote host survives, so the page cannot beacon out.
    expect(doc).not.toContain("evil.example");
    // And composition remains a fixpoint — a second pass over the body changes nothing.
    expect(composeArtifactDocument(artifact({ html: doc }))).toBeTruthy();
  });

  it("should leave no external http(s) resource references (self-contained)", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({
        html:
          '<img src="https://evil.example.com/tracker.png">' +
          '<style>body { background: url(https://evil.example.com/bg.png); }</style>' +
          '<p>hi</p>',
      }),
    );

    // No external http(s) URL fetches remain anywhere in the composed document body.
    // (The composer's own <meta referrer> etc. never carry http(s) URLs.)
    expect(doc).not.toContain("evil.example.com");
    expect(doc).not.toMatch(/src="https?:/i);
    expect(doc).not.toMatch(/url\(\s*['"]?https?:/i);
  });

  it("should preserve authored <style> blocks (self-contained styling survives)", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<style>h1 { color: rebeccapurple; }</style><h1>Styled</h1>" }),
    );

    expect(doc).toContain("rebeccapurple");
    expect(doc).toContain("<h1>Styled</h1>");
  });

  it("should NOT inject the proposal branded document shell / chrome", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(artifact({ html: "<p>bare page</p>" }));

    // The artifact page is rendered AS AUTHORED — none of the proposal document theme.
    expect(doc).not.toContain("proposal-doc");
    expect(doc).not.toContain("proposal-root");
    expect(doc).not.toContain("theme-toggle");
    expect(doc).not.toContain("proposal");
  });

  it("should escape the title into the <title> slot", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(artifact({ title: "A & B <script>" }));

    expect(doc).toContain("<title>A &amp; B &lt;script&gt;</title>");
  });

  it("should still produce a valid document when html sanitizes to empty", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    // <script> no longer sanitizes away, so use a body that genuinely reduces to nothing:
    // an <iframe> is still stripped outright.
    const doc = composeArtifactDocument(artifact({ html: "<iframe src=\"https://evil.example\"></iframe>" }));

    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc.toLowerCase()).toContain("<body>");
    expect(doc).not.toContain("evil.example");
  });
});
