/**
 * Escalation message builder for the auto-develop loop.
 *
 * Builds structured "Vision Update Needed" messages when proposals
 * consistently score in the 40-59 escalation zone. This is a pure
 * function — the caller decides how to deliver the message (e.g.,
 * via CommunicationManager.escalate() for APNS push).
 *
 * @module services/escalation-builder
 */

export interface EscalationMessage {
  title: string;
  body: string;
  proposalIds: string[];
  projectName: string;
}

export interface LowConfidenceProposal {
  id: string;
  title: string;
  confidenceScore: number;
  primaryConcern: string;
}

/**
 * Build a structured "Vision Update Needed" escalation message.
 * Called when proposals consistently score in the 40-59 escalation zone.
 *
 * @param projectName - The project name for context
 * @param lowConfidenceProposals - Proposals that triggered escalation
 * @returns A structured message ready for delivery
 */
export function buildEscalationMessage(
  projectName: string,
  lowConfidenceProposals: LowConfidenceProposal[],
): EscalationMessage {
  const title = `Vision Update Needed — Project: ${projectName}`;

  const proposalLines = lowConfidenceProposals
    .map((p, i) => `${i + 1}. "${p.title}" — Score: ${p.confidenceScore} — Concern: ${p.primaryConcern}`)
    .join("\n");

  const body = [
    `The auto-develop loop has generated ${lowConfidenceProposals.length} proposal(s) but confidence is low.`,
    "",
    "Top proposals awaiting guidance:",
    proposalLines,
    "",
    "What would help:",
    "- Clarify product direction for the areas above",
    "- Confirm or reject the proposed approaches",
    "- Provide updated vision context via the dashboard or MCP",
    "",
    "Reply with guidance or disable auto-develop to pause.",
  ].join("\n");

  return {
    title,
    body,
    proposalIds: lowConfidenceProposals.map(p => p.id),
    projectName,
  };
}
