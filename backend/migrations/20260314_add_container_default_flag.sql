ALTER TABLE containers
ADD COLUMN IF NOT EXISTS is_workspace_default BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked AS (
    SELECT
        c.id,
        ROW_NUMBER() OVER (
            PARTITION BY c.workspace_id
            ORDER BY
                (LOWER(TRIM(c.name)) = LOWER(TRIM(w.name))) DESC,
                c.created_at ASC,
                c.id ASC
        ) AS row_num
    FROM containers c
    JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.workspace_id IS NOT NULL
)
UPDATE containers c
SET is_workspace_default = (ranked.row_num = 1)
FROM ranked
WHERE ranked.id = c.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_default_container
ON containers (workspace_id)
WHERE workspace_id IS NOT NULL AND is_workspace_default = TRUE;
