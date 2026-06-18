/**
 * Tests for ProposalPageViewer (adj-200.4.2 / T012).
 *
 * The viewer renders an agent-authored, server-sanitized self-contained HTML
 * document inside a SANDBOXED iframe. Security contract: the iframe MUST set a
 * `sandbox` attribute that does NOT include `allow-scripts` (the html is
 * agent-authored and only server-sanitized). When html is empty it shows a
 * clean fallback instead of an empty frame.
 *
 * @module tests/unit/proposal-page-viewer
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import { ProposalPageViewer } from "../../src/components/proposals/ProposalPageViewer";

const SAMPLE_HTML =
  "<!doctype html><html><body><section><h1>Hello</h1></section></body></html>";

describe("ProposalPageViewer (adj-200.4.2)", () => {
  it("renders the html in an iframe via srcdoc", () => {
    render(createElement(ProposalPageViewer, { html: SAMPLE_HTML, title: "P1" }));
    const frame = screen.getByTitle(/page render/i);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("srcdoc")).toBe(SAMPLE_HTML);
  });

  it("sets a sandbox attribute that does NOT include allow-scripts", () => {
    render(createElement(ProposalPageViewer, { html: SAMPLE_HTML, title: "P1" }));
    const frame = screen.getByTitle(/page render/i);
    const sandbox = frame.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    // The whole point: agent-authored html must never script the parent.
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("does not enable allow-same-origin together with allow-scripts (no sandbox escape)", () => {
    render(createElement(ProposalPageViewer, { html: SAMPLE_HTML, title: "P1" }));
    const frame = screen.getByTitle(/page render/i);
    const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    const escapeCombo =
      tokens.includes("allow-scripts") && tokens.includes("allow-same-origin");
    expect(escapeCombo).toBe(false);
  });

  it("shows a fallback (and no iframe) when html is empty", () => {
    render(createElement(ProposalPageViewer, { html: "", title: "P1" }));
    expect(screen.queryByTitle(/page render/i)).toBeNull();
    expect(screen.getByText(/no page/i)).toBeTruthy();
  });

  it("shows a fallback when html is undefined", () => {
    render(createElement(ProposalPageViewer, { title: "P1" }));
    expect(screen.queryByTitle(/page render/i)).toBeNull();
    expect(screen.getByText(/no page/i)).toBeTruthy();
  });
});
