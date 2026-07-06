/**
 * Tests for inline image-attachment rendering in chat (adj-203.4.3 / T012).
 *
 * MessageAttachments renders each image attachment as an inline thumbnail
 * fetched through the AUTHENTICATED api client (a bare `<img src>` can't carry
 * the API key), reserves a fixed thumbnail box to avoid layout shift, and opens
 * a full-image lightbox on click. Object URLs are revoked on unmount.
 *
 * @module tests/unit/message-attachments-render
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

import type { MessageAttachment } from "../../src/types";

// Mock the api client — we only care that rendering routes through the
// authenticated fetchObjectUrl helper (not a bare src).
const fetchObjectUrl = vi.fn((id: string) => Promise.resolve(`blob:${id}`));
vi.mock("../../src/services/api", () => ({
  api: {
    uploads: {
      fetchObjectUrl: (id: string) => fetchObjectUrl(id),
      url: (id: string) => `/api/uploads/${id}`,
    },
  },
}));

import { MessageAttachments } from "../../src/components/chat/MessageAttachments";

const img1: MessageAttachment = { id: "att-1", kind: "image", filename: "a.png", mimeType: "image/png", sizeBytes: 100 };
const img2: MessageAttachment = { id: "att-2", kind: "image", filename: "b.jpg", mimeType: "image/jpeg", sizeBytes: 200 };

beforeEach(() => {
  fetchObjectUrl.mockClear();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("MessageAttachments", () => {
  it("should render one thumbnail per image attachment, fetched via the authenticated client", async () => {
    render(<MessageAttachments attachments={[img1, img2]} />);

    await waitFor(() => {
      expect(fetchObjectUrl).toHaveBeenCalledWith("att-1");
      expect(fetchObjectUrl).toHaveBeenCalledWith("att-2");
    });

    await waitFor(() => {
      const imgs = screen.getAllByRole("img");
      expect(imgs).toHaveLength(2);
      expect(imgs[0]).toHaveAttribute("src", "blob:att-1");
      expect(imgs[1]).toHaveAttribute("src", "blob:att-2");
    });
  });

  it("should render nothing when there are no attachments", () => {
    const { container } = render(<MessageAttachments attachments={[]} />);
    expect(container.firstChild).toBeNull();
    expect(fetchObjectUrl).not.toHaveBeenCalled();
  });

  it("should ignore non-image attachments", () => {
    const file: MessageAttachment = { id: "f1", kind: "file", filename: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 };
    const { container } = render(<MessageAttachments attachments={[file]} />);
    expect(container.firstChild).toBeNull();
    expect(fetchObjectUrl).not.toHaveBeenCalled();
  });

  it("should reserve a fixed thumbnail box to avoid layout shift before the image loads", () => {
    render(<MessageAttachments attachments={[img1]} />);
    // The thumbnail frame exists immediately (before the async fetch resolves),
    // reserving space so the bubble does not reflow when the image arrives.
    expect(screen.getByRole("button", { name: /a\.png/i })).toBeInTheDocument();
  });

  it("should open a full-image lightbox when a thumbnail is clicked and close it", async () => {
    render(<MessageAttachments attachments={[img1]} />);

    const thumbBtn = await screen.findByRole("button", { name: /a\.png/i });
    fireEvent.click(thumbBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // The lightbox shows the full image (same object URL).
    const fullImg = within_dialog(dialog);
    expect(fullImg).toHaveAttribute("src", "blob:att-1");

    // Closing dismisses the dialog.
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("should revoke object URLs on unmount", async () => {
    const { unmount } = render(<MessageAttachments attachments={[img1]} />);
    await waitFor(() => {
      expect(screen.getByRole("img")).toHaveAttribute("src", "blob:att-1");
    });
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:att-1");
  });
});

/** Find the image inside the lightbox dialog. */
function within_dialog(dialog: HTMLElement): HTMLElement {
  const img = dialog.querySelector("img");
  if (!img) throw new Error("no image in dialog");
  return img;
}
