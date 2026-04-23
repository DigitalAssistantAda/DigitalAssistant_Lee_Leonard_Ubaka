<p align="center">
  <img src="docs/banner.png" alt="Wide banner for Ada showing the product name and visual branding, representing an internal assistant that helps teams search, organize, and ask questions about their own documents." width="100%" />
</p>

**Ada** is an internal assistant for team documents.

Teams upload their files, organize them into workspaces, and ask questions about that content. Responses are based on workspace documents instead of general web knowledge.

## Project Title And Team Members

- Project title: Ada
- Team members: Ann Ubaka, Brittany Lee, Eltonia Leonard
- Repository: [DigitalAssistantAda/DigitalAssistant_Lee_Leonard_Ubaka](https://github.com/DigitalAssistantAda/DigitalAssistant_Lee_Leonard_Ubaka)
- Deployed system: local Docker deployment is documented below; no public deployment link is included in this repository

## System Description

Teams often store procedures, notes, and reference material across many files. Finding the right detail can take time, and answers are inconsistent when knowledge only lives in individual team members.

Ada indexes uploaded documents, supports keyword and semantic search, and lets users chat using selected files as context. The system also includes workspace collaboration, tasks, reminders, and audit logging.

## Why This Product Matters

- Keeps internal data in the team's own environment.
- Limits chat responses to uploaded workspace documents.
- Supports multi-user workflows: roles, notifications, assignments, and activity logs.
- Combines retrieval, organization, and task workflows in one system.

## Core Features And Functionality

- Document upload and storage for PDF, DOCX, TXT, and other supported files
- Workspace-based collaboration with member roles and invitations
- Hierarchical document organization using containers and default workspace folders
- Semantic and keyword search across indexed document content
- AI assistant conversations grounded in selected documents
- Conversation history with source-aware responses
- AI-assisted container suggestions for incoming documents
- Duplicate detection using embedding similarity
- Task and deadline tracking with assignees and status history
- Reminder extraction and AI-assisted follow-up hints from task and document content
- Dashboard activity views, notifications, and audit logging
- Fallback retrieval mode when LLM refinement is disabled

## System Architecture And Technical Approach

Ada uses a React frontend and a FastAPI backend. Data is stored in PostgreSQL with pgvector for semantic retrieval. Background jobs (indexing, embedding refresh, reminders) run with Celery and Redis. Documents are chunked and embedded so retrieval can find relevant passages before response generation.

At a high level, the flow is:

1. A user uploads a document into a workspace.
2. The backend stores metadata and queues indexing.
3. Celery extracts text, chunks content, generates embeddings, and stores retrievable fragments.
4. Search and chat use those chunks to retrieve relevant context.
5. Ada answers from that retrieved context, with a retrieval-only fallback available when needed.

## Technologies Used

### Backend

- FastAPI
- SQLAlchemy
- PostgreSQL
- pgvector
- Celery
- Redis
- boto3 / MinIO / S3-compatible object storage
- Sentence Transformers
- scikit-learn
- PyTorch

### Frontend

- React 18
- React Router
- lucide-react
- Tailwind CSS tooling
- react-scripts

### AI And Document Processing

- Sentence Transformers for local embeddings
- Optional OpenAI, Azure OpenAI, or Anthropic integration for response refinement
- pypdf and python-docx for document text extraction
- Workspace-specific embedding training support

## Installation And Setup

These steps match the current Docker-based setup in this repository.

### Prerequisites

- Docker Desktop
- A PostgreSQL database URL; the project is wired for Supabase by default
- A configured object storage target in `backend/.env` if you want file uploads to work end-to-end

### Quick Start

1. Copy `backend/.env.example` to `backend/.env`.
2. Set at least the following values in `backend/.env`:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - storage configuration values required by your environment
3. From the repository root, start the full stack:

```bash
docker compose up --build
```

4. Open [http://localhost:3000](http://localhost:3000).

### Optional Docker Profiles

- Use `docker compose --profile local-db up --build` to start with a local Postgres container instead of Supabase.
- Use `docker compose --profile schedule up --build` to run scheduled embedding refresh with Celery Beat.

### Additional Setup Notes

- If storage is not configured, uploads will fail.
- If documents remain stuck in queue, verify that the `celery-worker` service is running.
- For troubleshooting, environment details, and AI-off validation, see [SETUP.md](SETUP.md).

## Required Dependencies

### Runtime Dependencies

- Python backend dependencies are defined in `backend/requirements.txt`
- Frontend dependencies are defined in `frontend/package.json`
- Docker Compose orchestrates frontend, backend, Redis, and optional local database services

### Key Backend Packages

- `fastapi`
- `uvicorn`
- `sqlalchemy`
- `psycopg2-binary`
- `celery`
- `redis`
- `pgvector`
- `sentence-transformers`
- `scikit-learn`
- `torch`
- `boto3`
- `pypdf`
- `python-docx`

### Key Frontend Packages

- `react`
- `react-dom`
- `react-router-dom`
- `lucide-react`
- `tailwindcss`

## Test User Credentials

This repository includes demo seed tooling for a Golden Crust Bakery dataset.

- Demo seed generator: `demo_seed/generate_seed.py`
- Demo password for all seeded accounts: `BakeryDemo1!`

Example test users:

- `maria.santos` / `BakeryDemo1!`
- `james.chen` / `BakeryDemo1!`
- `aisha.patel` / `BakeryDemo1!`

The demo seed includes multiple workspaces, documents, tasks, and activity history for end-to-end testing and demos.

## Demo Scenarios And Test Cases

These are practical demo paths for the final presentation.

1. Upload and organize a new document.
  - Upload one of the sample files from `demo_seed/files/`.
  - Show indexing progress and the suggested destination folder.

2. Ask Ada a document-based question.
  - Select a bakery document such as the sourdough recipe or allergen policy.
  - Ask a question that requires a precise answer from the file.
  - Confirm that the response is based on selected document context.

3. Run semantic search across workspace knowledge.
  - Search for a business concept, recipe detail, or compliance term.
  - Show relevant snippets even when wording in the query does not exactly match the source text.

4. Demonstrate task and reminder support.
  - Create or open an issue or deadline.
  - Show assignees, status changes, and reminder behavior informed by content.

5. Show collaboration and visibility.
  - Switch across workspaces.
  - Open dashboard activity, notifications, or audit-relevant events to show team awareness.

## Testing

Backend tests currently cover focused logic around document reminder extraction and smart container suggestion behavior.

Run backend tests with:

```bash
cd backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests/ -v
```

Current test files include:

- `backend/tests/test_container_suggestion.py`
- `backend/tests/test_document_reminders.py`

## Source Code And Repository Structure

- `backend/`: FastAPI API, models, schemas, Celery tasks, embeddings, and utilities
- `frontend/`: React application and user interface
- `demo_seed/`: demo account and document generation for presentation scenarios
- `docs/`: project assets including banner artwork
- `SETUP.md`: detailed environment and troubleshooting notes
