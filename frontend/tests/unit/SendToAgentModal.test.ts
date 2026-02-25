import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { SendToAgentModal } from "../../src/components/proposals/SendToAgentModal";
import type { Proposal, CrewMember } from "../../src/types";

const mockProposal: Proposal = {
  id: "p1",
  author: "agent-1",
  title: "Improve UX",
  description: "Add onboarding flow for new users",
  type: "product",
  status: "accepted",
  createdAt: "2026-02-24T00:00:00Z",
  updatedAt: "2026-02-24T01:00:00Z",
};

const mockAgents: CrewMember[] = [
  {
    id: "a1",
    name: "karax",
    type: "agent",
    status: "idle",
    unreadMail: 0,
    currentTask: undefined,
  } as CrewMember,
  {
    id: "a2",
    name: "fenix",
    type: "agent",
    status: "working",
    unreadMail: 0,
    currentTask: "Building feature X",
  } as CrewMember,
];

const { mockAgentList, mockMessagesSend, mockSessionsCreate, mockSessionsSendInput } = vi.hoisted(() => ({
  mockAgentList: vi.fn(),
  mockMessagesSend: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockSessionsSendInput: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  api: {
    agents: { list: mockAgentList },
    messages: { send: mockMessagesSend },
    sessions: {
      create: mockSessionsCreate,
      sendInput: mockSessionsSendInput,
    },
  },
  ApiError: class ApiError extends Error {},
}));

describe("SendToAgentModal", () => {
  const onClose = vi.fn();
  const onSent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentList.mockResolvedValue(mockAgents);
    mockMessagesSend.mockResolvedValue({ messageId: "m1", timestamp: "2026-02-24T00:00:00Z" });
    mockSessionsCreate.mockResolvedValue({
      id: "s1",
      name: "probe",
      tmuxSession: "adj-probe",
      tmuxPane: "%0",
      projectPath: "/test",
      mode: "swarm",
      status: "idle",
      workspaceType: "primary",
      connectedClients: [],
      pipeActive: false,
      createdAt: "2026-02-24T00:00:00Z",
      lastActivity: "2026-02-24T00:00:00Z",
    });
    mockSessionsSendInput.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderModal() {
    return render(
      createElement(SendToAgentModal, {
        proposal: mockProposal,
        onClose,
        onSent,
      })
    );
  }

  it("renders modal with header and tabs", () => {
    renderModal();

    expect(screen.getByText("SEND TO AGENT")).toBeTruthy();
    expect(screen.getByText("EXISTING AGENT")).toBeTruthy();
    expect(screen.getByText("SPAWN NEW")).toBeTruthy();
  });

  it("shows proposal summary", () => {
    renderModal();

    expect(screen.getByText("Improve UX")).toBeTruthy();
    expect(screen.getByText("PRODUCT")).toBeTruthy();
  });

  it("fetches and displays agents on mount", async () => {
    renderModal();

    await waitFor(() => {
      expect(mockAgentList).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("KARAX")).toBeTruthy();
      expect(screen.getByText("FENIX")).toBeTruthy();
    });
  });

  it("filters out offline agents", async () => {
    mockAgentList.mockResolvedValue([
      ...mockAgents,
      {
        id: "a3",
        name: "offline-agent",
        type: "agent",
        status: "offline",
        unreadMail: 0,
      } as CrewMember,
    ]);

    renderModal();

    await waitFor(() => {
      expect(screen.getByText("KARAX")).toBeTruthy();
    });

    expect(screen.queryByText("OFFLINE-AGENT")).toBeNull();
  });

  it("shows empty state when no agents", async () => {
    mockAgentList.mockResolvedValue([]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText("NO ACTIVE AGENTS FOUND")).toBeTruthy();
    });
  });

  it("selects an agent from the list", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText("KARAX")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("KARAX"));

    const sendBtn = screen.getByText("SEND MESSAGE");
    expect(sendBtn).toBeTruthy();
  });

  it("sends message to selected existing agent", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText("KARAX")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("KARAX"));
    fireEvent.click(screen.getByText("SEND MESSAGE"));

    await waitFor(() => {
      expect(mockMessagesSend).toHaveBeenCalledWith({
        to: "karax",
        body: expect.stringContaining("Improve UX"),
        threadId: "proposal-p1",
      });
    });
  });

  it("switches to spawn tab", () => {
    renderModal();

    fireEvent.click(screen.getByText("SPAWN NEW"));

    expect(screen.getByText("CALLSIGN (OPTIONAL)")).toBeTruthy();
    expect(screen.getByText("SPAWN & SEND")).toBeTruthy();
  });

  it("spawns new agent and sends proposal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderModal();

    fireEvent.click(screen.getByText("SPAWN NEW"));
    fireEvent.click(screen.getByText("SPAWN & SEND"));

    await waitFor(() => {
      expect(mockSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "swarm",
          workspaceType: "primary",
        })
      );
    });

    vi.useRealTimers();
  });

  it("spawns agent with custom callsign", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderModal();

    fireEvent.click(screen.getByText("SPAWN NEW"));

    const input = screen.getByPlaceholderText("Auto-assigned if empty...");
    fireEvent.change(input, { target: { value: "zeratul" } });
    fireEvent.click(screen.getByText("SPAWN & SEND"));

    await waitFor(() => {
      expect(mockSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "zeratul" })
      );
    });

    vi.useRealTimers();
  });

  it("closes on escape key", () => {
    renderModal();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel button", () => {
    renderModal();

    fireEvent.click(screen.getByText("CANCEL"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error when send fails", async () => {
    mockMessagesSend.mockRejectedValue(new Error("Network error"));

    renderModal();

    await waitFor(() => {
      expect(screen.getByText("KARAX")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("KARAX"));
    fireEvent.click(screen.getByText("SEND MESSAGE"));

    await waitFor(() => {
      expect(screen.getByText(/ERROR:/)).toBeTruthy();
    });
  });

  it("shows error when spawn fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSessionsCreate.mockRejectedValue(new Error("Spawn failed"));

    renderModal();

    fireEvent.click(screen.getByText("SPAWN NEW"));
    fireEvent.click(screen.getByText("SPAWN & SEND"));

    await waitFor(() => {
      expect(screen.getByText(/ERROR:/)).toBeTruthy();
    });

    vi.useRealTimers();
  });
});
