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
    expect(ARTIFACT_DOCUMENT_CSP).not.toContain("script-src");
  });

  it("should strip <script> tags from authored html", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<div>ok</div><script>alert('xss')</script>" }),
    );

    expect(doc).not.toContain("<script>alert");
    expect(doc).not.toContain("alert('xss')");
    expect(doc).toContain("<div>ok</div>");
  });

  it("should strip on* inline event handlers", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<img src=\"data:image/png;base64,AAAA\" onerror=\"alert(1)\">" }),
    );

    expect(doc.toLowerCase()).not.toContain("onerror");
    expect(doc).not.toContain("alert(1)");
  });

  it("should defeat the classic svg><style><img onerror mXSS vector", async () => {
    const { composeArtifactDocument } = await import("../../src/services/artifact-html.js");
    const doc = composeArtifactDocument(
      artifact({ html: "<svg><style><img src=x onerror=alert(1)></style></svg>" }),
    );

    expect(doc.toLowerCase()).not.toContain("onerror");
    expect(doc).not.toContain("alert(1)");
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
    const doc = composeArtifactDocument(artifact({ html: "<script>evil()</script>" }));

    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc.toLowerCase()).toContain("<body>");
    expect(doc).not.toContain("evil()");
  });
});
