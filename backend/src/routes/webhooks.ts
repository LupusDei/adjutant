/**
 * Webhook receivers for external services (Vercel, etc.).
 *
 * These routes authenticate by cryptographic signature over the raw request
 * body, NOT via the dashboard API key. They MUST be mounted before any global
 * JSON body parser so the raw bytes are still available for HMAC verification.
 */

import { Router, type Request, type Response } from "express";
import express from "express";

import type { EventStore } from "../services/event-store.js";
import {
  normalizeVercelDeployPayload,
  verifyVercelSignature,
  type VercelDeploymentPayload,
} from "../services/vercel-webhook.js";
import { badRequest, error, serviceUnavailable, success, unauthorized } from "../utils/responses.js";
import { logInfo, logWarn } from "../utils/logger.js";

const VERCEL_SIGNATURE_HEADER = "x-vercel-signature";

/** 1 MB cap matches Vercel's documented webhook payload ceiling. */
const RAW_BODY_LIMIT = "1mb";

export function createWebhooksRouter(eventStore: EventStore): Router {
  const router = Router();

  // Parse JSON-shaped bodies as raw Buffer so the HMAC step sees the exact
  // bytes Vercel signed. We re-parse JSON manually below.
  const rawJsonParser = express.raw({ type: "application/json", limit: RAW_BODY_LIMIT });

  router.post("/vercel", rawJsonParser, (req: Request, res: Response) => {
    const secret = process.env["VERCEL_WEBHOOK_SECRET"];
    if (!secret) {
      logWarn("vercel webhook rejected: secret not configured");
      return res
        .status(503)
        .json(serviceUnavailable("VERCEL_WEBHOOK_SECRET is not configured"));
    }

    const signature = req.header(VERCEL_SIGNATURE_HEADER);
    if (!signature) {
      logWarn("vercel webhook rejected: missing signature header");
      return res.status(400).json(badRequest(`Missing ${VERCEL_SIGNATURE_HEADER} header`));
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody || rawBody.length === 0) {
      return res.status(400).json(badRequest("Empty webhook body"));
    }

    if (!verifyVercelSignature(rawBody, signature, secret)) {
      logWarn("vercel webhook rejected: invalid signature", {
        sigPrefix: signature.slice(0, 8),
        bodyBytes: rawBody.length,
      });
      return res.status(401).json(unauthorized("Invalid webhook signature"));
    }

    let parsed: VercelDeploymentPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as VercelDeploymentPayload;
    } catch (err) {
      logWarn("vercel webhook rejected: malformed JSON", { error: String(err) });
      return res.status(400).json(badRequest("Malformed JSON body"));
    }

    const normalized = normalizeVercelDeployPayload(parsed);
    if (!normalized) {
      // Acknowledge events we don't surface (e.g., project.created) so Vercel
      // does not retry them. 200 with `ignored: true` is the documented pattern.
      logInfo("vercel webhook ignored: unsupported event type", { type: parsed.type });
      return res.status(200).json(success({ ignored: true, type: parsed.type ?? null }));
    }

    try {
      const event = eventStore.insertEvent({
        eventType: "deploy_status",
        agentId: "vercel",
        action: normalized.action,
        detail: {
          source: "vercel",
          vercelEventType: normalized.vercelEventType,
          status: normalized.status,
          projectName: normalized.projectName,
          projectId: normalized.projectId,
          environment: normalized.environment,
          deployUrl: normalized.deployUrl,
          deploymentId: normalized.deploymentId,
          commitSha: normalized.commitSha,
          commitShaShort: normalized.commitShaShort,
          githubOrg: normalized.githubOrg,
          githubRepo: normalized.githubRepo,
          commitUrl: normalized.commitUrl,
          inspectorUrl: normalized.inspectorUrl,
          occurredAt: normalized.occurredAt,
        },
      });

      logInfo("vercel webhook accepted", {
        eventId: event.id,
        vercelEventType: normalized.vercelEventType,
        projectName: normalized.projectName,
        environment: normalized.environment,
      });

      return res.status(200).json(success({ eventId: event.id, status: normalized.status }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn("vercel webhook failed to persist event", { error: message });
      return res
        .status(500)
        .json(error("INTERNAL_ERROR", "Failed to record deploy event", message));
    }
  });

  return router;
}
