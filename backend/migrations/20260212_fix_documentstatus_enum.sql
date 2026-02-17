-- Normalize documentstatus enum to lowercase values used in application code.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'documentstatus'
          AND e.enumlabel = 'ready'
    ) THEN
        RAISE NOTICE 'documentstatus already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE documents ALTER COLUMN status DROP DEFAULT;

        ALTER TYPE documentstatus RENAME TO documentstatus_old;
        CREATE TYPE documentstatus AS ENUM ('uploaded', 'processing', 'ready', 'failed', 'deleted');

        ALTER TABLE documents
            ALTER COLUMN status TYPE documentstatus
            USING lower(status::text)::documentstatus;

        ALTER TABLE documents
            ALTER COLUMN status SET DEFAULT 'uploaded';

        DROP TYPE documentstatus_old;
    END IF;
END $$;
