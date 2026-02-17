-- Normalize task enums to lowercase values used in application code.
DO $$
BEGIN
    -- tasktype
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'tasktype'
          AND e.enumlabel = 'issue'
    ) THEN
        RAISE NOTICE 'tasktype already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE tasks ALTER COLUMN type DROP DEFAULT;
        ALTER TYPE tasktype RENAME TO tasktype_old;
        CREATE TYPE tasktype AS ENUM ('issue', 'deadline');
        ALTER TABLE tasks
            ALTER COLUMN type TYPE tasktype
            USING lower(type::text)::tasktype;
        DROP TYPE tasktype_old;
    END IF;

    -- taskstatus
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'taskstatus'
          AND e.enumlabel = 'open'
    ) THEN
        RAISE NOTICE 'taskstatus already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT;
        ALTER TYPE taskstatus RENAME TO taskstatus_old;
        CREATE TYPE taskstatus AS ENUM ('open', 'in_progress', 'completed', 'overdue', 'closed');
        ALTER TABLE tasks
            ALTER COLUMN status TYPE taskstatus
            USING lower(status::text)::taskstatus;
        ALTER TABLE tasks
            ALTER COLUMN status SET DEFAULT 'open';
        DROP TYPE taskstatus_old;
    END IF;

    -- taskpriority
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'taskpriority'
          AND e.enumlabel = 'low'
    ) THEN
        RAISE NOTICE 'taskpriority already uses lowercase values; skipping.';
    ELSE
        ALTER TABLE tasks ALTER COLUMN priority DROP DEFAULT;
        ALTER TYPE taskpriority RENAME TO taskpriority_old;
        CREATE TYPE taskpriority AS ENUM ('low', 'medium', 'high');
        ALTER TABLE tasks
            ALTER COLUMN priority TYPE taskpriority
            USING lower(priority::text)::taskpriority;
        DROP TYPE taskpriority_old;
    END IF;
END $$;
