/**
 * Tests for CreateArtifactForm (adj-j7az6.3.4 / T304a).
 *
 * The form lets the Commander author an artifact by pasting HTML OR uploading a
 * `.html` file, plus a required title. Submit calls api.artifacts.create; empty
 * html (or empty title) is blocked before any network call.
 *
 * @module tests/unit/create-artifact-form
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { CreateArtifactForm } from "../../src/components/artifacts/CreateArtifactForm";
import type { Artifact } from "../../src/types";
import { api } from "../../src/services/api";

vi.mock("../../src/services/api", () => ({
  api: {
    artifacts: {
      create: vi.fn(),
    },
  },
}));

const created: Artifact = {
  id: "new1",
  title: "Pasted Page",
  html: "<h1>Pasted</h1>",
  isPublic: false,
  createdAt: "2026-08-10T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
};

function setInput(labelOrPlaceholder: RegExp, value: string): void {
  const el = screen.getByLabelText(labelOrPlaceholder);
  fireEvent.change(el, { target: { value } });
}

describe("CreateArtifactForm (adj-j7az6.3.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a title field and an HTML textarea", () => {
    render(createElement(CreateArtifactForm, { onCreated: () => {}, onClose: () => {} }));
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/html/i)).toBeTruthy();
  });

  it("blocks submit and shows a validation message when HTML is empty", async () => {
    const onCreated = vi.fn();
    render(createElement(CreateArtifactForm, { onCreated, onClose: () => {} }));

    setInput(/title/i, "Has Title");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText(/html is required|paste or upload/i)).toBeTruthy();
    });
    expect(api.artifacts.create).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("blocks submit when the title is empty", async () => {
    render(createElement(CreateArtifactForm, { onCreated: () => {}, onClose: () => {} }));
    setInput(/html/i, "<h1>Body</h1>");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeTruthy();
    });
    expect(api.artifacts.create).not.toHaveBeenCalled();
  });

  it("submits pasted HTML + title and calls onCreated with the result", async () => {
    vi.mocked(api.artifacts.create).mockResolvedValue(created);
    const onCreated = vi.fn();
    render(createElement(CreateArtifactForm, { onCreated, onClose: () => {} }));

    setInput(/title/i, "Pasted Page");
    setInput(/html/i, "<h1>Pasted</h1>");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(api.artifacts.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Pasted Page", html: "<h1>Pasted</h1>" }),
      );
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("populates the HTML from an uploaded .html file", async () => {
    render(createElement(CreateArtifactForm, { onCreated: () => {}, onClose: () => {} }));

    const fileText = "<!doctype html><h1>Uploaded</h1>";
    const file = new File([fileText], "page.html", { type: "text/html" });
    // jsdom File.text() may be missing — stub it deterministically.
    if (typeof file.text !== "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (file as any).text = () => Promise.resolve(fileText);
    }

    const fileInput = screen.getByLabelText(/upload/i);
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const textarea = screen.getByLabelText<HTMLTextAreaElement>(/html/i);
      expect(textarea.value).toContain("Uploaded");
    });
  });

  it("shows an error and preserves the draft when create fails", async () => {
    vi.mocked(api.artifacts.create).mockRejectedValue(new Error("nope"));
    render(createElement(CreateArtifactForm, { onCreated: () => {}, onClose: () => {} }));

    setInput(/title/i, "Draft Title");
    setInput(/html/i, "<h1>Draft</h1>");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText(/nope|failed/i)).toBeTruthy();
    });
    // Draft preserved for retry.
    expect(screen.getByLabelText<HTMLTextAreaElement>(/html/i).value).toContain("Draft");
  });

  it("calls onClose when the cancel control is clicked", () => {
    const onClose = vi.fn();
    render(createElement(CreateArtifactForm, { onCreated: () => {}, onClose }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
