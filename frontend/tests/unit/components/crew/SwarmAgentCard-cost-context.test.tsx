import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { SwarmAgentCard } from "../../../../src/components/crew/SwarmAgentCard";
import type { CrewMember } from "../../../../src/types";

// Mock useTerminalStream since it needs WebSocket
vi.mock("../../../../src/hooks/useTerminalStream", () => ({
  useTerminalStream: vi.fn(() => ({
    content: null,
    error: null,
    loading: false,
    mode: "polling",
  })),
}));

// Mock api service
vi.mock("../../../../src/services/api", () => ({
  api: {
    sessions: { kill: vi.fn() },
    messages: { send: vi.fn() },
  },
  ApiError: class extends Error {},
}));

function createAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "test-agent-1",
    name: "zealot",
    type: "agent",
    project: null,
    status: "working",
    unreadMail: 0,
    ...overrides,
  };
}

describe("SwarmAgentCard cost & context display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should display cost when agent has cost data", () => {
    render(<SwarmAgentCard agent={createAgent({ cost: 1.23 })} />);
    expect(screen.getByText("$1.23")).toBeInTheDocument();
  });

  it("should not display cost when agent has no cost data", () => {
    render(<SwarmAgentCard agent={createAgent()} />);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("should display context percentage when agent has contextPercent", () => {
    render(<SwarmAgentCard agent={createAgent({ contextPercent: 42 })} />);
    expect(screen.getByText("CTX 42%")).toBeInTheDocument();
  });

  it("should not display context when agent has no contextPercent", () => {
    render(<SwarmAgentCard agent={createAgent()} />);
    expect(screen.queryByText(/CTX/)).not.toBeInTheDocument();
  });

  it("should display both cost and context when both present", () => {
    render(
      <SwarmAgentCard agent={createAgent({ cost: 5.67, contextPercent: 88 })} />
    );
    expect(screen.getByText("$5.67")).toBeInTheDocument();
    expect(screen.getByText("CTX 88%")).toBeInTheDocument();
  });

  it("should format cost with two decimal places", () => {
    render(<SwarmAgentCard agent={createAgent({ cost: 0.1 })} />);
    expect(screen.getByText("$0.10")).toBeInTheDocument();
  });

  it("should show zero cost as $0.00", () => {
    render(<SwarmAgentCard agent={createAgent({ cost: 0 })} />);
    // cost=0 is falsy but explicitly provided — show it
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
