# Phase 1 Implementation: Vector DB & Embeddings Infrastructure

## Summary

Phase 1 establishes the core infrastructure for Ada's AI capabilities: vector embeddings, duplicate detection, and AI-generated hints. This foundation enables the more advanced features described in your capstone vision (Google Drive + ChatGPT + Project Manager).

---

## What's Been Implemented

### 1. Database Layer
- **pgvector Extension**: Enabled in PostgreSQL for semantic vector operations
- **New Tables**:
  - `document_duplicates` - Tracks duplicate/similar documents with similarity scores
  - `embedding_jobs` - Tracks embedding generation job status, costs, errors
  - `document_hints` - Stores AI-generated tips, reminders, expiration alerts
- **Document Table Updates**:
  - `folder_path` - For auto-organization and hierarchical structure
  - `linked_task_id` - Link documents to project tasks
  - `auto_generated_tags` - JSON array of AI-suggested tags

### 2. Backend Infrastructure

#### Celery + Redis Configuration
- **celery_app.py** - Celery app configured with Redis broker/backend
- **celery-worker service** - Docker service running background tasks
- **Config**: 2 concurrent workers, 30-min timeout, task tracking enabled

#### Embeddings System
- **utils/embeddings.py** - Service for OpenAI embeddings
  - Single & batch embedding generation
  - Cosine similarity search via pgvector
  - Duplicate detection (97% threshold)
- **tasks/embeddings.py** - Async Celery tasks
  - `process_document_embeddings()` - Main task with full pipeline
  - Text extraction → chunking → embedding → dedup → hints
  - Error handling with retry logic
  - Job tracking and cost monitoring

#### API Endpoints
- **POST /api/v1/embeddings/check-duplicate** - Check if document is duplicate
- **GET /api/v1/embeddings/documents/{id}/hints** - Get document hints
- **POST /api/v1/embeddings/documents/{id}/hints/{hint_id}/acknowledge** - Mark hint acknowledged
- **POST /api/v1/embeddings/documents/{id}/hints/{hint_id}/dismiss** - Hide hint
- **GET /api/v1/embeddings/documents/{id}/similar** - Find similar documents
- **GET /api/v1/embeddings/jobs/{job_id}** - Get job status

### 3. Docker Integration
- **Updated Dockerfile**: 
  - Added `libpq-dev` for pgvector
  - Added `pgvector`, `openai`, `minio` to requirements.txt
- **Updated docker-compose.yml**:
  - New `celery-worker` service (depends on Redis, DB, MinIO)
  - Backend service split into API + worker

---

## What Still Needs to Be Done (Beyond Phase 1)

### Immediate (Phase 2)
1. **Text Extraction Pipeline**
   - Implement PDF text extraction (PyPDF2 or pdfplumber)
   - Support DOCX (python-docx), TXT, images (OCR via pytesseract)
   - Store extracted text in database

2. **Hint Generation AI**
   - Replace stubs in `_generate_hints()` with LLM calls
   - Detect: expiration dates, action items, review needed
   - Use GPT to analyze chunks and generate hints

3. **Document Upload Flow Updates**
   - Trigger embedding job when document uploaded
   - Display job progress to user
   - Handle failures gracefully

4. **Duplicate Management UI**
   - Review interface for flagged duplicates
   - Merge/consolidate duplicate documents
   - Clean up storage

### Phase 2+ (Advanced AI Features)
- Multi-turn conversations with document context
- Smart task suggestion based on documents
- Auto-organization by semantic similarity
- Reminders/notifications based on hints
- Project-document linking
- Advanced search (semantic + keyword hybrid)

---

## Environment Variables Required

Add these to `.env` file before running:

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-...                    # Your OpenAI API key
EMBEDDING_MODEL=text-embedding-ada-002   # or another model

# Database (if using Supabase)
DATABASE_URL=postgresql://user:pass@host/db

# Redis (already configured in docker-compose)
REDIS_URL=redis://redis:6379

# Storage
STORAGE_TYPE=minio                       # or "s3" for AWS
STORAGE_BUCKET=documents
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin

