import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { parseMessageLabels } from "./gastown-utils.js";

export interface MailIndexEntry {
  unread: number;
  firstSubject?: string;
}

interface InternalMailIndexEntry extends MailIndexEntry {
  latestTimestamp: number;
}

function identityVariants(identity: string): string[] {
  if (identity === "mayor/") return ["mayor/", "mayor"];
  if (identity === "deacon/") return ["deacon/", "deacon"];
  return [identity];
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

export async function listMailIssues(townRoot: string): Promise<BeadsIssue[]> {
  const beadsDir = resolveBeadsDir(townRoot);
  const openResult = await execBd<BeadsIssue[]>(
    ["list", "--type", "message", "--status", "open", "--json"],
    { cwd: townRoot, beadsDir }
  );
  const hookedResult = await execBd<BeadsIssue[]>(
    ["list", "--type", "message", "--status", "hooked", "--json"],
    { cwd: townRoot, beadsDir }
  );

  if (!openResult.success && !hookedResult.success) {
    const message =
      openResult.error?.message ??
      hookedResult.error?.message ??
      "Failed to list mail issues";
    throw new Error(message);
  }

  const issues = [
    ...(openResult.success ? openResult.data ?? [] : []),
    ...(hookedResult.success ? hookedResult.data ?? [] : []),
  ];
  const seen = new Set<string>();
  const deduped: BeadsIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    deduped.push(issue);
  }
  return deduped;
}

export function buildMailIndex(
  issues: BeadsIssue[],
  identities: string[]
): Map<string, MailIndexEntry> {
  const variantToIdentity = new Map<string, string>();
  const index = new Map<string, InternalMailIndexEntry>();

  for (const identity of identities) {
    for (const variant of identityVariants(identity)) {
      variantToIdentity.set(variant, identity);
    }
    index.set(identity, { unread: 0, latestTimestamp: 0 });
  }

  for (const issue of issues) {
    const labels = parseMessageLabels(issue.labels);
    const assignee = issue.assignee ?? "";
    const candidateIdentities = new Set<string>();
    const assigneeIdentity = variantToIdentity.get(assignee);
    if (assigneeIdentity) candidateIdentities.add(assigneeIdentity);

    for (const cc of labels.cc) {
      const ccIdentity = variantToIdentity.get(cc);
      if (ccIdentity) candidateIdentities.add(ccIdentity);
    }

    if (candidateIdentities.size === 0) continue;

    const unread = issue.status !== "closed" && !labels.hasReadLabel;
    const timestamp = toTimestamp(issue.created_at);

    for (const identity of candidateIdentities) {
      const entry = index.get(identity);
      if (!entry) continue;
      if (unread) {
        entry.unread += 1;
        if (timestamp >= entry.latestTimestamp) {
          entry.latestTimestamp = timestamp;
          entry.firstSubject = issue.title;
        }
      }
    }
  }

  const result = new Map<string, MailIndexEntry>();
  for (const [identity, entry] of index.entries()) {
    result.set(identity, {
      unread: entry.unread,
      firstSubject: entry.firstSubject,
    });
  }
  return result;
}
