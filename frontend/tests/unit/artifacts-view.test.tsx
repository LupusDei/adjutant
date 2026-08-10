/**
 * Tests for ArtifactsView + ArtifactCard (adj-j7az6.3.2 / T302a).
 *
 * The view lists artifacts from api.artifacts.list, shows published/unpublished
 * state, and exposes view / share / download / delete actions plus a
 * publish/unpublish toggle and a NEW ARTIFACT create flow.
 *
 * @module tests/unit/artifacts-view
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createElement } from "react";

import { ArtifactsView } from "../../src/components/artifacts/ArtifactsView";
import type { Artifact } from "../../src/types";
import { api } from "../../src/services/api";
import { saveArtifactToDisk } from "../../src/components/artifacts/artifact-download";

vi.mock("../../src/services/api", () => ({
  api: {
    artifacts: {
      list: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
      unpublish: vi.fn(),
      download: vi.fn(),
      create: vi.fn(),
    },
  },
  buildPublicArtifactUrl: (t: string) => `https://dash.example/a/${t}`,
}));

vi.mock("../../src/components/artifacts/artifact-download", () => ({
  saveArtifactToDisk: vi.fn(),
  triggerBlobDownload: vi.fn(),
}));

const privateArtifact: Artifact = {
  id: "a1",
  title: "Private Page",
  html: "<h1>P</h1>",
  isPublic: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const publishedArtifact: Artifact = {
  id: "a2",
  title: "Public Page",
  html: "<h1>Q</h1>",
  isPublic: true,
  shareToken: "tok123456789abcd",
  publishedAt: "2026-08-02T00:00:00Z",
  createdAt: "2026-08-02T00:00:00Z",
  updatedAt: "2026-08-02T00:00:00Z",
};

function cardFor(title: RegExp): HTMLElement {
  // The card root is the closest ancestor that also contains the action buttons.
  return screen.getByText(title).closest<HTMLElement>("[data-artifact-card]")!;
}

describe("ArtifactsView (adj-j7az6.3.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.artifacts.list).mockResolvedValue([privateArtifact, publishedArtifact]);
  });

  it("renders the list of artifacts from the api", async () => {
    render(createElement(ArtifactsView, {}));
    await waitFor(() => {
      expect(screen.getByText(/Private Page/i)).toBeTruthy();
      expect(screen.getByText(/Public Page/i)).toBeTruthy();
    });
    expect(api.artifacts.list).toHaveBeenCalled();
  });

  it("shows published vs private state", async () => {
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Public Page/i);
    const published = cardFor(/Public Page/i);
    const priv = cardFor(/Private Page/i);
    expect(within(published).getByText(/^published$/i)).toBeTruthy();
    expect(within(priv).getByText(/^private$/i)).toBeTruthy();
  });

  it("exposes view / download / delete actions on each card", async () => {
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Private Page/i);
    const card = cardFor(/Private Page/i);
    expect(within(card).getByRole("button", { name: /view/i })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /download/i })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("download action saves the artifact to disk", async () => {
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Private Page/i);
    const card = cardFor(/Private Page/i);
    fireEvent.click(within(card).getByRole("button", { name: /download/i }));
    await waitFor(() => {
      expect(saveArtifactToDisk).toHaveBeenCalledWith("a1");
    });
  });

  it("delete action calls api.artifacts.delete and removes the card", async () => {
    vi.mocked(api.artifacts.delete).mockResolvedValue({ id: "a1", deleted: true });
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Private Page/i);
    const card = cardFor(/Private Page/i);
    fireEvent.click(within(card).getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(api.artifacts.delete).toHaveBeenCalledWith("a1");
    });
    await waitFor(() => {
      expect(screen.queryByText(/Private Page/i)).toBeNull();
    });
  });

  it("publish toggle calls api.artifacts.publish for a private artifact", async () => {
    vi.mocked(api.artifacts.publish).mockResolvedValue({
      artifact: { ...privateArtifact, isPublic: true, shareToken: "tok123456789abcd" },
      publicUrl: "https://dash.example/a/tok123456789abcd",
    });
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Private Page/i);
    const card = cardFor(/Private Page/i);
    fireEvent.click(within(card).getByRole("button", { name: /^publish$/i }));
    await waitFor(() => {
      expect(api.artifacts.publish).toHaveBeenCalledWith("a1");
    });
  });

  it("share action copies the public url for a published artifact", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Public Page/i);
    const card = cardFor(/Public Page/i);
    fireEvent.click(within(card).getByRole("button", { name: /share/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://dash.example/a/tok123456789abcd");
    });
  });

  it("NEW ARTIFACT opens the create form", async () => {
    render(createElement(ArtifactsView, {}));
    await screen.findByText(/Private Page/i);
    fireEvent.click(screen.getByRole("button", { name: /new artifact/i }));
    expect(screen.getByRole("dialog", { name: /create artifact/i })).toBeTruthy();
  });

  it("shows an empty state when there are no artifacts", async () => {
    vi.mocked(api.artifacts.list).mockResolvedValue([]);
    render(createElement(ArtifactsView, {}));
    await waitFor(() => {
      expect(screen.getByText(/no artifacts/i)).toBeTruthy();
    });
  });

  it("shows an error state when the list fails to load", async () => {
    vi.mocked(api.artifacts.list).mockRejectedValue(new Error("boom"));
    render(createElement(ArtifactsView, {}));
    await waitFor(() => {
      expect(screen.getByText(/error|failed/i)).toBeTruthy();
    });
  });
});
