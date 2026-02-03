#!/usr/bin/env python
"""Create messages table in Supabase"""
from sqlalchemy import create_engine, text

DATABASE_URL = 'postgresql://postgres:senior2026capstone@db.raqcpemoaejgunwebqxs.supabase.co:5432/postgres'

engine = create_engine(DATABASE_URL)

print("Creating messages table...")

with engine.connect() as conn:
    # Create table
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            is_edited BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    
    # Create indexes
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON messages(workspace_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)"))
    
    conn.commit()

print("✓ Messages table created successfully!")
