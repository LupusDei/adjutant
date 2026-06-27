/**
 * The Bridge — avatar command write-paths (adj-202.4.2 / .4.3 / .4.4).
 *
 * Deliberate, reversible WRITE actions the avatar can take to DIRECT the swarm. Each
 * reuses the SAME real service the corresponding MCP tool uses — no second control
 * plane (Constitution Rules 4 + 9):
 *   - nudgeAgentViaBridge   → the session bridge (live tmux poke), like nudge_agent
 *   - answerQuestionViaBridge→ question-service.answerQuestion, like answer_question
 *   - createBeadViaBridge    → the bd CLI via execBd, like create_bead
 *
 * Issued actions are attributed to the coordinator ("adjutant"). The avatar directs
 * agents by NAME and never needs project/epic/bead IDs — create_bead defaults to the
 * session's selected project (or "adjutant"); the others take only what the model
 * naturally knows. Destructive tools (decommission/spawn) are intentionally NOT here.
 */

import { getSessionBridge } from "./session-bridge.js";
import { execBd, resolveBeadsDir } from "./bd-client.js";
import { getProject } from "./projects-service.js";
import type { QuestionService } from "./question-service.js";
import type { AnswerQuestionInput } from "../types/index.js";
import { logInfo } from "../utils/logger.js";

/** The coordinator identity actions issued through The Bridge are attributed to. */
export const BRIDGE_ACTOR = "adjutant";

// ============================================================================
// nudge_agent
// ============================================================================

export interface NudgeAgentResult {
  agentId: string;
  /** True when the nudge reached a live session; false when the agent is offline/unknown. */
  delivered: boolean;
}

/**
 * Poke an agent's live session with a single-line prompt (mirrors the nudge_agent MCP
 * tool). Never throws — a missing session or uninitialized bridge reports delivered:false
 * so the avatar can say the agent isn't running rather than failing the turn.
 */
export async function nudgeAgentViaBridge(input: { agentId: string; message: string }): Promise<NudgeAgentResult> {
  const { agentId } = input;
  const singleLine = input.message.replace(/\n+/g, " ").trim();
  try {
    const bridge = getSessionBridge();
    const sessions = bridge.registry.findByName(agentId);
    if (!sessions || sessions.length === 0) return { agentId, delivered: false };
    const sent = await bridge.sendInput(sessions[0]!.id, singleLine);
    logInfo("bridge nudge_agent", { agentId, delivered: sent });
    return { agentId, delivered: sent };
  } catch {
    return { agentId, delivered: false };
  }
}

// ============================================================================
// answer_question
// ============================================================================

export interface AnswerQuestionResult {
  questionId: string;
  status: string;
}

/**
 * Resolve an open triage question via the SAME question-service the REST/MCP paths use
 * (so the asker is notified identically). Attributed to the coordinator. The caller
 * guarantees at least one of answerBody / chosenOption (the answer contract).
 */
export async function answerQuestionViaBridge(
  questionService: Pick<QuestionService, "answerQuestion">,
  input: { questionId: string; answerBody?: string | undefined; chosenOption?: string | undefined },
): Promise<AnswerQuestionResult> {
  const answerInput: AnswerQuestionInput = { answeredBy: BRIDGE_ACTOR };
  if (input.answerBody !== undefined) answerInput.answerBody = input.answerBody;
  if (input.chosenOption !== undefined) answerInput.chosenOption = input.chosenOption;

  const answered = await questionService.answerQuestion(input.questionId, answerInput);
  logInfo("bridge answer_question", { questionId: answered.id, status: answered.status });
  return { questionId: answered.id, status: answered.status };
}

// ============================================================================
// create_bead
// ============================================================================

export type BeadType = "epic" | "task" | "bug";

export interface CreateBeadResult {
  beadId: string;
  title: string;
  projectId: string;
}

/**
 * File a work item via the bd CLI (mirrors create_bead). The avatar never needs IDs:
 * the target project defaults to the session's selected project, else "adjutant";
 * type defaults to "task"; description defaults to the title; priority is normal (2).
 * `getProject` accepts a UUID or a name, so the default "adjutant" resolves cleanly.
 * execBd is internally serialized (bd-client semaphore), so no extra mutex is needed.
 */
export async function createBeadViaBridge(input: {
  title: string;
  description?: string | undefined;
  type?: BeadType | undefined;
  /** Session's selected project (UUID). Falls back to "adjutant" when absent. */
  projectId?: string | undefined;
}): Promise<CreateBeadResult> {
  const target = input.projectId ?? "adjutant";
  const projResult = getProject(target);
  if (!projResult.success || !projResult.data) {
    throw new Error(`Project '${target}' not found.`);
  }
  const project = projResult.data;
  const beadsDir = resolveBeadsDir(project.path);

  const args = [
    "create",
    "--json",
    "--title",
    input.title,
    "--description",
    input.description ?? input.title,
    "--type",
    input.type ?? "task",
    "--priority",
    "2",
  ];

  const result = await execBd<Record<string, unknown>>(args, { cwd: project.path, beadsDir });
  if (!result.success) {
    throw new Error(result.error?.message ?? "bd create failed");
  }

  const beadId = String(result.data?.["id"] ?? "unknown");
  logInfo("bridge create_bead", { beadId, projectId: project.id, type: input.type ?? "task" });
  return { beadId, title: input.title, projectId: project.id };
}
