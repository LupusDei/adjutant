import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { ProposalDetailView } from "../../src/components/proposals/ProposalDetailView";
import type { Proposal } from "../../src/types";

const mockProposal: Proposal = {
  id: "p1",
  author: "agent-1",
  title: "Improve UX",
  description: "Add onboarding flow for new users",
  project: "adjutant",
  type: "product",
  status: "pending",
  createdAt: "2026-02-24T00:00:00Z",
  updatedAt: "2026-02-24T01:00:00Z",
};

const acceptedProposal: Proposal = {
  ...mockProposal,
  id: "p2",
  status: "accepted",
};

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    proposals: {
      get: mockGet,
    },
  },
}));

describe("ProposalDetailView", () => {
  const onClose = vi.fn();
  const onAccept = vi.fn();
  const onDismiss = vi.fn();
  const onSendToAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(mockProposal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderDetail(proposalId: string | null = "p1") {
    return render(
      createElement(ProposalDetailView, {
        proposalId,
        onClose,
        onAccept,
        onDismiss,
        onSendToAgent,
      })
    );
  }

  it("renders nothing when proposalId is null", () => {
    const { container } = renderDetail(null);
    expect(container.innerHTML).toBe("");
  });

  it("fetches proposal on proposalId change", async () => {
    renderDetail("p1");

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("p1");
    });

    expect(screen.getByText("Improve UX")).toBeTruthy();
  });

  it("shows loading state while fetching", () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    renderDetail("p1");

    expect(screen.getByText("LOADING...")).toBeTruthy();
  });

  it("shows error when fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("Network error"));
    renderDetail("p1");

    await waitFor(() => {
      expect(screen.getByText(/ERROR: Network error/)).toBeTruthy();
    });
  });

  it("shows ACCEPT and DISMISS for pending proposals", async () => {
    renderDetail("p1");

    await waitFor(() => {
      expect(screen.getByText("ACCEPT")).toBeTruthy();
    });

    expect(screen.getByText("DISMISS")).toBeTruthy();
    expect(screen.queryByText("SEND TO AGENT")).toBeNull();
  });

  it("shows SEND TO AGENT for accepted proposals", async () => {
    mockGet.mockResolvedValue(acceptedProposal);
    renderDetail("p2");

    await waitFor(() => {
      expect(screen.getByText("SEND TO AGENT")).toBeTruthy();
    });

    expect(screen.queryByText("ACCEPT")).toBeNull();
    expect(screen.queryByText("DISMISS")).toBeNull();
  });

  it("calls onClose on Escape key", async () => {
    renderDetail("p1");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onAccept when ACCEPT button clicked", async () => {
    renderDetail("p1");

    await waitFor(() => {
      expect(screen.getByText("ACCEPT")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("ACCEPT"));
    expect(onAccept).toHaveBeenCalledWith("p1");
  });

  it("calls onDismiss when DISMISS button clicked", async () => {
    renderDetail("p1");

    await waitFor(() => {
      expect(screen.getByText("DISMISS")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("DISMISS"));
    expect(onDismiss).toHaveBeenCalledWith("p1");
  });

  it("calls onSendToAgent when SEND TO AGENT button clicked", async () => {
    mockGet.mockResolvedValue(acceptedProposal);
    renderDetail("p2");

    await waitFor(() => {
      expect(screen.getByText("SEND TO AGENT")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("SEND TO AGENT"));
    expect(onSendToAgent).toHaveBeenCalledWith(acceptedProposal);
  });

  it("calls onClose when backdrop is clicked", async () => {
    renderDetail("p1");

    await waitFor(() => {
      expect(screen.getByText("PROPOSAL DETAIL")).toBeTruthy();
    });

    // The backdrop is the first child div
    fireEvent.click(screen.getByText("PROPOSAL DETAIL").closest("div")!.parentElement!.previousElementSibling!);
    expect(onClose).toHaveBeenCalled();
  });
});
