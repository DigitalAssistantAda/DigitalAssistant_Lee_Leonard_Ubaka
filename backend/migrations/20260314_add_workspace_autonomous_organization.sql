ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS autonomous_organization_enabled BOOLEAN NOT NULL DEFAULT FALSE;
