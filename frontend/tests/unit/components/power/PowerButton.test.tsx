import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PowerButton } from "../../../../src/components/power/PowerButton";
import { usePolling } from "../../../../src/hooks/usePolling";
import { api } from "../../../../src/services/api";
import type { GastownStatus } from "../../../../src/types";

// Mock the usePolling hook and api
vi.mock("../../../../src/hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

vi.mock("../../../../src/services/api", () => ({
  api: {
    getStatus: vi.fn(),
    power: {
      up: vi.fn(),
      down: vi.fn(),
    },
  },
}));

const mockUsePolling = usePolling as ReturnType<typeof vi.fn>;

// =============================================================================
// Test Fixtures
// =============================================================================

interface MockPollingResult {
  data: GastownStatus | null;
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

function createMockStatus(
  overrides: Partial<GastownStatus> = {}
): GastownStatus {
  return {
    powerState: "stopped",
    uptime: 0,
    version: "1.0.0",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("PowerButton", () => {
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
    it("should render stopped state correctly", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("OFFLINE")).toBeInTheDocument();
      expect(screen.getByText("SYSTEM DOWN")).toBeInTheDocument();
      expect(screen.getByText("START")).toBeInTheDocument();
    });

    it("should render running state correctly", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "running" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("ONLINE")).toBeInTheDocument();
      expect(screen.getByText("SYSTEM NOMINAL")).toBeInTheDocument();
      expect(screen.getByText("SHUTDOWN")).toBeInTheDocument();
    });

    it("should render starting state correctly", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "starting" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("STARTING")).toBeInTheDocument();
      expect(screen.getByText("IGNITING CORES")).toBeInTheDocument();
      expect(screen.getByText("HOLD")).toBeInTheDocument();
    });

    it("should render stopping state correctly", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopping" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("STOPPING")).toBeInTheDocument();
      expect(screen.getByText("POWERING DOWN")).toBeInTheDocument();
      expect(screen.getByText("HOLD")).toBeInTheDocument();
    });

    it("should render unknown state when no data", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: null })
      );

      render(<PowerButton />);

      expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
      expect(screen.getByText("AWAITING SIGNAL")).toBeInTheDocument();
      expect(screen.getByText("CHECKING")).toBeInTheDocument();
    });

    it("should show SYNCING when loading", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "running" }),
          loading: true,
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("SYNCING...")).toBeInTheDocument();
    });

    it("should show LIVE when not loading", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "running" }),
          loading: false,
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Interactions
  // ===========================================================================

  describe("interactions", () => {
    it("should call api.power.up when clicked in stopped state", async () => {
      const mockRefresh = vi.fn();
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
          refresh: mockRefresh,
        })
      );
      vi.mocked(api.power.up).mockResolvedValue({ newState: "starting" });

      render(<PowerButton />);

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(api.power.up).toHaveBeenCalledTimes(1);
      });
    });

    it("should call api.power.down when clicked in running state", async () => {
      const mockRefresh = vi.fn();
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "running" }),
          refresh: mockRefresh,
        })
      );
      vi.mocked(api.power.down).mockResolvedValue({ newState: "stopping" });

      render(<PowerButton />);

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(api.power.down).toHaveBeenCalledTimes(1);
      });
    });

    it("should be disabled during transitioning states", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "starting" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("should be disabled when state is unknown", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({ data: null })
      );

      render(<PowerButton />);

      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("should show EXECUTING... while action is in progress", async () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
        })
      );
      // Make the promise hang
      vi.mocked(api.power.up).mockImplementation(
        () => new Promise(() => {})
      );

      render(<PowerButton />);

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByText("EXECUTING...")).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Error Display
  // ===========================================================================

  describe("error display", () => {
    it("should display polling error when present", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: null,
          error: new Error("Connection failed"),
        })
      );

      render(<PowerButton />);

      expect(screen.getByRole("alert")).toHaveTextContent("Connection failed");
    });

    it("should display action error when power operation fails", async () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
        })
      );
      vi.mocked(api.power.up).mockRejectedValue(new Error("Power failure"));

      render(<PowerButton />);

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Power failure");
      });
    });

    it("should not display error section when no error", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "running" }),
          error: null,
        })
      );

      render(<PowerButton />);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Accessibility
  // ===========================================================================

  describe("accessibility", () => {
    it("should have aria-label for power toggle", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-label",
        "Toggle gastown power"
      );
    });

    it("should have POWER CONTROL header", () => {
      mockUsePolling.mockReturnValue(
        createMockPollingResult({
          data: createMockStatus({ powerState: "stopped" }),
        })
      );

      render(<PowerButton />);

      expect(screen.getByText("POWER CONTROL")).toBeInTheDocument();
    });
  });
});
