/**
 * Tests for ArtifactViewer (adj-j7az6.3.3 / T303a).
 *
 * The viewer fetches the composed, server-sanitized self-contained document for
 * an artifact (via the authenticated download endpoint) and renders it inside a
 * SANDBOXED iframe whose `sandbox` MUST NOT include `allow-scripts`. It also
 * exposes an obvious DOWNLOAD action that saves the exact `.html` to disk.
 *
 * @module tests/unit/artifact-viewer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";

import { ArtifactViewer } from "../../src/components/artifacts/ArtifactViewer";
import type { Artifact } from "../../src/types";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    artifacts: {
      download: vi.fn(),
    },
  },
}));

const DOC_HTML =
  "<!doctype html><html><body><main><h1>Hello</h1></main></body></html>";

const artifact: Artifact = {
  id: "a1",
  title: "My Page",
  slug: "my-page",
  html: "<h1>Hello</h1>",
  isPublic: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function mockDownload(): { blob: Blob; filename: string } {
  const blob = new Blob([DOC_HTML], { type: "text/html" });
  const payload = { blob, filename: "my-page.html" };
  vi.mocked(api.artifacts.download).mockResolvedValue(payload);
  return payload;
}

describe("ArtifactViewer (adj-j7az6.3.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks Blob.text() in some versions — provide a deterministic stub.
    if (!("text" in Blob.prototype)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Blob.prototype as any).text = function () {
        return Promise.resolve(DOC_HTML);
      };
    }
  });

  it("fetches the composed document and renders it in an iframe via srcdoc", async () => {
    mockDownload();
    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));

    await waitFor(() => {
      const frame = screen.getByTitle(/artifact render/i);
      expect(frame.tagName).toBe("IFRAME");
    });
    expect(api.artifacts.download).toHaveBeenCalledWith("a1");
    const frame = screen.getByTitle(/artifact render/i);
    expect(frame.getAttribute("srcdoc")).toContain("Hello");
  });

  it("grants allow-scripts but NEVER allow-same-origin (adj-artifact-js)", async () => {
    mockDownload();
    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));

    const frame = await screen.findByTitle(/artifact render/i);
    const sandbox = frame.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();

    // Artifacts are interactive pages, so scripts run.
    expect(sandbox).toContain("allow-scripts");

    // This is the assertion that actually matters: allow-scripts WITH allow-same-origin is the
    // pairing that defeats the sandbox entirely, letting the document reach this app's DOM,
    // storage and same-origin API. It must never appear alongside allow-scripts.
    expect(sandbox).not.toContain("allow-same-origin");

    // Escaping the sandbox via a popup was harmless while nothing could script; with scripts
    // enabled it is a privilege escalation.
    expect(sandbox).not.toContain("allow-popups-to-escape-sandbox");
  });

  it("does not combine allow-scripts with allow-same-origin (no sandbox escape)", async () => {
    mockDownload();
    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));
    const frame = await screen.findByTitle(/artifact render/i);
    const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    expect(tokens.includes("allow-scripts") && tokens.includes("allow-same-origin")).toBe(
      false,
    );
  });

  it("DOWNLOAD button saves the .html via an anchor download", async () => {
    mockDownload();

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;

    const clicked: { href: string; download: string }[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        // Capture the anchor's download intent on click.
        (el as HTMLAnchorElement).click = () => {
          clicked.push({
            href: (el as HTMLAnchorElement).href,
            download: (el as HTMLAnchorElement).download,
          });
        };
      }
      return el;
    });

    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));
    const btn = await screen.findByRole("button", { name: /download/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(clicked.length).toBe(1);
    });
    expect(clicked[0]?.download).toBe("my-page.html");
    expect(createObjectURL).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("shows a loading indicator before the document resolves", () => {
    // Never resolve — keep it pending.
    vi.mocked(api.artifacts.download).mockReturnValue(new Promise(() => {}));
    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows an error state when the document fails to load", async () => {
    vi.mocked(api.artifacts.download).mockRejectedValue(new Error("boom"));
    render(createElement(ArtifactViewer, { artifact, onClose: () => {} }));
    await waitFor(() => {
      expect(screen.getByText(/error|failed/i)).toBeTruthy();
    });
  });

  it("invokes onClose when the close control is clicked", async () => {
    mockDownload();
    const onClose = vi.fn();
    render(createElement(ArtifactViewer, { artifact, onClose }));
    const closeBtn = await screen.findByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
