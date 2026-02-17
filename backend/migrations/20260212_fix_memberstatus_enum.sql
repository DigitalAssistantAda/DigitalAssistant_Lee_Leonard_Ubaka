-- Normalize memberstatus enum to lowercase values used in application code.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'memberstatus'
          AND e.enumlabel = 'active'
    ) THEN
        RAISE NOTICE 'memberstatus already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE workspace_members ALTER COLUMN status DROP DEFAULT;

        ALTER TYPE memberstatus RENAME TO memberstatus_old;
        CREATE TYPE memberstatus AS ENUM ('active', 'inactive');

        ALTER TABLE workspace_members
            ALTER COLUMN status TYPE memberstatus
            USING lower(status::text)::memberstatus;

        ALTER TABLE workspace_members
            ALTER COLUMN status SET DEFAULT 'active';

        DROP TYPE memberstatus_old;
    END IF;
END $$;
