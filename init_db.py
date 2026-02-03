#!/usr/bin/env python3
"""
Initialize database schema by creating all tables.
Run this once after setting up Supabase connection.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from database import init_db, engine
from models import (
    User, Tenant, Workspace, WorkspaceMember, Document, 
    DocumentChunk, ChunkEmbedding, ProcessingJob, AuditLog
)

if __name__ == "__main__":
    print("Initializing database schema...")
    
    # Check if DATABASE_URL is set
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("✗ Error: DATABASE_URL not set in .env file")
        print("Please add your Supabase connection string to .env:")
        print("  DATABASE_URL=postgresql://postgres:password@host:5432/postgres")
        sys.exit(1)
    
    print(f"Using database: {db_url.split('@')[1].split('/')[0]}")
    print("Creating tables in PostgreSQL...")
    
    try:
        init_db()
        print("✓ Database schema created successfully!")
        print("\nTables created:")
        print("  - tenants")
        print("  - users")
        print("  - workspaces")
        print("  - workspace_members")
        print("  - documents")
        print("  - document_chunks")
        print("  - chunk_embeddings")
        print("  - processing_jobs")
        print("  - audit_logs")
        print("\nYou can now view these tables in Supabase dashboard:")
        print("1. Go to https://app.supabase.com")
        print("2. Select your project 'digital-assistant-ada'")
        print("3. Click Database → Tables")
    except Exception as e:
        print(f"✗ Error creating tables: {e}")
        print(f"\nDebug: Connection string being used:")
        print(f"  Host: {db_url.split('@')[1].split(':')[0] if '@' in db_url else 'unknown'}")
        sys.exit(1)
