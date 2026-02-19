ALTER TABLE documents
ADD COLUMN IF NOT EXISTS container_id INTEGER REFERENCES containers(id);

CREATE INDEX IF NOT EXISTS idx_documents_container_id ON documents(container_id);
