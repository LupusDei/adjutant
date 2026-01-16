import { execBd, type BeadsIssue } from "./bd-client.js";
import { listAllBeadsDirs } from "./gastown-workspace.js";
import type { Convoy, TrackedIssue } from "../types/convoys.js";

export interface ConvoysServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Extracts epic ID from a label like "epic:hq-j7l5"
 */
function extractEpicId(label: string): string | null {
  if (label.startsWith("epic:")) {
    return label.slice(5);
  }
  return null;
}

export async function listConvoys(): Promise<ConvoysServiceResult<Convoy[]>> {
  try {
    const beadsDirs = await listAllBeadsDirs();

    // Map: epicId -> { tasks: BeadsIssue[], rig (most common source), dirPath, workDir }
    const epicToTasks = new Map<string, {
      tasks: BeadsIssue[],
      rigCounts: Map<string | null, number>,
      dirPath: string,
      workDir: string
    }>();

    // 1. Fetch all open issues from all beads directories and find epic:* labels
    for (const dirInfo of beadsDirs) {
      const result = await execBd<BeadsIssue[]>(
        ["list", "--status=open", "-q", "--json", "--limit=0"],
        { cwd: dirInfo.workDir, beadsDir: dirInfo.path }
      );

      if (!result.success || !result.data) continue;

      for (const issue of result.data) {
        const labels = issue.labels || [];
        for (const label of labels) {
          const epicId = extractEpicId(label);
          if (epicId) {
            if (!epicToTasks.has(epicId)) {
              epicToTasks.set(epicId, {
                tasks: [],
                rigCounts: new Map(),
                dirPath: dirInfo.path,
                workDir: dirInfo.workDir
              });
            }
            const entry = epicToTasks.get(epicId)!;
            entry.tasks.push(issue);
            // Track which rig this task came from
            const currentCount = entry.rigCounts.get(dirInfo.rig) ?? 0;
            entry.rigCounts.set(dirInfo.rig, currentCount + 1);
          }
        }
      }
    }

    if (epicToTasks.size === 0) {
      return { success: true, data: [] };
    }

    // 2. Fetch epic details for each discovered epic
    const result: Convoy[] = [];
    const epicIds = Array.from(epicToTasks.keys());

    // Try to fetch epic details from any beads dir (they route by prefix)
    const firstDirInfo = beadsDirs[0];
    if (firstDirInfo) {
      const epicDetailsResult = await execBd<BeadsIssue[]>(
        ["show", ...epicIds, "-q", "--json"],
        { cwd: firstDirInfo.workDir, beadsDir: firstDirInfo.path }
      );

      const epicDetails = new Map<string, BeadsIssue>();
      if (epicDetailsResult.success && epicDetailsResult.data) {
        for (const epic of epicDetailsResult.data) {
          epicDetails.set(epic.id, epic);
        }
      }

      // 3. Build convoy response for each epic
      for (const [epicId, { tasks, rigCounts }] of epicToTasks) {
        const epic = epicDetails.get(epicId);

        // Determine the most common rig for this convoy
        let convoyRig: string | null = null;
        let maxCount = 0;
        for (const [rig, count] of rigCounts) {
          if (count > maxCount) {
            maxCount = count;
            convoyRig = rig;
          }
        }

        // Build tracked issues from tasks
        const trackedIssues: TrackedIssue[] = [];
        let completed = 0;

        for (const task of tasks) {
          const trackedIssue: TrackedIssue = {
            id: task.id,
            title: task.title,
            status: task.status,
            issueType: task.issue_type,
            priority: task.priority
          };
          if (task.assignee) trackedIssue.assignee = task.assignee;
          if (task.updated_at) trackedIssue.updatedAt = task.updated_at;

          trackedIssues.push(trackedIssue);
          if (task.status === "closed") {
            completed++;
          }
        }

        result.push({
          id: epicId,
          title: epic?.title || `Epic ${epicId}`,
          status: epic?.status || "open",
          rig: convoyRig,
          progress: {
            completed,
            total: trackedIssues.length
          },
          trackedIssues
        });
      }
    }

    return { success: true, data: result };

  } catch (err) {
    return {
      success: false,
      error: {
        code: "CONVOYS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list convoys",
      },
    };
  }
}