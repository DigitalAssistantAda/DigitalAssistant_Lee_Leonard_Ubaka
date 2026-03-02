-- Add pending to memberstatus enum for workspace invitation acceptance flow.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'memberstatus'
          AND e.enumlabel = 'pending'
    ) THEN
        RAISE NOTICE 'memberstatus already includes pending; skipping.';
    ELSE
        ALTER TYPE memberstatus ADD VALUE 'pending';
    END IF;
END $$;
