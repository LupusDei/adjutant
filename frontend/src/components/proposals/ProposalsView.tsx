import { type CSSProperties, useState, useCallback } from "react";
import { useProposals } from "../../hooks/useProposals";
import { ProposalCard } from "./ProposalCard";
import { ProposalDetailView } from "./ProposalDetailView";
import { api } from "../../services/api";
import type { Proposal, ProposalStatus, ProposalType } from "../../types";

export interface ProposalsViewProps {
  isActive?: boolean;
}

const STATUS_OPTIONS: Array<{ value: ProposalStatus | "all"; label: string }> = [
  { value: "pending", label: "PENDING" },
  { value: "accepted", label: "ACCEPTED" },
  { value: "dismissed", label: "DISMISSED" },
  { value: "all", label: "ALL" },
];

const TYPE_OPTIONS: Array<{ value: ProposalType | "all"; label: string }> = [
  { value: "all", label: "ALL TYPES" },
  { value: "product", label: "PRODUCT" },
  { value: "engineering", label: "ENGINEERING" },
];

export function ProposalsView({ isActive: _isActive }: ProposalsViewProps) {
  const {
    proposals,
    loading,
    error,
    statusFilter,
    typeFilter,
    setStatusFilter,
    setTypeFilter,
    accept,
    dismiss,
    refresh,
  } = useProposals();

  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);

  const handleAcceptFromDetail = useCallback(async (id: string) => {
    await accept(id);
    void refresh();
  }, [accept, refresh]);

  const handleDismissFromDetail = useCallback(async (id: string) => {
    await dismiss(id);
    void refresh();
  }, [dismiss, refresh]);

  const handleSendToAgent = useCallback((proposal: Proposal) => {
    const prompt = `## Proposal: ${proposal.title}\n\n**Type:** ${proposal.type}\n**Author:** ${proposal.author}\n**Status:** ${proposal.status}\n\n### Description\n\n${proposal.description}\n\n---\n\nPlease use /speckit.specify to create a feature specification from this proposal, then /speckit.plan to generate an implementation plan, and /speckit.beads to create executable beads for orchestration.`;

    void api.messages.send({
      to: "user",
      body: prompt,
      threadId: `proposal-${proposal.id}`,
    });
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>STATUS:</span>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              style={{
                ...styles.filterBtn,
                ...(statusFilter === opt.value ? styles.filterBtnActive : {}),
              }}
              onClick={() => { setStatusFilter(opt.value); }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>TYPE:</span>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              style={{
                ...styles.filterBtn,
                ...(typeFilter === opt.value ? styles.filterBtnActive : {}),
              }}
              onClick={() => { setTypeFilter(opt.value); }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button style={styles.refreshBtn} onClick={() => { void refresh(); }}>
          REFRESH
        </button>
      </div>

      {error && (
        <div style={styles.error}>ERROR: {error}</div>
      )}

      {loading && proposals.length === 0 && (
        <div style={styles.empty}>LOADING...</div>
      )}

      {!loading && proposals.length === 0 && (
        <div style={styles.empty}>
          {statusFilter === "pending"
            ? "NO PENDING PROPOSALS. AGENTS WILL GENERATE PROPOSALS WHEN IDLE."
            : "NO PROPOSALS FOUND."}
        </div>
      )}

      <div style={styles.list}>
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            onAccept={(id) => { void accept(id); }}
            onDismiss={(id) => { void dismiss(id); }}
            onSendToAgent={handleSendToAgent}
            onClick={setSelectedProposalId}
          />
        ))}
      </div>

      <div style={styles.footer}>
        {proposals.length} PROPOSAL{proposals.length !== 1 ? "S" : ""}
      </div>

      <ProposalDetailView
        proposalId={selectedProposalId}
        onClose={() => { setSelectedProposalId(null); }}
        onAccept={(id) => { void handleAcceptFromDetail(id); }}
        onDismiss={(id) => { void handleDismissFromDetail(id); }}
        onSendToAgent={handleSendToAgent}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    fontFamily: "var(--font-mono, monospace)",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--pipboy-green-dim, #00aa00)",
    marginBottom: "8px",
  },
  filterGroup: {
    display: "flex",
    gap: "4px",
    alignItems: "center",
  },
  filterLabel: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "11px",
    marginRight: "4px",
    fontWeight: "bold",
  },
  filterBtn: {
    background: "transparent",
    border: "1px solid transparent",
    color: "var(--pipboy-green-dim, #00aa00)",
    padding: "2px 8px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  filterBtnActive: {
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
  },
  refreshBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green-dim, #00aa00)",
    padding: "2px 10px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
    marginLeft: "auto",
  },
  error: {
    color: "#ff4444",
    fontSize: "12px",
    padding: "8px",
    border: "1px solid #ff4444",
    marginBottom: "8px",
  },
  empty: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "13px",
    textAlign: "center" as const,
    padding: "40px 20px",
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
  },
  footer: {
    borderTop: "1px solid var(--pipboy-green-dim, #00aa00)",
    padding: "6px 0",
    fontSize: "11px",
    color: "var(--pipboy-green-dim, #00aa00)",
    textAlign: "right" as const,
  },
};
