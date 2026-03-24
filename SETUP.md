# Setup (Docker Desktop only)

These instructions are Docker-only and written for macOS.

Prerequisites
- Install Docker Desktop: https://www.docker.com/products/docker-desktop/.
- Launch Docker Desktop and wait until it reports "Docker Desktop is running".
- A Supabase project (database). Get your connection string from Supabase Dashboard → Settings → Database.

Steps
1. From the project root, create the backend env file:
	- Copy backend/.env.example to backend/.env.
	- Set DATABASE_URL to your Supabase connection string (use port 5432, direct connection). Example:
	  DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
	  Or from Supabase: Settings → Database → Connection string → URI (copy and paste, replace [YOUR-PASSWORD]).
	- Fill in all other required values in backend/.env.
2. In the project root, build and start the stack (uses Supabase; no local Postgres container):
	- Run: docker compose up --build
3. Open the app:
	- http://localhost:3000

Notes
- **Database:** The stack uses **Supabase** as the database. Set DATABASE_URL in backend/.env to your Supabase connection string. The local Postgres container (db) is not started by default. To use a local Postgres instead, run: docker compose --profile local-db up --build.
- If storage is not configured in backend/.env, file upload will fail.
- **Embeddings (Docker):** The stack uses the **local** embedding model (Sentence Transformers) by default. The backend image includes PyTorch (CPU). Fine-tuned models are stored in the `embedding_model_data` volume (shared by backend and Celery worker). To use Voyage AI instead, set `EMBEDDING_SERVICE=voyage` and `VOYAGE_API_KEY` in backend/.env (or in the shell before `docker compose up`).
- **Scheduled embedding refresh:** To run a weekly re-embed of all documents, start Celery Beat with: `docker compose --profile schedule up --build`. Set `EMBEDDING_REFRESH_ENABLED=true` in backend/.env (or in the environment) so the schedule is active.

Documents stuck in the queue
- Indexing runs in a **Celery worker**. If documents stay "In the queue" and never become "Ready to search", the worker may not be running or may be failing.
- **With Docker:** Ensure the full stack is up, including the worker:
	- Run: docker compose up --build
	- You should see containers: backend, frontend, redis, celery-worker. If celery-worker is missing, start it: docker compose up -d celery-worker
	- Check worker logs: docker compose logs -f celery-worker
	- If the worker exits on startup, check for errors (e.g. missing REDIS_URL, DATABASE_URL, or embedding model load failure).
- **Without Docker:** Start the worker manually from the backend directory:
	- Set REDIS_URL and DATABASE_URL in .env (same as the API).
	- Run: celery -A celery_app worker --loglevel=info
- **Restart button:** For each stuck document, use the **Restart** action in the document list to re-queue indexing. If the worker is running, it will pick up the task.
