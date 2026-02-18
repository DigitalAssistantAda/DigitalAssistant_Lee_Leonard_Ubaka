# Setup (Docker Desktop only)

These instructions are Docker-only and written for macOS.

Prerequisites
- Install Docker Desktop: https://www.docker.com/products/docker-desktop/.
- Launch Docker Desktop and wait until it reports "Docker Desktop is running".

Steps
1. From the project root, create the backend env file:
	- Copy backend/.env.example to backend/.env.
	- Fill in all required values in backend/.env.
2. In the project root, build and start the stack:
	- Run: docker compose up --build
3. Open the app:
	- http://localhost:3000
4. Open n8n:
	- http://localhost:5678
	- Default credentials: N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD (defaults: n8n / n8n)

Notes
- If storage is not configured in backend/.env, file upload will fail.
- To trigger embeddings via n8n, set these in backend/.env:
	- N8N_EMBEDDINGS_TRIGGER_URL=http://localhost:5678/webhook/<your-trigger-id>
	- N8N_WEBHOOK_SECRET=<shared-secret-for-backend-webhook>
- Configure your n8n workflow to call:
	- POST http://backend:8000/api/v1/webhooks/embeddings/process
	- Header: X-Webhook-Secret: <N8N_WEBHOOK_SECRET>
	- Body: {"document_id": <id>, "workspace_id": <id>, "triggered_by": <user_id>}
