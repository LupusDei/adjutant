/**
 * Tests for ProposalDetailView sharing controls (adj-200.4.3 / T013).
 *
 * Adds, on top of the existing detail panel:
 *  - a "VIEW AS PAGE" toggle that mounts the sandboxed ProposalPageViewer,
 *  - PUBLISH / UNPUBLISH that calls the api and flips a PUBLIC/PRIVATE badge,
 *  - COPY LINK that copies the public URL,
 *  - OPEN IN NEW TAB that targets the public URL.
 *
 * @module tests/unit/proposal-detail-view
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";

import { ProposalDetailView } from "../../src/components/proposals/ProposalDetailView";
import type { Proposal } from "../../src/types";

const baseProposal: Proposal = {
  id: "p1",
  author: "agent-1",
  title: "Shareable Pages",
  description: "Make proposals shareable",
  project: "adjutant",
  type: "engineering",
  status: "pending",
  createdAt: "2026-06-17T00:00:00Z",
  updatedAt: "2026-06-17T01:00:00Z",
  html: "<!doctype html><html><body><h1>Hi</h1></body></html>",
  isPublic: false,
};

const publicProposal: Proposal = {
  ...baseProposal,
  isPublic: true,
  shareToken: "abc123def456ghi7",
  publishedAt: "2026-06-17T01:00:00Z",
};

const { mockGet, mockPublish, mockUnpublish } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPublish: vi.fn(),
  mockUnpublish: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    proposals: {
      get: mockGet,
      publish: mockPublish,
      unpublish: mockUnpublish,
    },
  },
  // Pure helper used by the component to derive the public URL from a token.
  publicProposalUrl: (token: string) => `http://localhost/p/${token}`,
}));

function renderView() {
  return render(
    createElement(ProposalDetailView, {
      proposalId: "p1",
      onClose: vi.fn(),
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
      onComplete: vi.fn(),
      onSendToAgent: vi.fn(),
      onDiscuss: vi.fn(),
    }),
  );
}

describe("ProposalDetailView sharing controls (adj-200.4.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(baseProposal);
  });

  it("shows a PRIVATE badge for an unpublished proposal", async () => {
    renderView();
    expect(await screen.findByText(/^PRIVATE$/)).toBeTruthy();
  });

  it("shows a PUBLIC badge for a published proposal", async () => {
    mockGet.mockResolvedValue(publicProposal);
    renderView();
    expect(await screen.findByText(/^PUBLIC$/)).toBeTruthy();
  });

  it("mounts the page viewer when VIEW AS PAGE is toggled", async () => {
    renderView();
    const toggle = await screen.findByRole("button", { name: /view as page/i });
    expect(screen.queryByTitle(/page render/i)).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByTitle(/page render/i)).toBeTruthy();
  });

  it("publishes and flips the badge to PUBLIC", async () => {
    mockPublish.mockResolvedValue({
      proposal: publicProposal,
      publicUrl: "http://localhost/p/abc123def456ghi7",
    });
    renderView();
    const publishBtn = await screen.findByRole("button", { name: /^publish$/i });
    fireEvent.click(publishBtn);
    await waitFor(() => { expect(mockPublish).toHaveBeenCalledWith("p1"); });
    expect(await screen.findByText(/^PUBLIC$/)).toBeTruthy();
  });

  it("unpublishes and flips the badge to PRIVATE", async () => {
    mockGet.mockResolvedValue(publicProposal);
    mockUnpublish.mockResolvedValue({
      proposal: { ...publicProposal, isPublic: false },
    });
    renderView();
    const unpublishBtn = await screen.findByRole("button", { name: /unpublish/i });
    fireEvent.click(unpublishBtn);
    await waitFor(() => { expect(mockUnpublish).toHaveBeenCalledWith("p1"); });
    expect(await screen.findByText(/^PRIVATE$/)).toBeTruthy();
  });

  it("copies the public URL when COPY LINK is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockGet.mockResolvedValue(publicProposal);
    renderView();
    const copyBtn = await screen.findByRole("button", { name: /copy link/i });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("http://localhost/p/abc123def456ghi7");
    });
  });

  it("offers an OPEN IN NEW TAB link targeting the public URL", async () => {
    mockGet.mockResolvedValue(publicProposal);
    renderView();
    const openLink = await screen.findByRole("link", { name: /open in new tab/i });
    expect(openLink.getAttribute("href")).toBe(
      "http://localhost/p/abc123def456ghi7",
    );
    expect(openLink.getAttribute("target")).toBe("_blank");
  });

  it("offers a FULL PAGE link to the authed standalone route for any proposal", async () => {
    renderView();
    const fullPage = await screen.findByRole("link", { name: /full page/i });
    expect(fullPage.getAttribute("href")).toContain("#proposal/p1");
    expect(fullPage.getAttribute("target")).toBe("_blank");
  });

  it("does not show COPY LINK / OPEN IN NEW TAB for a private proposal", async () => {
    renderView();
    await screen.findByText(/^PRIVATE$/);
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open in new tab/i })).toBeNull();
  });
});
