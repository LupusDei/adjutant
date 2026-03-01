import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { parseMessageLabels } from "./message-utils.js";
import { logWarn } from "../utils/index.js";

export interface MailIndexEntry {
  unread: number;
  firstSubject?: string;
  firstFrom?: string;
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
  // Single call with --all, filter client-side for open/hooked status
  const result = await execBd<BeadsIssue[]>(
    ["list", "--type", "message", "--all", "--json"],
    { cwd: townRoot, beadsDir }
  );

  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to list mail issues");
  }

  // Filter for active mail (open or hooked status)
  const activeStatuses = new Set(["open", "hooked"]);
  return (result.data ?? []).filter((issue) =>
    activeStatuses.has(issue.status?.toLowerCase() ?? "")
  );
}

export async function listMailIssuesForIdentity(
  townRoot: string,
  identity: string
): Promise<BeadsIssue[]> {
  // Fetch all mail once, filter client-side for this identity
  const allMail = await listMailIssues(townRoot);
  const variants = new Set(identityVariants(identity));

  return allMail.filter((issue) => {
    // Check assignee match
    if (issue.assignee && variants.has(issue.assignee)) {
      return true;
    }
    // Check cc labels
    const labels = parseMessageLabels(issue.labels);
    for (const cc of labels.cc) {
      if (variants.has(cc)) {
        return true;
      }
    }
    return false;
  });
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
          if (labels.sender) entry.firstFrom = labels.sender;
        }
      }
    }
  }

  const result = new Map<string, MailIndexEntry>();
  for (const [identity, entry] of index.entries()) {
    const mailEntry: MailIndexEntry = { unread: entry.unread };
    if (entry.firstSubject) mailEntry.firstSubject = entry.firstSubject;
    if (entry.firstFrom) mailEntry.firstFrom = entry.firstFrom;
    result.set(identity, mailEntry);
  }
  return result;
}

export async function buildMailIndexForIdentities(
  townRoot: string,
  identities: string[]
): Promise<Map<string, MailIndexEntry>> {
  const uniqueIdentities = Array.from(new Set(identities));

  try {
    // Single fetch for all mail, then use buildMailIndex for client-side filtering
    const allMail = await listMailIssues(townRoot);
    return buildMailIndex(allMail, uniqueIdentities);
  } catch (err) {
    logWarn("mail index query failed", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    // Return empty entries for all identities on failure
    const result = new Map<string, MailIndexEntry>();
    for (const identity of uniqueIdentities) {
      result.set(identity, { unread: 0 });
    }
    return result;
  }
}
