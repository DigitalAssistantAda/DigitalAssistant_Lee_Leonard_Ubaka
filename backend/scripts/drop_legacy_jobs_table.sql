-- Legacy document processing jobs (extraction / embedding / summarization rows).
-- Replaced by embedding_jobs (+ embedding_training_jobs for global refresh/fine-tune).
-- Run against your Postgres (e.g. Supabase SQL editor) after deploying code that no longer uses `jobs`.

-- Optional: inspect first
-- SELECT job_type, status, COUNT(*) FROM jobs GROUP BY 1, 2;

DROP TABLE IF EXISTS jobs;
