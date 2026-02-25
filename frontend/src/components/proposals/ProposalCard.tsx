import type { CSSProperties } from "react";
import type { Proposal } from "../../types";

export interface ProposalCardProps {
  proposal: Proposal;
  onAccept?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onComplete?: (id: string) => void;
  onSendToAgent?: (proposal: Proposal) => void;
  onDiscuss?: (proposal: Proposal) => void;
  onClick?: (id: string) => void;
}

export function ProposalCard({ proposal, onAccept, onDismiss, onComplete, onSendToAgent, onDiscuss, onClick }: ProposalCardProps) {
  const isPending = proposal.status === "pending";
  const isAccepted = proposal.status === "accepted";
  const isDismissed = proposal.status === "dismissed";
  const isCompleted = proposal.status === "completed";

  return (
    <div style={{
      ...styles.card,
      ...(isDismissed || isCompleted ? styles.dismissed : {}),
      cursor: onClick ? 'pointer' : undefined,
    }} onClick={() => onClick?.(proposal.id)}>
      <div style={styles.header}>
        <span style={styles.title}>{proposal.title}</span>
        <span style={{
          ...styles.badge,
          ...(proposal.type === "product" ? styles.badgeProduct : styles.badgeEngineering),
        }}>
          {proposal.type === "product" ? "PRODUCT" : "ENGINEERING"}
        </span>
      </div>

      <div style={styles.meta}>
        <span style={styles.project}>[{proposal.project.toUpperCase()}]</span>
        <span style={styles.author}>BY {proposal.author.toUpperCase()}</span>
        <span style={styles.date}>{new Date(proposal.createdAt).toLocaleDateString()}</span>
        {!isPending && (
          <span style={{
            ...styles.statusBadge,
            ...(isAccepted ? styles.statusAccepted
              : isCompleted ? styles.statusCompleted
              : styles.statusDismissed),
          }}>
            {proposal.status.toUpperCase()}
          </span>
        )}
      </div>

      <div style={styles.description}>
        {proposal.description.length > 300
          ? proposal.description.slice(0, 300) + "..."
          : proposal.description}
      </div>

      <div style={styles.actions}>
        {isPending && (
          <>
            <button
              style={styles.acceptBtn}
              onClick={(e) => { e.stopPropagation(); onAccept?.(proposal.id); }}
            >
              ACCEPT
            </button>
            <button
              style={styles.discussBtn}
              onClick={(e) => { e.stopPropagation(); onDiscuss?.(proposal); }}
            >
              DISCUSS
            </button>
            <button
              style={styles.dismissBtn}
              onClick={(e) => { e.stopPropagation(); onDismiss?.(proposal.id); }}
            >
              DISMISS
            </button>
          </>
        )}
        {isAccepted && (
          <>
            <button
              style={styles.completeBtn}
              onClick={(e) => { e.stopPropagation(); onComplete?.(proposal.id); }}
            >
              COMPLETE
            </button>
            <button
              style={styles.sendBtn}
              onClick={(e) => { e.stopPropagation(); onSendToAgent?.(proposal); }}
            >
              SEND TO AGENT
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    padding: "12px 16px",
    marginBottom: "8px",
    background: "var(--pipboy-bg-panel, #111111)",
    fontFamily: "var(--font-mono, monospace)",
  },
  dismissed: {
    opacity: 0.5,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px",
  },
  title: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "14px",
    fontWeight: "bold",
    textTransform: "uppercase" as const,
    flex: 1,
    marginRight: "8px",
  },
  badge: {
    fontSize: "10px",
    padding: "2px 6px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
  },
  badgeProduct: {
    color: "var(--pipboy-green, #00ff00)",
    border: "1px solid var(--pipboy-green, #00ff00)",
  },
  badgeEngineering: {
    color: "#ffaa00",
    border: "1px solid #ffaa00",
  },
  meta: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    marginBottom: "8px",
    fontSize: "11px",
    color: "var(--pipboy-green-dim, #00aa00)",
  },
  project: {
    letterSpacing: "0.5px",
    fontWeight: "bold",
  },
  author: {
    letterSpacing: "0.5px",
  },
  date: {},
  statusBadge: {
    fontSize: "10px",
    padding: "1px 5px",
    fontWeight: "bold",
  },
  statusAccepted: {
    color: "var(--pipboy-green, #00ff00)",
    border: "1px solid var(--pipboy-green, #00ff00)",
  },
  statusCompleted: {
    color: "#00ccff",
    border: "1px solid #00ccff",
  },
  statusDismissed: {
    color: "#666",
    border: "1px solid #666",
  },
  description: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "12px",
    lineHeight: "1.5",
    marginBottom: "10px",
    whiteSpace: "pre-wrap" as const,
  },
  actions: {
    display: "flex",
    gap: "8px",
  },
  acceptBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  discussBtn: {
    background: "transparent",
    border: "1px solid #ffaa00",
    color: "#ffaa00",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  dismissBtn: {
    background: "transparent",
    border: "1px solid #666",
    color: "#666",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  completeBtn: {
    background: "transparent",
    border: "1px solid #00ccff",
    color: "#00ccff",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  sendBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    textTransform: "uppercase" as const,
    boxShadow: "0 0 4px var(--pipboy-green-glow, #00ff0066)",
  },
};
