import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { ProposalCard, getConfidenceColor, getConfidenceLabel } from "../../src/components/proposals/ProposalCard";
import type { Proposal } from "../../src/types";

const baseProposal: Proposal = {
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

describe("getConfidenceColor", () => {
  it("should return green for scores >= 80", () => {
    expect(getConfidenceColor(80)).toBe("#00ff00");
    expect(getConfidenceColor(95)).toBe("#00ff00");
    expect(getConfidenceColor(100)).toBe("#00ff00");
  });

  it("should return amber for scores 60-79", () => {
    expect(getConfidenceColor(60)).toBe("#ffaa00");
    expect(getConfidenceColor(72)).toBe("#ffaa00");
    expect(getConfidenceColor(79)).toBe("#ffaa00");
  });

  it("should return orange for scores 40-59", () => {
    expect(getConfidenceColor(40)).toBe("#ff6600");
    expect(getConfidenceColor(50)).toBe("#ff6600");
    expect(getConfidenceColor(59)).toBe("#ff6600");
  });

  it("should return red for scores < 40", () => {
    expect(getConfidenceColor(0)).toBe("#fe1414");
    expect(getConfidenceColor(20)).toBe("#fe1414");
    expect(getConfidenceColor(39)).toBe("#fe1414");
  });
});

describe("getConfidenceLabel", () => {
  it("should return ACCEPT for scores >= 80", () => {
    expect(getConfidenceLabel(80)).toBe("ACCEPT");
    expect(getConfidenceLabel(100)).toBe("ACCEPT");
  });

  it("should return REFINE for scores 60-79", () => {
    expect(getConfidenceLabel(60)).toBe("REFINE");
    expect(getConfidenceLabel(72)).toBe("REFINE");
  });

  it("should return ESCALATE for scores 40-59", () => {
    expect(getConfidenceLabel(40)).toBe("ESCALATE");
    expect(getConfidenceLabel(55)).toBe("ESCALATE");
  });

  it("should return DISMISS for scores < 40", () => {
    expect(getConfidenceLabel(0)).toBe("DISMISS");
    expect(getConfidenceLabel(39)).toBe("DISMISS");
  });
});

describe("ProposalCard", () => {
  it("should render the score badge when confidenceScore is present", () => {
    const proposal: Proposal = { ...baseProposal, confidenceScore: 72 };
    render(createElement(ProposalCard, { proposal }));

    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("72").getAttribute("title")).toBe("REFINE");
  });

  it("should not render the score badge when confidenceScore is absent", () => {
    render(createElement(ProposalCard, { proposal: baseProposal }));

    // The card renders but no score badge
    expect(screen.getByText("Improve UX")).toBeTruthy();
    // No numeric score badge in the header
    expect(screen.queryByTitle("ACCEPT")).toBeNull();
    expect(screen.queryByTitle("REFINE")).toBeNull();
    expect(screen.queryByTitle("ESCALATE")).toBeNull();
    expect(screen.queryByTitle("DISMISS")).toBeNull();
  });

  it("should apply correct color to score badge based on score", () => {
    const proposal: Proposal = { ...baseProposal, confidenceScore: 85 };
    render(createElement(ProposalCard, { proposal }));

    const badge = screen.getByText("85");
    expect(badge.style.color).toBe("rgb(0, 255, 0)");
    expect(badge.getAttribute("title")).toBe("ACCEPT");
  });

  it("should call onClick when card is clicked", () => {
    const onClick = vi.fn();
    render(createElement(ProposalCard, { proposal: baseProposal, onClick }));

    fireEvent.click(screen.getByText("Improve UX").closest("div")!.parentElement!);
    expect(onClick).toHaveBeenCalledWith("p1");
  });
});
