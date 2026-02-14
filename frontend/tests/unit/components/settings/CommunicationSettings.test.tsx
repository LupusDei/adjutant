import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsView } from "../../../../src/components/settings/SettingsView";
import { CommunicationProvider } from "../../../../src/contexts/CommunicationContext";

// Mock QRCodeSVG to avoid canvas issues in tests
vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => null,
}));

// =============================================================================
// Helpers
// =============================================================================

function renderSettings(props?: { theme?: 'green'; isActive?: boolean }) {
  const setTheme = vi.fn();
  return render(
    <CommunicationProvider>
      <SettingsView
        theme={props?.theme ?? "green"}
        setTheme={setTheme}
        isActive={props?.isActive ?? true}
      />
    </CommunicationProvider>
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("Communication Settings", () => {
  beforeEach(() => {
    localStorage.clear();
    // Mock fetch for tunnel and mode API calls
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("/api/mode")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              mode: "gastown",
              features: ["power_control", "rigs", "websocket", "sse"],
              availableModes: [
                { mode: "gastown", available: true },
                { mode: "standalone", available: true },
                { mode: "swarm", available: true },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (typeof url === "string" && url.includes("/api/tunnel/status")) {
        return new Response(
          JSON.stringify({ success: true, data: { state: "stopped" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("should render the COMMUNICATION section", () => {
      renderSettings();
      expect(screen.getByText("COMMUNICATION")).toBeTruthy();
    });

    it("should show PRIORITY label", () => {
      renderSettings();
      expect(screen.getByText("PRIORITY:")).toBeTruthy();
    });

    it("should render all three priority options", () => {
      renderSettings();
      expect(screen.getByText("REAL-TIME")).toBeTruthy();
      expect(screen.getByText("EFFICIENT")).toBeTruthy();
      expect(screen.getByText("POLLING")).toBeTruthy();
    });

    it("should show connection indicator for default real-time", () => {
      renderSettings();
      // WebSocket indicator for real-time default
      expect(screen.getByText("◉ WS")).toBeTruthy();
    });
  });

  describe("priority selection", () => {
    it("should switch to efficient mode when clicked", async () => {
      renderSettings();

      fireEvent.click(screen.getByText("EFFICIENT"));

      await waitFor(() => {
        expect(screen.getByText("◎ SSE")).toBeTruthy();
      });
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("efficient");
    });

    it("should switch to polling mode when clicked", async () => {
      renderSettings();

      fireEvent.click(screen.getByText("POLLING"));

      await waitFor(() => {
        expect(screen.getByText("○ HTTP")).toBeTruthy();
      });
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("polling-only");
    });

    it("should switch back to real-time when clicked", async () => {
      localStorage.setItem("adjutant-comm-priority", "efficient");
      renderSettings();

      fireEvent.click(screen.getByText("REAL-TIME"));

      await waitFor(() => {
        expect(screen.getByText("◉ WS")).toBeTruthy();
      });
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("real-time");
    });
  });

  describe("mode switcher", () => {
    it("should display current mode after loading", async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText("MODE:")).toBeTruthy();
      });
    });

    it("should render all three mode options", async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText("GAS TOWN")).toBeTruthy();
      });
      expect(screen.getByText("STANDALONE")).toBeTruthy();
      expect(screen.getByText("SWARM")).toBeTruthy();
    });

    it("should switch mode when clicking a different mode", async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText("STANDALONE")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("STANDALONE"));

      await waitFor(() => {
        // The fetch should have been called with mode switch
        const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
        const postCall = calls.find(
          (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/mode") && (c[1] as RequestInit)?.method === "POST"
        );
        expect(postCall).toBeTruthy();
      });
    });
  });

  describe("priority descriptions", () => {
    it("should show description text for each priority", () => {
      renderSettings();
      expect(screen.getByText(/WebSocket \+ SSE/)).toBeTruthy();
      expect(screen.getByText(/SSE only/)).toBeTruthy();
      expect(screen.getByText(/HTTP polling only/)).toBeTruthy();
    });
  });
});
