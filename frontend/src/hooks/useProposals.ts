import { useState, useEffect, useCallback } from "react";
import type { Proposal, ProposalType, ProposalStatus } from "../types";
import api from "../services/api";

export interface UseProposalsResult {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  statusFilter: ProposalStatus | "all";
  typeFilter: ProposalType | "all";
  setStatusFilter: (filter: ProposalStatus | "all") => void;
  setTypeFilter: (filter: ProposalType | "all") => void;
  accept: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProposals(): UseProposalsResult {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "all">("pending");
  const [typeFilter, setTypeFilter] = useState<ProposalType | "all">("all");

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { status?: ProposalStatus; type?: ProposalType } = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (typeFilter !== "all") params.type = typeFilter;
      const data = await api.proposals.list(params);
      setProposals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  const accept = useCallback(async (id: string) => {
    try {
      const updated = await api.proposals.updateStatus(id, "accepted");
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? updated : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      const updated = await api.proposals.updateStatus(id, "dismissed");
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? updated : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    proposals,
    loading,
    error,
    statusFilter,
    typeFilter,
    setStatusFilter,
    setTypeFilter,
    accept,
    dismiss,
    refresh: fetchProposals,
  };
}
