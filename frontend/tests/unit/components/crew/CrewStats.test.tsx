import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrewStats } from "../../../../src/components/crew/CrewStats";
import { useSwarmAgents } from "../../../../src/hooks/useSwarmAgents";
import type { CrewMember } from "../../../../src/types";

// Mock the useSwarmAgents hook
vi.mock("../../../../src/hooks/useSwarmAgents", () => ({
  useSwarmAgents: vi.fn(),
}));

const mockUseSwarmAgents = useSwarmAgents as ReturnType<typeof vi.fn>;

// =============================================================================
// Test Fixtures
// =============================================================================

interface MockSwarmResult {
  agents: CrewMember[] | null;
  loading: boolean;
  error: string | null;
}

function createMockSwarmResult(
  overrides: Partial<MockSwarmResult> = {}
): MockSwarmResult {
  return {
    agents: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "agent-1",
    name: "nux",
    type: "agent",
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
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ loading: true, agents: null })
      );

      render(<CrewStats />);

      expect(screen.getByText("INITIALIZING CREW TELEMETRY...")).toBeInTheDocument();
      expect(screen.getByText("SYNCING...")).toBeInTheDocument();
    });

    it("should render empty state when no agents", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ agents: [] })
      );

      render(<CrewStats />);

      expect(screen.getByText("NO AGENTS CONFIGURED")).toBeInTheDocument();
    });

    it("should render agents", () => {
      const mockAgents = [
        createMockAgent({ id: "1", name: "alpha", status: "working" }),
        createMockAgent({ id: "2", name: "beta", status: "idle" }),
      ];

      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ agents: mockAgents })
      );

      render(<CrewStats />);

      expect(screen.getAllByText(/alpha/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/beta/i).length).toBeGreaterThan(0);
    });

    it("should show LIVE when not loading", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({
          agents: [createMockAgent()],
          loading: false,
        })
      );

      render(<CrewStats />);

      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    it("should display AGENTS header", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ agents: [] })
      );

      render(<CrewStats />);

      // The main header
      expect(screen.getAllByText("AGENTS").length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Stats Footer
  // ===========================================================================

  describe("stats footer", () => {
    it("should show total count in footer", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({
          agents: [createMockAgent(), createMockAgent({ id: "2" })],
        })
      );

      render(<CrewStats />);

      // The footer contains stat labels as small spans. Find the "AGENTS" label
      // that lives inside a stat item (not the h2 header or section title).
      const footer = screen.getByRole("contentinfo") ?? document.querySelector("footer");
      expect(footer).toBeTruthy();
      expect(footer!.textContent).toContain("2");
    });

    it("should show online count in footer", () => {
      const mockAgents = [
        createMockAgent({ id: "1", status: "working" }),
        createMockAgent({ id: "2", status: "idle" }),
        createMockAgent({ id: "3", status: "offline" }),
      ];

      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ agents: mockAgents })
      );

      render(<CrewStats />);

      const onlineStat = screen.getByText("ONLINE").parentElement!;
      expect(onlineStat).toHaveTextContent("2");
    });

    it("should show offline count in footer", () => {
      const mockAgents = [
        createMockAgent({ id: "1", status: "working" }),
        createMockAgent({ id: "2", status: "offline" }),
        createMockAgent({ id: "3", status: "offline" }),
      ];

      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({ agents: mockAgents })
      );

      render(<CrewStats />);

      // Footer has the offline count as "2"
      const footer = document.querySelector("footer");
      expect(footer).toBeTruthy();
      expect(footer!.textContent).toContain("2");
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should display error message", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({
          agents: null,
          error: "Connection failed",
        })
      );

      render(<CrewStats />);

      expect(screen.getByRole("alert")).toHaveTextContent("Connection failed");
    });

    it("should show error banner with proper text", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({
          agents: null,
          error: "Network error",
        })
      );

      render(<CrewStats />);

      expect(screen.getByText(/COMM ERROR:/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Accessibility
  // ===========================================================================

  describe("accessibility", () => {
    it("should have crew members list with proper role", () => {
      mockUseSwarmAgents.mockReturnValue(
        createMockSwarmResult({
          agents: [createMockAgent()],
        })
      );

      render(<CrewStats />);

      expect(screen.getByRole("list", { name: "Crew members" })).toBeInTheDocument();
    });
  });
});
