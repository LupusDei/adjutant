import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposeMessage } from "../../../../src/components/mail/ComposeMessage";
import { api } from "../../../../src/services/api";
import type { CrewMember } from "../../../../src/types";

// Mock the api and usePolling for RecipientSelector
vi.mock("../../../../src/services/api", () => ({
  api: {
    agents: {
      list: vi.fn(),
    },
  },
}));

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

vi.mock("../../../../src/hooks/usePolling", () => ({
  usePolling: vi.fn(() => ({
    data: [
      { id: "mayor/", name: "mayor", type: "mayor" },
      { id: "gastown_boy/witness", name: "witness", type: "witness" },
    ] as CrewMember[],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createDefaultProps() {
  return {
    onSend: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("ComposeMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.agents.list).mockResolvedValue([]);
  });

  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe("rendering", () => {
    it("should render the compose form", () => {
      render(<ComposeMessage {...createDefaultProps()} />);

      expect(screen.getByRole("form", { name: "Compose message" })).toBeInTheDocument();
      expect(screen.getByText("✉ NEW MESSAGE")).toBeInTheDocument();
      expect(screen.getByLabelText("SUBJECT:")).toBeInTheDocument();
      expect(screen.getByLabelText("PRIORITY:")).toBeInTheDocument();
      expect(screen.getByLabelText("MESSAGE:")).toBeInTheDocument();
    });

    it("should render as reply when replyTo is provided", () => {
      render(<ComposeMessage {...createDefaultProps()} replyTo="msg-123" />);

      expect(screen.getByText("↩ COMPOSE REPLY")).toBeInTheDocument();
    });

    it("should pre-fill subject when initialSubject is provided", () => {
      render(<ComposeMessage {...createDefaultProps()} initialSubject="Re: Hello" />);

      expect(screen.getByLabelText("SUBJECT:")).toHaveValue("Re: Hello");
    });

    it("should show character count", async () => {
      const user = userEvent.setup();
      render(<ComposeMessage {...createDefaultProps()} />);

      const textarea = screen.getByLabelText("MESSAGE:");
      await user.type(textarea, "Hello World");

      expect(screen.getByText("11 CHARS")).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Priority Selection
  // ===========================================================================

  describe("priority selection", () => {
    it("should have default priority of NORMAL (2)", () => {
      render(<ComposeMessage {...createDefaultProps()} />);

      expect(screen.getByLabelText("PRIORITY:")).toHaveValue("2");
    });

    it("should allow changing priority", async () => {
      const user = userEvent.setup();
      render(<ComposeMessage {...createDefaultProps()} />);

      const select = screen.getByLabelText("PRIORITY:");
      await user.selectOptions(select, "1");

      expect(select).toHaveValue("1");
    });

    it("should show all priority options", () => {
      render(<ComposeMessage {...createDefaultProps()} />);

      expect(screen.getByRole("option", { name: "!!! URGENT" })).toHaveValue("0");
      expect(screen.getByRole("option", { name: "!! HIGH" })).toHaveValue("1");
      expect(screen.getByRole("option", { name: "NORMAL" })).toHaveValue("2");
      expect(screen.getByRole("option", { name: "▽ LOW" })).toHaveValue("3");
      expect(screen.getByRole("option", { name: "▽▽ LOWEST" })).toHaveValue("4");
    });
  });

  // ===========================================================================
  // Form Validation
  // ===========================================================================

  describe("form validation", () => {
    it("should disable send button when form is incomplete", () => {
      render(<ComposeMessage {...createDefaultProps()} />);

      expect(screen.getByRole("button", { name: /SEND/i })).toBeDisabled();
    });

    it("should enable send button when form is complete", async () => {
      const user = userEvent.setup();
      render(<ComposeMessage {...createDefaultProps()} />);

      await user.type(screen.getByLabelText("SUBJECT:"), "Test Subject");
      await user.type(screen.getByLabelText("MESSAGE:"), "Test body");

      expect(screen.getByRole("button", { name: /SEND/i })).not.toBeDisabled();
    });

    it("should require subject to be non-empty", async () => {
      const user = userEvent.setup();
      render(<ComposeMessage {...createDefaultProps()} />);

      await user.type(screen.getByLabelText("SUBJECT:"), "   ");
      await user.type(screen.getByLabelText("MESSAGE:"), "Test body");

      expect(screen.getByRole("button", { name: /SEND/i })).toBeDisabled();
    });

    it("should require body to be non-empty", async () => {
      const user = userEvent.setup();
      render(<ComposeMessage {...createDefaultProps()} />);

      await user.type(screen.getByLabelText("SUBJECT:"), "Test Subject");
      await user.type(screen.getByLabelText("MESSAGE:"), "   ");

      expect(screen.getByRole("button", { name: /SEND/i })).toBeDisabled();
    });
  });

  // ===========================================================================
  // Form Submission
  // ===========================================================================

  describe("form submission", () => {
    it("should call onSend with correct data", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ComposeMessage {...createDefaultProps()} onSend={onSend} />);

      await user.type(screen.getByLabelText("SUBJECT:"), "Test Subject");
      await user.type(screen.getByLabelText("MESSAGE:"), "Test body");
      await user.selectOptions(screen.getByLabelText("PRIORITY:"), "1");

      await user.click(screen.getByRole("button", { name: /SEND/i }));

      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith({
          to: "mayor/",
          subject: "Test Subject",
          body: "Test body",
          priority: 1,
          type: "task",
        });
      });
    });

    it("should include replyTo in request when replying", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ComposeMessage {...createDefaultProps()} onSend={onSend} replyTo="msg-123" />);

      await user.type(screen.getByLabelText("SUBJECT:"), "Re: Test");
      await user.type(screen.getByLabelText("MESSAGE:"), "Reply body");

      await user.click(screen.getByRole("button", { name: /SEND/i }));

      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "reply",
            replyTo: "msg-123",
          })
        );
      });
    });

    it("should trim subject and body", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ComposeMessage {...createDefaultProps()} onSend={onSend} />);

      await user.type(screen.getByLabelText("SUBJECT:"), "  Test Subject  ");
      await user.type(screen.getByLabelText("MESSAGE:"), "  Test body  ");

      await user.click(screen.getByRole("button", { name: /SEND/i }));

      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith(
          expect.objectContaining({
            subject: "Test Subject",
            body: "Test body",
          })
        );
      });
    });
  });

  // ===========================================================================
  // Cancel Action
  // ===========================================================================

  describe("cancel action", () => {
    it("should call onCancel when cancel button clicked", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<ComposeMessage {...createDefaultProps()} onCancel={onCancel} />);

      await user.click(screen.getByRole("button", { name: /CANCEL/i }));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Sending State
  // ===========================================================================

  describe("sending state", () => {
    it("should show SENDING when sending is true", () => {
      render(<ComposeMessage {...createDefaultProps()} sending={true} />);

      expect(screen.getByRole("button", { name: /SENDING/i })).toBeInTheDocument();
    });

    it("should disable all inputs when sending", () => {
      render(<ComposeMessage {...createDefaultProps()} sending={true} />);

      expect(screen.getByLabelText("SUBJECT:")).toBeDisabled();
      expect(screen.getByLabelText("PRIORITY:")).toBeDisabled();
      expect(screen.getByLabelText("MESSAGE:")).toBeDisabled();
      expect(screen.getByRole("button", { name: /CANCEL/i })).toBeDisabled();
    });
  });

  // ===========================================================================
  // Error Display
  // ===========================================================================

  describe("error display", () => {
    it("should show error banner when sendError is provided", () => {
      render(
        <ComposeMessage
          {...createDefaultProps()}
          sendError={new Error("Network error")}
        />
      );

      expect(screen.getByRole("alert")).toHaveTextContent("SEND FAILED: Network error");
      expect(screen.getByText("✓ DRAFT PRESERVED")).toBeInTheDocument();
    });

    it("should show retry button on error", () => {
      render(
        <ComposeMessage
          {...createDefaultProps()}
          sendError={new Error("Network error")}
        />
      );

      expect(screen.getByRole("button", { name: /RETRY/i })).toBeInTheDocument();
    });

    it("should call onClearError when dismiss button clicked", async () => {
      const user = userEvent.setup();
      const onClearError = vi.fn();
      render(
        <ComposeMessage
          {...createDefaultProps()}
          sendError={new Error("Network error")}
          onClearError={onClearError}
        />
      );

      await user.click(screen.getByRole("button", { name: "✕" }));

      expect(onClearError).toHaveBeenCalled();
    });
  });
});
