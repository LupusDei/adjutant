import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  normalizeVercelDeployPayload,
  verifyVercelSignature,
  isVercelDeployEventType,
} from "../../src/services/vercel-webhook.js";

describe("verifyVercelSignature", () => {
  const SECRET = "shh";
  const body = Buffer.from('{"type":"deployment.succeeded"}', "utf8");
  const validSig = createHmac("sha1", SECRET).update(body).digest("hex");

  it("returns true for a matching HMAC-SHA1 hex signature", () => {
    expect(verifyVercelSignature(body, validSig, SECRET)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const wrong = createHmac("sha1", "different-secret").update(body).digest("hex");
    expect(verifyVercelSignature(body, wrong, SECRET)).toBe(false);
  });

  it("returns false when secret is missing", () => {
    expect(verifyVercelSignature(body, validSig, undefined)).toBe(false);
    expect(verifyVercelSignature(body, validSig, "")).toBe(false);
  });

  it("returns false when signature is missing", () => {
    expect(verifyVercelSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyVercelSignature(body, "", SECRET)).toBe(false);
  });

  it("returns false on malformed hex signatures rather than throwing", () => {
    expect(() => verifyVercelSignature(body, "not-hex!!", SECRET)).not.toThrow();
    expect(verifyVercelSignature(body, "not-hex!!", SECRET)).toBe(false);
  });

  it("returns false on length-mismatched signatures (defends against truncation tricks)", () => {
    expect(verifyVercelSignature(body, validSig.slice(0, 10), SECRET)).toBe(false);
  });
});

describe("isVercelDeployEventType", () => {
  it("accepts the four deployment event types", () => {
    expect(isVercelDeployEventType("deployment.created")).toBe(true);
    expect(isVercelDeployEventType("deployment.succeeded")).toBe(true);
    expect(isVercelDeployEventType("deployment.error")).toBe(true);
    expect(isVercelDeployEventType("deployment.canceled")).toBe(true);
  });

  it("rejects unrelated event types", () => {
    expect(isVercelDeployEventType("project.created")).toBe(false);
    expect(isVercelDeployEventType("integration.removed")).toBe(false);
    expect(isVercelDeployEventType(undefined)).toBe(false);
    expect(isVercelDeployEventType(null)).toBe(false);
    expect(isVercelDeployEventType(42)).toBe(false);
  });
});

describe("normalizeVercelDeployPayload", () => {
  const basePayload = {
    type: "deployment.succeeded" as const,
    id: "evt_1",
    createdAt: 1700000000000,
    payload: {
      deployment: {
        id: "dpl_1",
        url: "myapp-abc.vercel.app",
        target: "production",
        inspectorUrl: "https://vercel.com/org/app/dpl_1",
        meta: {
          githubCommitSha: "abcdef0123456789abcdef0123456789abcdef01",
          githubCommitOrg: "myorg",
          githubCommitRepo: "myapp",
        },
      },
      project: { id: "prj_1", name: "myapp" },
    },
  };

  it("returns a flat dashboard-friendly shape for a real Vercel payload", () => {
    const result = normalizeVercelDeployPayload(basePayload);
    expect(result).not.toBeNull();
    expect(result!.vercelEventType).toBe("deployment.succeeded");
    expect(result!.status).toBe("succeeded");
    expect(result!.projectName).toBe("myapp");
    expect(result!.environment).toBe("Production");
    expect(result!.deployUrl).toBe("https://myapp-abc.vercel.app");
    expect(result!.commitShaShort).toBe("abcdef0");
    expect(result!.commitUrl).toBe(
      "https://github.com/myorg/myapp/commit/abcdef0123456789abcdef0123456789abcdef01",
    );
    expect(result!.occurredAt).toBe(new Date(1700000000000).toISOString());
    expect(result!.action).toContain("myapp");
    expect(result!.action).toContain("Production");
    expect(result!.action).toContain("succeeded");
    expect(result!.action).toContain("abcdef0");
  });

  it("returns null for non-deployment event types", () => {
    expect(
      normalizeVercelDeployPayload({ type: "project.created" } as never),
    ).toBeNull();
  });

  it("labels preview deployments as 'Preview'", () => {
    const preview = {
      ...basePayload,
      payload: {
        ...basePayload.payload,
        deployment: { ...basePayload.payload.deployment, target: "preview" },
      },
    };
    const result = normalizeVercelDeployPayload(preview);
    expect(result!.environment).toBe("Preview");
  });

  it("falls back to 'Unknown' environment when target is missing", () => {
    const noTarget = {
      ...basePayload,
      payload: {
        ...basePayload.payload,
        deployment: { ...basePayload.payload.deployment, target: undefined },
      },
    };
    const result = normalizeVercelDeployPayload(noTarget as never);
    expect(result!.environment).toBe("Unknown");
  });

  it("omits commitUrl when GitHub org/repo metadata is absent", () => {
    const noGithub = {
      ...basePayload,
      payload: {
        ...basePayload.payload,
        deployment: {
          ...basePayload.payload.deployment,
          meta: { githubCommitSha: "abc1234567890" },
        },
      },
    };
    const result = normalizeVercelDeployPayload(noGithub);
    expect(result!.commitSha).toBe("abc1234567890");
    expect(result!.commitShaShort).toBe("abc1234");
    expect(result!.commitUrl).toBeNull();
  });

  it("uses 'unknown-project' when no project name is present", () => {
    const noName = {
      type: "deployment.created" as const,
      payload: { deployment: {}, project: {} },
    };
    const result = normalizeVercelDeployPayload(noName);
    expect(result!.projectName).toBe("unknown-project");
    expect(result!.status).toBe("created");
  });
});
