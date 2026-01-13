import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CrewStats } from "../../../../src/components/crew/CrewStats";
import { usePolling } from "../../../../src/hooks/usePolling";
import type { CrewMember } from "../../../../src/types";

// Mock the usePolling hook
vi.mock("../../../../src/hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

const mockUsePolling = usePolling as ReturnType<typeof vi.fn>;

// =============================================================================
// Test Fixtures
// =============================================================================

interface MockPollingResult {
  data: CrewMember[] | null;
  loading: boolean;
  error: Error | null;
  refresh: ReturnType<typeof vi.fn>;
  lastUpdated: Date | null;
}

function createMockPollingResult(
  overrides: Partial<MockPollingResult> = {}
): MockPollingResult {
  return {
    data: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    lastUpdated: null,
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "gastown_boy/nux",
    name: "nux",
    type: "polecat",
    rig: "gastown_boy",
    status: "working",
    unreadMail: 0,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("CrewStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Rendering States
  // ===========================================================================

  describe("rendering states", () => {
    it("should render loading state", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ loading: true, data: null })
      );

      render(<CrewStats />);

      expect(screen.getByText("LOADING CREW DATA...")).toBeInTheDocument();
      expect(screen.getByText("SYNCING...")).toBeInTheDocument();
    });

    it("should render empty state when no agents", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: [] })
      );

      render(<CrewStats />);

      expect(screen.getByText("NO AGENTS FOUND")).toBeInTheDocument();
    });

    it("should render crew members", () => {
      const mockAgents = [
        createMockAgent({ id: "mayor", name: "mayor", type: "mayor", status: "working" }),
        createMockAgent({ id: "gastown_boy/nux", name: "nux", type: "polecat", status: "idle" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      render(<CrewStats />);

      expect(screen.getByText("mayor")).toBeInTheDocument();
      expect(screen.getByText("nux")).toBeInTheDocument();
    });

    it("should show LIVE when not loading", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent()],
          loading: false,
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    it("should display CREW STATS header", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: [] })
      );

      render(<CrewStats />);

      expect(screen.getByText("CREW STATS")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Agent Cards
  // ===========================================================================

  describe("agent cards", () => {
    it("should display agent status", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ status: "working" })],
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("WORKING")).toBeInTheDocument();
    });

    it("should display different statuses correctly", () => {
      const mockAgents = [
        createMockAgent({ id: "1", name: "agent1", status: "working" }),
        createMockAgent({ id: "2", name: "agent2", status: "idle" }),
        createMockAgent({ id: "3", name: "agent3", status: "blocked" }),
        createMockAgent({ id: "4", name: "agent4", status: "offline" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      render(<CrewStats />);

      expect(screen.getByText("WORKING")).toBeInTheDocument();
      expect(screen.getByText("IDLE")).toBeInTheDocument();
      expect(screen.getByText("BLOCKED")).toBeInTheDocument();
      expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    });

    it("should display unread mail badge when > 0", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ unreadMail: 5 })],
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("✉ 5")).toBeInTheDocument();
    });

    it("should not display mail badge when unreadMail is 0", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ unreadMail: 0 })],
        })
      );

      render(<CrewStats />);

      expect(screen.queryByText(/✉/)).not.toBeInTheDocument();
    });

    it("should display rig info when present", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ rig: "gastown_boy" })],
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("RIG: gastown_boy")).toBeInTheDocument();
    });

    it("should display current task when present", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ currentTask: "Implementing feature X" })],
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("Implementing feature X")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Stats Footer
  // ===========================================================================

  describe("stats footer", () => {
    it("should show total count", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent(), createMockAgent({ id: "2" })],
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("TOTAL: 2")).toBeInTheDocument();
    });

    it("should show online count", () => {
      const mockAgents = [
        createMockAgent({ id: "1", status: "working" }),
        createMockAgent({ id: "2", status: "idle" }),
        createMockAgent({ id: "3", status: "offline" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      render(<CrewStats />);

      expect(screen.getByText("ONLINE: 2")).toBeInTheDocument();
    });

    it("should show working count", () => {
      const mockAgents = [
        createMockAgent({ id: "1", status: "working" }),
        createMockAgent({ id: "2", status: "working" }),
        createMockAgent({ id: "3", status: "idle" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      render(<CrewStats />);

      expect(screen.getByText("WORKING: 2")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Interactions
  // ===========================================================================

  describe("interactions", () => {
    it("should call refresh when refresh button clicked", async () => {
      const mockRefresh = vi.fn();
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent()],
          refresh: mockRefresh,
        })
      );

      render(<CrewStats />);

      fireEvent.click(screen.getByText("REFRESH"));

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it("should disable refresh button while loading", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent()],
          loading: true,
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("REFRESHING...")).toBeDisabled();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should display error message", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: null,
          error: new Error("Connection failed"),
        })
      );

      render(<CrewStats />);

      expect(screen.getByRole("alert")).toHaveTextContent("Connection failed");
    });

    it("should show error banner with proper text", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: null,
          error: new Error("Network error"),
        })
      );

      render(<CrewStats />);

      expect(screen.getByText(/CREW ERROR:/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Accessibility
  // ===========================================================================

  describe("accessibility", () => {
    it("should have crew members list with proper role", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent()],
        })
      );

      render(<CrewStats />);

      expect(screen.getByRole("list", { name: "Crew members" })).toBeInTheDocument();
    });

    it("should have list items for each agent", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent(), createMockAgent({ id: "2", name: "furiosa" })],
        })
      );

      render(<CrewStats />);

      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);
    });
  });
});
