/**
 * Artifact download helpers (adj-j7az6.3.3).
 *
 * The authed download endpoint sits behind `apiKeyAuth`, so a plain anchor can't
 * carry the bearer key — `api.artifacts.download` fetches WITH the key and hands
 * back a Blob. These helpers turn that Blob into a real "save to disk" action so
 * BOTH the viewer and the artifacts list can offer an obvious Download control
 * that produces a `.html` file.
 */

import { api } from "../../services/api";

/**
 * Trigger a browser "save file" for an in-memory Blob using a throwaway anchor.
 * Splitting this out (rather than inlining) keeps the DOM side effect testable
 * and shared between the viewer's Download button and the card's download action.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fetch the composed, self-contained document for an artifact (WITH the API key)
 * and save it to disk as `<slug>.html`. Rejects with the underlying `ApiError`
 * so callers can surface a failure state.
 */
export async function saveArtifactToDisk(id: string): Promise<void> {
  const { blob, filename } = await api.artifacts.download(id);
  triggerBlobDownload(blob, filename);
}
