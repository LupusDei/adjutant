-- Add 'completed' status to proposals
-- Existing CHECK constraint must be recreated (SQLite doesn't support ALTER CHECK)

-- Step 1: Create new table with updated CHECK constraint
CREATE TABLE proposals_new (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('product', 'engineering')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'dismissed', 'completed')),
  project TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy existing data
INSERT INTO proposals_new (id, author, title, description, type, status, project, created_at, updated_at)
SELECT id, author, title, description, type, status, COALESCE(project, ''), created_at, updated_at
FROM proposals;

-- Step 3: Drop old table and rename
DROP TABLE proposals;
ALTER TABLE proposals_new RENAME TO proposals;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_proposals_status_created ON proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_type ON proposals(type);
CREATE INDEX IF NOT EXISTS idx_proposals_author ON proposals(author);
