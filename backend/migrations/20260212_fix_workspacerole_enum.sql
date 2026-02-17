-- Normalize workspacerole enum to lowercase values used in application code.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'workspacerole'
          AND e.enumlabel = 'owner'
    ) THEN
        RAISE NOTICE 'workspacerole already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE workspace_members ALTER COLUMN role DROP DEFAULT;

        ALTER TYPE workspacerole RENAME TO workspacerole_old;
        CREATE TYPE workspacerole AS ENUM ('owner', 'admin', 'member');

        ALTER TABLE workspace_members
            ALTER COLUMN role TYPE workspacerole
            USING lower(role::text)::workspacerole;

        ALTER TABLE workspace_members
            ALTER COLUMN role SET DEFAULT 'member';

        DROP TYPE workspacerole_old;
    END IF;
END $$;
