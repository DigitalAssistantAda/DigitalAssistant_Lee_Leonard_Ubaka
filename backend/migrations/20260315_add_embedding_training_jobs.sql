-- Embedding training/refresh job types and table for management UI
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'embeddingtrainingjobtype') THEN
    CREATE TYPE embeddingtrainingjobtype AS ENUM ('refresh', 'fine_tune');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'embeddingtrainingjobstatus') THEN
    CREATE TYPE embeddingtrainingjobstatus AS ENUM ('pending', 'running', 'complete', 'failed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS embedding_training_jobs (
  id SERIAL PRIMARY KEY,
  job_type embeddingtrainingjobtype NOT NULL,
  status embeddingtrainingjobstatus NOT NULL DEFAULT 'pending',
  workspace_id INTEGER NULL,
  celery_task_id VARCHAR NULL,
  documents_processed INTEGER DEFAULT 0,
  documents_total INTEGER NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embedding_training_jobs_type ON embedding_training_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_embedding_training_jobs_status ON embedding_training_jobs (status);
CREATE INDEX IF NOT EXISTS idx_embedding_training_jobs_workspace ON embedding_training_jobs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_embedding_training_jobs_created ON embedding_training_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_embedding_training_jobs_celery ON embedding_training_jobs (celery_task_id);
