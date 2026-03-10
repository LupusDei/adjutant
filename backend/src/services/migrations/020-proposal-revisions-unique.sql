-- Add UNIQUE constraint on (proposal_id, revision_number) for proposal_revisions
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_revisions_unique ON proposal_revisions(proposal_id, revision_number);
