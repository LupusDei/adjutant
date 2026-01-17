import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConvoyCard } from "../../../../src/components/convoys/ConvoyCard";
import type { Convoy, TrackedIssue } from "../../../../src/types";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockTrackedIssue(overrides: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    id: "hq-t001",
    title: "Test Issue",
    status: "open",
    ...overrides,
  };
}

function createMockConvoy(overrides: Partial<Convoy> = {}): Convoy {
  return {
    id: "hq-c001",
    title: "Test Convoy",
    status: "open",
    rig: "gastown_boy",
    progress: {
      completed: 2,
      total: 5,
    },
    trackedIssues: [
      createMockTrackedIssue({ id: "hq-t001", status: "closed" }),
      createMockTrackedIssue({ id: "hq-t002", status: "closed" }),
      createMockTrackedIssue({ id: "hq-t003", status: "open" }),
      createMockTrackedIssue({ id: "hq-t004", status: "in_progress" }),
      createMockTrackedIssue({ id: "hq-t005", status: "open" }),
    ],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("ConvoyCard", () => {
  // ===========================================================================
  // Basic Rendering
  // ===========================================================================

  describe("basic rendering", () => {
    it("should render convoy ID", () => {
      render(<ConvoyCard convoy={createMockConvoy({ id: "hq-c123" })} />);

      expect(screen.getByText("HQ-C123")).toBeInTheDocument();
    });

    it("should render convoy title", () => {
      render(<ConvoyCard convoy={createMockConvoy({ title: "Feature Implementation" })} />);

      expect(screen.getByText("Feature Implementation")).toBeInTheDocument();
    });

    it("should render convoy status", () => {
      render(<ConvoyCard convoy={createMockConvoy({ status: "open" })} />);

      expect(screen.getByText("OPEN")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Progress Display
  // ===========================================================================

  describe("progress display", () => {
    it("should display progress as fraction and percentage", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            progress: { completed: 3, total: 10 },
          })}
        />
      );

      expect(screen.getByText("3/10 (30%)")).toBeInTheDocument();
    });

    it("should show 100% when all issues are complete", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            progress: { completed: 5, total: 5 },
          })}
        />
      );

      expect(screen.getByText("5/5 (100%)")).toBeInTheDocument();
    });

    it("should show 0% when no issues are complete", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            progress: { completed: 0, total: 5 },
          })}
        />
      );

      expect(screen.getByText("0/5 (0%)")).toBeInTheDocument();
    });

    it("should show 100% when there are no issues (empty convoy)", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            progress: { completed: 0, total: 0 },
            trackedIssues: [],
          })}
        />
      );

      expect(screen.getByText("0/0 (100%)")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Tracked Issues Display
  // ===========================================================================

  describe("tracked issues display", () => {
    it("should display up to 3 tracked issues", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001", title: "Issue One" }),
              createMockTrackedIssue({ id: "hq-t002", title: "Issue Two" }),
              createMockTrackedIssue({ id: "hq-t003", title: "Issue Three" }),
              createMockTrackedIssue({ id: "hq-t004", title: "Issue Four" }),
            ],
          })}
        />
      );

      expect(screen.getByText("Issue One")).toBeInTheDocument();
      expect(screen.getByText("Issue Two")).toBeInTheDocument();
      expect(screen.getByText("Issue Three")).toBeInTheDocument();
      expect(screen.queryByText("Issue Four")).not.toBeInTheDocument();
    });

    it("should show +N more when there are more than 3 issues", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001" }),
              createMockTrackedIssue({ id: "hq-t002" }),
              createMockTrackedIssue({ id: "hq-t003" }),
              createMockTrackedIssue({ id: "hq-t004" }),
              createMockTrackedIssue({ id: "hq-t005" }),
            ],
          })}
        />
      );

      expect(screen.getByText("+2 more")).toBeInTheDocument();
    });

    it("should not show +N more when 3 or fewer issues", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001" }),
              createMockTrackedIssue({ id: "hq-t002" }),
              createMockTrackedIssue({ id: "hq-t003" }),
            ],
          })}
        />
      );

      expect(screen.queryByText(/more/)).not.toBeInTheDocument();
    });

    it("should not show issues section when convoy has no tracked issues", () => {
      const { container } = render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [],
          })}
        />
      );

      // Check that the issues list section doesn't exist
      const issuesList = container.querySelector('[style*="border-top"]');
      expect(issuesList).toBeNull();
    });

    it("should display issue status abbreviation", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001", status: "open" }),
              createMockTrackedIssue({ id: "hq-t002", status: "in_progress" }),
              createMockTrackedIssue({ id: "hq-t003", status: "closed" }),
            ],
          })}
        />
      );

      expect(screen.getByText("[OPEN]")).toBeInTheDocument();
      expect(screen.getByText("[IN_P]")).toBeInTheDocument();
      expect(screen.getByText("[CLOS]")).toBeInTheDocument();
    });

    it("should display issue ID", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t999", title: "Test Issue" }),
            ],
          })}
        />
      );

      expect(screen.getByText("hq-t999")).toBeInTheDocument();
    });

    it("should display issue title", () => {
      render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001", title: "Fix critical bug" }),
            ],
          })}
        />
      );

      expect(screen.getByText("Fix critical bug")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Issue Status Colors
  // ===========================================================================

  describe("issue status colors", () => {
    it("should render blocked issues with error color", () => {
      const { container } = render(
        <ConvoyCard
          convoy={createMockConvoy({
            trackedIssues: [
              createMockTrackedIssue({ id: "hq-t001", status: "blocked" }),
            ],
          })}
        />
      );

      const blockedStatus = container.querySelector('[style*="color: #FF4444"]') ||
                           container.querySelector('[style*="color: rgb(255, 68, 68)"]');
      expect(blockedStatus).toBeTruthy();
    });
  });
});
