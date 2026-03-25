ALTER TABLE proposals ADD COLUMN confidence_score INTEGER;
ALTER TABLE proposals ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN confidence_signals TEXT;
