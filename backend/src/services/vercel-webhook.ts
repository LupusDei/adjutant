/**
 * Vercel webhook helpers — signature verification + payload normalization.
 *
 * Vercel signs webhook deliveries with HMAC-SHA1 of the raw request body
 * using the integration's shared secret. The signature is provided as a hex
 * string in the `x-vercel-signature` header.
 *
 * Reference: https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Vercel deployment lifecycle event types we surface on the dashboard. */
export const VERCEL_DEPLOY_EVENT_TYPES = [
  "deployment.created",
  "deployment.succeeded",
  "deployment.error",
  "deployment.canceled",
] as const;

export type VercelDeployEventType = (typeof VERCEL_DEPLOY_EVENT_TYPES)[number];

export function isVercelDeployEventType(value: unknown): value is VercelDeployEventType {
  return typeof value === "string" && (VERCEL_DEPLOY_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Verify a Vercel webhook signature.
 *
 * Returns true iff the HMAC-SHA1 of `rawBody` using `secret` equals
 * the `signature` hex string. Uses constant-time comparison.
 *
 * Empty secret or signature always returns false.
 */
export function verifyVercelSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false;

  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");

  // Lengths must match for timingSafeEqual; mismatched length is an obvious fail.
  if (expected.length !== signature.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    // Buffer.from may throw on malformed hex; treat as failed verification.
    return false;
  }
}

// ----------------------------------------------------------------------------
// Payload normalization
// ----------------------------------------------------------------------------

/**
 * Minimal shape of a Vercel deployment-event payload we care about.
 * Vercel sends many fields; we only normalize the ones the dashboard surface
 * displays. Unknown fields are preserved in `detail.raw` for debugging.
 */
export interface VercelDeploymentPayload {
  type: string;
  id?: string;
  createdAt?: number;
  payload?: {
    deployment?: {
      id?: string;
      url?: string;
      name?: string;
      meta?: Record<string, unknown>;
      target?: string;
      inspectorUrl?: string;
    };
    project?: {
      id?: string;
      name?: string;
    };
    target?: string;
    url?: string;
    name?: string;
  };
}

export interface NormalizedDeployEvent {
  /** Vercel event type (e.g., "deployment.succeeded") */
  vercelEventType: VercelDeployEventType;
  /** Short status derived from the event type ("created" | "succeeded" | "error" | "canceled") */
  status: "created" | "succeeded" | "error" | "canceled";
  /** Display name of the Vercel project (e.g., "bloomfolio") */
  projectName: string;
  /** Vercel project ID (if present) */
  projectId: string | null;
  /** Environment label — "Production" or "Preview" */
  environment: "Production" | "Preview" | "Unknown";
  /** Full deploy URL (https://...) */
  deployUrl: string | null;
  /** Vercel deployment ID (dpl_...) */
  deploymentId: string | null;
  /** Commit SHA from GitHub metadata, if present */
  commitSha: string | null;
  /** Short commit SHA (7 chars) for display */
  commitShaShort: string | null;
  /** GitHub org/owner from meta */
  githubOrg: string | null;
  /** GitHub repo from meta */
  githubRepo: string | null;
  /** Direct link to the commit on GitHub, if we have the metadata */
  commitUrl: string | null;
  /** Vercel deployment inspector URL */
  inspectorUrl: string | null;
  /** Event creation timestamp (Vercel-supplied, ms epoch), as ISO string */
  occurredAt: string | null;
  /** Best-effort human-readable action string */
  action: string;
}

const STATUS_FROM_EVENT: Record<VercelDeployEventType, NormalizedDeployEvent["status"]> = {
  "deployment.created": "created",
  "deployment.succeeded": "succeeded",
  "deployment.error": "error",
  "deployment.canceled": "canceled",
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function ensureUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

/**
 * Normalize a Vercel deployment payload into a flat, dashboard-friendly shape.
 *
 * The Vercel webhook schema has evolved across API versions — some fields are
 * sometimes nested under `payload.deployment`, sometimes hoisted to the
 * top of `payload`. We look in both locations and take the first non-empty
 * value.
 */
export function normalizeVercelDeployPayload(
  body: VercelDeploymentPayload,
): NormalizedDeployEvent | null {
  if (!isVercelDeployEventType(body.type)) return null;

  const deployment = body.payload?.deployment ?? {};
  const project = body.payload?.project ?? {};
  const meta: Record<string, unknown> = deployment.meta ?? {};

  const projectName =
    asString(project.name) ??
    asString(body.payload?.name) ??
    asString(deployment.name) ??
    "unknown-project";

  const target =
    asString(deployment.target) ??
    asString(body.payload?.target) ??
    null;
  const environment: NormalizedDeployEvent["environment"] =
    target === "production" ? "Production" : target === "preview" ? "Preview" : "Unknown";

  const deployUrl = ensureUrl(asString(deployment.url) ?? asString(body.payload?.url));
  const inspectorUrl = ensureUrl(asString(deployment.inspectorUrl));

  const commitSha =
    asString(meta["githubCommitSha"]) ??
    asString(meta["gitlabCommitSha"]) ??
    asString(meta["bitbucketCommitSha"]) ??
    null;
  const commitShaShort = commitSha ? commitSha.slice(0, 7) : null;

  const githubOrg = asString(meta["githubCommitOrg"]) ?? asString(meta["githubOrg"]);
  const githubRepo = asString(meta["githubCommitRepo"]) ?? asString(meta["githubRepo"]);
  const commitUrl =
    commitSha && githubOrg && githubRepo
      ? `https://github.com/${githubOrg}/${githubRepo}/commit/${commitSha}`
      : null;

  const status = STATUS_FROM_EVENT[body.type];

  const occurredAt =
    typeof body.createdAt === "number" ? new Date(body.createdAt).toISOString() : null;

  const action =
    `${projectName} ${environment} ${status}` +
    (commitShaShort ? ` @ ${commitShaShort}` : "");

  return {
    vercelEventType: body.type,
    status,
    projectName,
    projectId: asString(project.id),
    environment,
    deployUrl,
    deploymentId: asString(deployment.id),
    commitSha,
    commitShaShort,
    githubOrg,
    githubRepo,
    commitUrl,
    inspectorUrl,
    occurredAt,
    action,
  };
}
