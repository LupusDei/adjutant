-- Add product owner agent tracking for auto-develop projects
ALTER TABLE projects ADD COLUMN auto_develop_product_owner TEXT DEFAULT NULL;
