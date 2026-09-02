/**
 * Tests for AgentPersonaTraits (adj-158.5.2).
 *
 * The web dashboard shipped the persona BADGE but never the trait display, so
 * an agent's actual disposition was invisible on the web while iOS showed a
 * full radar + per-category breakdown (AgentDetailView personaTabContent).
 * This closes that gap against the same finished backend.
 *
 * The component is lazy on purpose: an overview page renders many agent rows,
 * and fetching every agent's persona up front would be a burst of requests for
 * data almost none of which is being looked at. It fetches on first expand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AgentPersonaTraits } from "../../src/components/personas/AgentPersonaTraits";
import { PersonaTrait, type Persona, type TraitValues } from "../../src/types";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    personas: {
      get: vi.fn(),
    },
  },
}));

function traits(overrides: Partial<Record<string, number>> = {}): TraitValues {
  const base: Record<string, number> = {};
  for (const key of Object.values(PersonaTrait)) base[key] = 0;
  return { ...base, ...overrides } as TraitValues;
}

const PERSONA: Persona = {
  id: "p1",
  name: "Abathur",
  description: "Evolution Master",
  traits: traits({
    [PersonaTrait.TECHNICAL_DEPTH]: 18,
    [PersonaTrait.CODE_REVIEW]: 15,
    [PersonaTrait.QA_SCALABILITY]: 12,
  }),
  source: "self-generated",
  createdAt: "2026-09-02T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
} as Persona;

const mockGet = vi.mocked(api.personas.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentPersonaTraits", () => {
  it("should render the persona name and its trait values once loaded", async () => {
    mockGet.mockResolvedValue(PERSONA);

    render(<AgentPersonaTraits personaId="p1" />);

    await waitFor(() => { expect(screen.getByText(/Abathur/i)).toBeTruthy(); });
    // The specific allocations must be visible — a radar alone is not a
    // "trait display", which is the half of this bead that was missing.
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith("p1");
  });

  it("should show a loading state before the persona resolves", () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    render(<AgentPersonaTraits personaId="p1" />);

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("should show an error state when the fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));

    render(<AgentPersonaTraits personaId="p1" />);

    await waitFor(() => { expect(screen.getByText(/unavailable/i)).toBeTruthy(); });
  });

  it("should fetch exactly once per personaId, not once per render", async () => {
    mockGet.mockResolvedValue(PERSONA);

    const { rerender } = render(<AgentPersonaTraits personaId="p1" />);
    await waitFor(() => { expect(screen.getByText(/Abathur/i)).toBeTruthy(); });

    rerender(<AgentPersonaTraits personaId="p1" />);
    rerender(<AgentPersonaTraits personaId="p1" />);

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("should refetch when the personaId changes", async () => {
    mockGet.mockResolvedValue(PERSONA);

    const { rerender } = render(<AgentPersonaTraits personaId="p1" />);
    await waitFor(() => { expect(mockGet).toHaveBeenCalledWith("p1"); });

    mockGet.mockResolvedValue({ ...PERSONA, id: "p2", name: "Kerrigan" });
    rerender(<AgentPersonaTraits personaId="p2" />);

    await waitFor(() => { expect(screen.getByText(/Kerrigan/i)).toBeTruthy(); });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("should not set state from a stale response when personaId changes mid-flight", async () => {
    // Guards the classic overview-page race: a slow p1 response landing after
    // the row switched to p2 must not overwrite p2's traits.
    let resolveFirst: (p: Persona) => void = () => {};
    mockGet.mockReturnValueOnce(new Promise<Persona>((r) => { resolveFirst = r; }));

    const { rerender } = render(<AgentPersonaTraits personaId="p1" />);

    mockGet.mockResolvedValueOnce({ ...PERSONA, id: "p2", name: "Kerrigan" });
    rerender(<AgentPersonaTraits personaId="p2" />);
    await waitFor(() => { expect(screen.getByText(/Kerrigan/i)).toBeTruthy(); });

    resolveFirst({ ...PERSONA, id: "p1", name: "Abathur" });

    await waitFor(() => { expect(screen.queryByText(/Abathur/i)).toBeNull(); });
    expect(screen.getByText(/Kerrigan/i)).toBeTruthy();
  });
});
