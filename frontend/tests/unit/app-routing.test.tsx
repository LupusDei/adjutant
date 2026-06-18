/**
 * Tests for standalone hash routing (adj-200.4.4 / T014).
 *
 * Adds a `#proposal/<id>` standalone route mirroring the existing
 * `#graph/<epicId>` route. parseHashRoute must resolve it to a ProposalPage
 * wrapper target, and ProposalPage must fetch + render the proposal.
 *
 * @module tests/unit/app-routing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { parseHashRoute } from "../../src/App";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../src/services/api", () => ({
  api: { proposals: { get: mockGet } },
  publicProposalUrl: (token: string) => `http://localhost/p/${token}`,
}));

function setHash(hash: string): void {
  window.location.hash = hash;
}

describe("parseHashRoute (adj-200.4.4)", () => {
  it("resolves #proposal/<id> to a proposal route", () => {
    setHash("#proposal/p1");
    expect(parseHashRoute()).toEqual({ type: "proposal", proposalId: "p1" });
  });

  it("URL-decodes the proposal id", () => {
    setHash("#proposal/adj%2F200");
    expect(parseHashRoute()).toEqual({ type: "proposal", proposalId: "adj/200" });
  });

  it("still resolves the existing #graph route", () => {
    setHash("#graph/adj-200");
    expect(parseHashRoute()).toEqual({ type: "graph", epicId: "adj-200" });
  });

  it("returns null for an unrelated hash", () => {
    setHash("#settings");
    expect(parseHashRoute()).toBeNull();
  });
});

describe("ProposalPage (adj-200.4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the proposal and renders its page in the viewer", async () => {
    mockGet.mockResolvedValue({
      id: "p1",
      author: "agent-1",
      title: "Shareable Pages",
      description: "desc",
      project: "adjutant",
      type: "engineering",
      status: "pending",
      createdAt: "2026-06-17T00:00:00Z",
      updatedAt: "2026-06-17T00:00:00Z",
      html: "<!doctype html><html><body><h1>Hi</h1></body></html>",
      isPublic: true,
      shareToken: "abc123def456ghi7",
    });

    const { ProposalPage } = await import(
      "../../src/components/proposals/ProposalPage"
    );
    render(createElement(ProposalPage, { proposalId: "p1" }));

    await waitFor(() => { expect(mockGet).toHaveBeenCalledWith("p1"); });
    expect(await screen.findByTitle(/page render/i)).toBeTruthy();
  });

  it("shows an error state when the fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    const { ProposalPage } = await import(
      "../../src/components/proposals/ProposalPage"
    );
    render(createElement(ProposalPage, { proposalId: "missing" }));
    expect(await screen.findByText(/error|could not/i)).toBeTruthy();
  });
});
