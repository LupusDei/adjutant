import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrewStats } from "../../../../src/components/crew/CrewStats";
import { RigProvider } from "../../../../src/contexts/RigContext";
import { usePolling } from "../../../../src/hooks/usePolling";
import type { CrewMember } from "../../../../src/types";

// Mock the usePolling hook
vi.mock("../../../../src/hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

// Mock the ModeContext
vi.mock("../../../../src/contexts/ModeContext", () => ({
  useMode: vi.fn(() => ({
    mode: "gastown",
    features: [],
    availableModes: [],
    loading: false,
    error: null,
    isGasTown: true,
    isSwarm: false,
    hasFeature: () => false,
    switchMode: vi.fn(),
  })),
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

function renderWithRigProvider(ui: React.ReactElement) {
  return render(<RigProvider>{ui}</RigProvider>);
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

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("INITIALIZING CREW TELEMETRY...")).toBeInTheDocument();
      expect(screen.getByText("SYNCING...")).toBeInTheDocument();
    });

    it("should render empty state when no agents", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: [] })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("NO AGENTS CONFIGURED")).toBeInTheDocument();
    });

    it("should render crew members", () => {
      const mockAgents = [
        createMockAgent({ id: "mayor", name: "mayor", type: "mayor", status: "working", rig: null }),
        createMockAgent({ id: "gastown_boy/nux", name: "nux", type: "polecat", status: "idle" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getAllByText(/mayor/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/nux/i).length).toBeGreaterThan(0);
    });

    it("should show LIVE when not loading", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent()],
          loading: false,
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    it("should display CREW STATS header", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: [] })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("CREW MANIFEST")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Agent Cards
  // ===========================================================================

  describe("agent cards", () => {
    it("should display agent status", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "crew",
              rig: "gastown_boy",
              status: "working",
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("WORKING")).toBeInTheDocument();
    });

    it("should display different statuses correctly", () => {
      const mockAgents = [
        createMockAgent({ id: "1", name: "agent1", status: "working", type: "crew" }),
        createMockAgent({ id: "2", name: "agent2", status: "idle", type: "crew" }),
        createMockAgent({ id: "3", name: "agent3", status: "blocked", type: "crew" }),
        createMockAgent({ id: "4", name: "agent4", status: "offline", type: "crew" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getAllByText("WORKING").length).toBeGreaterThan(0);
      expect(screen.getAllByText("IDLE").length).toBeGreaterThan(0);
      expect(screen.getAllByText("BLOCKED").length).toBeGreaterThan(0);
      expect(screen.getAllByText("OFFLINE").length).toBeGreaterThan(0);
    });

    it("should display unread mail badge when > 0", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ unreadMail: 5 })],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText(/📬5/)).toBeInTheDocument();
    });

    it("should not display mail badge when unreadMail is 0", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ unreadMail: 0 })],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.queryByText(/✉/)).not.toBeInTheDocument();
    });

    it("should display rig info when present", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent({ rig: "gastown_boy" })],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText(/RIG: GASTOWN_BOY/i)).toBeInTheDocument();
    });

    it("should display current task when present", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "crew",
              rig: "gastown_boy",
              currentTask: "Implementing feature X",
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

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

      renderWithRigProvider(<CrewStats />);

      const agentsStat = screen.getByText("AGENTS").parentElement as HTMLElement;
      expect(agentsStat).toHaveTextContent("2");
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

      renderWithRigProvider(<CrewStats />);

      const onlineStat = screen.getByText("ONLINE").parentElement as HTMLElement;
      expect(onlineStat).toHaveTextContent("2");
    });

    it("should show offline count", () => {
      const mockAgents = [
        createMockAgent({ id: "1", status: "working" }),
        createMockAgent({ id: "2", status: "offline" }),
        createMockAgent({ id: "3", status: "offline" }),
      ];

      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: mockAgents })
      );

      renderWithRigProvider(<CrewStats />);

      const offlineStat = screen.getByText("OFFLINE").parentElement as HTMLElement;
      expect(offlineStat).toHaveTextContent("2");
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

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByRole("alert")).toHaveTextContent("Connection failed");
    });

    it("should show error banner with proper text", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: null,
          error: new Error("Network error"),
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText(/COMM ERROR:/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Active Status for Polecats with Hooked Work
  // ===========================================================================

  describe("active status for polecats with hooked work", () => {
    it("should display ACTIVE instead of IDLE when polecat has currentTask", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "polecat",
              rig: "gastown_boy",
              status: "idle",
              currentTask: "Fix the bug in auth module",
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
      expect(screen.queryByText("IDLE")).not.toBeInTheDocument();
    });

    it("should display IDLE when polecat has no currentTask", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "polecat",
              rig: "gastown_boy",
              status: "idle",
              currentTask: undefined,
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByText("IDLE")).toBeInTheDocument();
      expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
    });

    it("should have pulsating class on status indicator for active polecat", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "polecat",
              rig: "gastown_boy",
              status: "idle",
              currentTask: "Working on feature",
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

      // The status indicator should have the pulsate class
      const activeText = screen.getByText("ACTIVE");
      const statusRow = activeText.closest('[data-testid="status-row"]');
      const indicator = statusRow?.querySelector('[data-testid="status-indicator"]');
      expect(indicator).toHaveClass("pulsate");
    });

    it("should not have pulsating class on status indicator for idle polecat", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [
            createMockAgent({
              type: "polecat",
              rig: "gastown_boy",
              status: "idle",
              currentTask: undefined,
            }),
          ],
        })
      );

      renderWithRigProvider(<CrewStats />);

      const idleText = screen.getByText("IDLE");
      const statusRow = idleText.closest('[data-testid="status-row"]');
      const indicator = statusRow?.querySelector('[data-testid="status-indicator"]');
      expect(indicator).not.toHaveClass("pulsate");
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

      renderWithRigProvider(<CrewStats />);

      expect(screen.getByRole("list", { name: "Crew members" })).toBeInTheDocument();
    });

    it("should have list items for each agent", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: [createMockAgent(), createMockAgent({ id: "2", name: "furiosa" })],
        })
      );

      renderWithRigProvider(<CrewStats />);

      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);
    });
  });
});
