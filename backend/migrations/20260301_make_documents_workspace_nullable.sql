-- Allow documents to exist in personal containers that are not tied to a workspace.
ALTER TABLE documents
ALTER COLUMN workspace_id DROP NOT NULL;