# Celery (automatically configured via REDIS_URL)
CELERY_BROKER_URL=redis://redis:6379
CELERY_RESULT_BACKEND=redis://redis:6379
```

---

## Database Migrations to Run

Run these in order after deploying:

```bash
# Inside container or via Supabase SQL editor
\i migrations/20260218_enable_pgvector.sql
\i migrations/20260218_add_document_columns.sql
\i migrations/20260218_create_dedup_and_embedding_tables.sql
```

Or with init_db() in Python:
1. Existing tables are created automatically
2. Run migration scripts manually via psql or Supabase dashboard

---

## Testing the Setup

### 1. Verify Docker Services
```bash
docker compose ps
# Should show: db, redis, minio, backend, celery-worker all running
```

### 2. Check Celery Worker
```bash
docker logs digitalassistant-celery-worker
# Should show: "celery@... ready to accept tasks"
```

### 3. Test Embeddings Endpoint
```bash
curl -X POST http://localhost:8000/api/v1/embeddings/check-duplicate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"document_id": 1, "similarity_threshold": 0.95}'
```

### 4. Monitor Jobs
```bash
# Check job status
curl http://localhost:8000/api/v1/embeddings/jobs/1 \
  -H "Authorization: Bearer {token}"

# View Celery tasks
docker logs digitalassistant-celery-worker | grep "process_document_embeddings"
```

---

## Architecture Diagram

```
User Uploads PDF
        ↓
Document stored in S3/MinIO + DB
        ↓
API triggers "process_document_embeddings" Celery task
        ↓
Worker pulls task from Redis queue
        ↓
[Parallel processing in Celery]
├─ Download file from storage
├─ Extract text (PDF → text)
├─ Chunk text (500 chars, 100 overlap)
├─ Generate embeddings (OpenAI API)
├─ Store chunks & embeddings in DB
├─ Check for duplicates (pgvector search)
├─ Flag duplicates (if similarity > threshold)
└─ Generate hints (AI analysis)
        ↓
Update document status → READY
        ↓
User can:
- See similar documents
- View AI hints
- Check duplicate status
- Search semantically
```

---

## Key Design Decisions

1. **Async Processing**: Embedding generation is slow (API calls), so it's done async via Celery to avoid blocking the API
2. **pgvector for Similarity**: PostgreSQL native vector ops are faster than external vector DB for multi-user systems
3. **Confidence Tracking**: Hints include confidence scores for future filtering/weighting
4. **Graceful Failures**: If embedding fails, document still usable, job status logged for debugging
5. **Cost Awareness**: Token tracking per document for budget monitoring

---

## Next Steps

1. **Request OpenAI API key** if don't have one
2. **Run migrations** to create new tables in PostgreSQL
3. **Test embedding flow** with sample documents
4. **Implement text extraction** (PDF/DOCX support)
5. **Build hint generation AI** (LLM analysis of chunks)
6. **Add document upload trigger** to start embedding jobs
7. **Build duplicate review UI** for workspace members

---

## Files Created/Modified

### New Files
- `backend/celery_app.py` - Celery configuration
- `backend/tasks/__init__.py` - Tasks package
- `backend/tasks/embeddings.py` - Embedding Celery tasks
- `backend/utils/embeddings.py` - Embeddings service
- `backend/api/embeddings.py` - Embeddings API routes
- `backend/models/document_duplicate.py` - Duplicate model
- `backend/models/embedding_job.py` - Job tracking model
- `backend/models/document_hint.py` - Hint model
- `backend/migrations/20260218_enable_pgvector.sql` - Enable pgvector
- `backend/migrations/20260218_add_document_columns.sql` - Document updates
- `backend/migrations/20260218_create_dedup_and_embedding_tables.sql` - New tables

### Modified Files
- `backend/requirements.txt` - Added pgvector, openai, minio
- `backend/Dockerfile` - Added libpq-dev
- `backend/docker-compose.yml` - Added celery-worker service
- `backend/config.py` - Added OpenAI settings
- `backend/main.py` - Registered embeddings router
- `backend/models/__init__.py` - Added new model imports
- `backend/api/__init__.py` - Added embeddings router export
