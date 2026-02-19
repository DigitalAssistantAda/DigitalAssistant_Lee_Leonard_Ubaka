-- Backfill one default workspace container for existing workspaces that do not have any
-- containers yet, then attach unassigned documents in those workspaces to the inserted
-- default container.

WITH inserted AS (
  INSERT INTO containers (workspace_id, name, color, created_by, created_at, updated_at)
  SELECT
    w.id,
    w.name,
    w.accent_color,
    w.created_by,
    now(),
    now()
  FROM workspaces w
  WHERE NOT EXISTS (
    SELECT 1
    FROM containers c
    WHERE c.workspace_id = w.id
  )
  RETURNING id, workspace_id
)
UPDATE documents d
SET container_id = inserted.id
FROM inserted
WHERE d.workspace_id = inserted.workspace_id
  AND d.container_id IS NULL;
