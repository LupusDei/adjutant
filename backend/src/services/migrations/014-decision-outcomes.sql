-- Decision outcome tracking for adjutant feedback loop (adj-054.5.1)

ALTER TABLE adjutant_decisions ADD COLUMN outcome TEXT;
ALTER TABLE adjutant_decisions ADD COLUMN outcome_at TEXT;
