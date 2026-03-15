-- Enable nested folders via self-referencing parent container id
ALTER TABLE containers
    ADD COLUMN IF NOT EXISTS parent_container_id INTEGER REFERENCES containers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_containers_parent_container_id ON containers(parent_container_id);