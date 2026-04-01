-- Issue/task reminders (optionally informed by workspace document excerpts)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminders_generation_error TEXT NULL;

CREATE TABLE IF NOT EXISTS task_reminders (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    hint_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    ai_suggested BOOLEAN DEFAULT FALSE,
    ai_model_used VARCHAR(255),
    confidence_score INTEGER,
    source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    dismissed BOOLEAN DEFAULT FALSE,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_task_reminders_task_id ON task_reminders(task_id);
CREATE INDEX IF NOT EXISTS ix_task_reminders_created_at ON task_reminders(created_at);
