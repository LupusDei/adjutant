/**
 * Uploads REST routes (adj-203.2.2).
 *
 * - POST /api/uploads       — multipart single-image upload. multer parses the
 *   body into memory (hard file-size + count caps), the UploadService validates
 *   (magic-byte allowlist), stores the file, and inserts an unlinked attachment
 *   row. Returns `{ id, filename, mimeType, sizeBytes }`.
 * - GET  /api/uploads/:id   — stream the stored image (authenticated: the whole
 *   router is mounted BEHIND apiKeyAuth in index.ts). Unknown / missing → 404.
 *
 * The route is a thin adapter: no filesystem or DB access here (layered
 * architecture) — everything goes through UploadService.
 */

import { Router } from "express";
import multer from "multer";
import type { MulterError } from "multer";

import type { UploadService } from "../services/upload-service.js";
import { UploadValidationError } from "../services/upload-service.js";
import { MAX_UPLOAD_BYTES } from "../services/upload-storage.js";
import { success, validationError, notFound } from "../utils/responses.js";
import { logInfo, logWarn } from "../utils/logger.js";

export function createUploadsRouter(service: UploadService): Router {
  const router = Router();

  // In-memory single-file parse. The hard caps live HERE (defense in depth on
  // top of the service's own size check): one file, ≤ MAX_UPLOAD_BYTES.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // POST /api/uploads
  router.post("/", (req, res) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const mErr = err as MulterError;
        const code = mErr.code === "LIMIT_FILE_SIZE" ? "too-large" : "upload-error";
        const message =
          mErr.code === "LIMIT_FILE_SIZE"
            ? `Upload exceeds ${MAX_UPLOAD_BYTES} bytes`
            : (mErr.message ?? "Malformed upload");
        logWarn("upload rejected by parser", { code });
        return res.status(400).json(validationError(message, code));
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json(validationError("A single image file field 'file' is required", "missing-file"));
      }

      try {
        const result = service.upload({
          buffer: file.buffer,
          filename: file.originalname,
          declaredMime: file.mimetype,
        });
        logInfo("upload stored", { id: result.id, mimeType: result.mimeType, sizeBytes: result.sizeBytes });
        return res.status(201).json(success(result));
      } catch (e) {
        if (e instanceof UploadValidationError) {
          return res.status(400).json(validationError(e.message, e.code));
        }
        throw e;
      }
    });
  });

  // GET /api/uploads/:id — authenticated stream (auth is global, mounted before this router).
  router.get("/:id", (req, res) => {
    const { id } = req.params;
    const file = service.getFileForServe(id);
    if (file === null) {
      return res.status(404).json(notFound("Upload", id));
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    // Private cache: the image is served behind auth to the operator's own client.
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);

    file.stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    file.stream.pipe(res);
    return undefined;
  });

  return router;
}
