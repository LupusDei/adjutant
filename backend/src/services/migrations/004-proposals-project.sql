-- Add project field to proposals for scoping proposals to specific projects
ALTER TABLE proposals ADD COLUMN project TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project);
