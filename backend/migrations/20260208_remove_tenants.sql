-- Remove tenants and tenant_id columns; scope audit logs by workspace

-- Add workspace_id to audit_logs (nullable for non-workspace actions)
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS workspace_id INTEGER;

-- Backfill workspace_id from metadata if present (best-effort)
UPDATE audit_logs
SET workspace_id = (metadata_json->>'workspace_id')::INTEGER
WHERE workspace_id IS NULL
  AND metadata_json IS NOT NULL
  AND (metadata_json->>'workspace_id') ~ '^[0-9]+$';

ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS tenant_id;

-- Remove tenant_id columns
ALTER TABLE users
    DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE workspaces
    DROP COLUMN IF EXISTS tenant_id;

-- Drop tenants table
DROP TABLE IF EXISTS tenants;

-- Optional index for audit log workspace lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_id ON audit_logs(workspace_id);
