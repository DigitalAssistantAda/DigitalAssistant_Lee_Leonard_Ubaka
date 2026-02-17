-- Normalize enum values to lowercase to match application code.
DO $$
BEGIN
    -- workspacerole
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspacerole') THEN
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
    END IF;

    -- memberstatus
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'memberstatus') THEN
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
    END IF;

    -- documentstatus
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'documentstatus') THEN
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
    END IF;

    -- tasktype
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tasktype') THEN
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
    END IF;

    -- taskstatus
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'taskstatus') THEN
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
    END IF;

    -- taskpriority
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'taskpriority') THEN
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
    END IF;

    -- messagerole
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'messagerole') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname = 'messagerole'
              AND e.enumlabel = 'user'
        ) THEN
            RAISE NOTICE 'messagerole already uses lowercase values; skipping.';
        ELSE
            ALTER TYPE messagerole RENAME TO messagerole_old;
            CREATE TYPE messagerole AS ENUM ('user', 'assistant', 'system');
            ALTER TABLE ai_messages
                ALTER COLUMN role TYPE messagerole
                USING lower(role::text)::messagerole;
            DROP TYPE messagerole_old;
        END IF;
    END IF;

    -- summarystatus
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'summarystatus') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname = 'summarystatus'
              AND e.enumlabel = 'pending'
        ) THEN
            RAISE NOTICE 'summarystatus already uses lowercase values; skipping.';
        ELSE
            ALTER TABLE summaries ALTER COLUMN status DROP DEFAULT;
            ALTER TYPE summarystatus RENAME TO summarystatus_old;
            CREATE TYPE summarystatus AS ENUM ('pending', 'completed', 'failed');
            ALTER TABLE summaries
                ALTER COLUMN status TYPE summarystatus
                USING lower(status::text)::summarystatus;
            ALTER TABLE summaries
                ALTER COLUMN status SET DEFAULT 'pending';
            DROP TYPE summarystatus_old;
        END IF;
    END IF;

    -- jobtype
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jobtype') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname = 'jobtype'
              AND e.enumlabel = 'text_extraction'
        ) THEN
            RAISE NOTICE 'jobtype already uses lowercase values; skipping.';
        ELSE
            ALTER TYPE jobtype RENAME TO jobtype_old;
            CREATE TYPE jobtype AS ENUM ('text_extraction', 'embedding', 'summarization');
            ALTER TABLE jobs
                ALTER COLUMN job_type TYPE jobtype
                USING lower(job_type::text)::jobtype;
            DROP TYPE jobtype_old;
        END IF;
    END IF;

    -- jobstatus
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jobstatus') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname = 'jobstatus'
              AND e.enumlabel = 'pending'
        ) THEN
            RAISE NOTICE 'jobstatus already uses lowercase values; skipping.';
        ELSE
            ALTER TABLE jobs ALTER COLUMN status DROP DEFAULT;
            ALTER TYPE jobstatus RENAME TO jobstatus_old;
            CREATE TYPE jobstatus AS ENUM ('pending', 'running', 'completed', 'failed');
            ALTER TABLE jobs
                ALTER COLUMN status TYPE jobstatus
                USING lower(status::text)::jobstatus;
            ALTER TABLE jobs
                ALTER COLUMN status SET DEFAULT 'pending';
            DROP TYPE jobstatus_old;
        END IF;
    END IF;
END $$;
