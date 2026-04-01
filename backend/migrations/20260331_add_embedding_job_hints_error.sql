-- Persist last document-hint/reminder generation failure for user-facing fallback messaging
ALTER TABLE embedding_jobs ADD COLUMN IF NOT EXISTS hints_error TEXT NULL;
