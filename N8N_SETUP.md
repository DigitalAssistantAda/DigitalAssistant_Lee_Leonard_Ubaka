# n8n Setup (Embeddings Trigger)

This guide explains how to wire n8n so embeddings run after a file upload.

## 1) Start the stack

From the project root:

```
docker compose up --build
```

Open n8n:
- http://localhost:5678
- Default credentials: `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` (defaults: `n8n` / `n8n`)

## 2) Configure backend environment

Add these to `backend/.env`:

```
# n8n -> backend trigger
N8N_EMBEDDINGS_TRIGGER_URL=http://localhost:5678/webhook/<your-n8n-trigger-id>
N8N_WEBHOOK_SECRET=<shared-secret>
```

Notes:
- `N8N_EMBEDDINGS_TRIGGER_URL` is the n8n webhook URL created in step 3.
- `N8N_WEBHOOK_SECRET` is a shared secret used to authorize n8n calls into the backend.

## 3) Create the n8n workflow

### Workflow goal
When a document is uploaded, the backend calls n8n. n8n then calls back into the backend to start embeddings.

### Minimal workflow steps
1. **Trigger**: Webhook (HTTP)
   - Method: POST
   - Path: `embeddings-trigger`
   - This generates a URL like:
     - `http://localhost:5678/webhook/embeddings-trigger`
   - Use that URL as `N8N_EMBEDDINGS_TRIGGER_URL`.

2. **HTTP Request** (call backend to start embeddings)
   - Method: POST
   - URL: `http://backend:8000/api/v1/webhooks/embeddings/process`
   - Headers:
     - `Content-Type: application/json`
     - `X-Webhook-Secret: <N8N_WEBHOOK_SECRET>`
   - Body (JSON):
     ```json
     {
       "document_id": "{{$json.document_id}}",
       "workspace_id": "{{$json.workspace_id}}",
       "triggered_by": "{{$json.triggered_by}}"
     }
     ```

3. **Activate** the workflow.

## 4) Verify the flow

1. Upload a document through the app.
2. n8n should receive the webhook and call the backend.
3. Check job status with:
   - `GET /api/v1/embeddings/documents/{document_id}/job`

## Troubleshooting

- If no job appears, confirm `N8N_EMBEDDINGS_TRIGGER_URL` is set and n8n workflow is activated.
- If you get a 403 from the backend webhook, verify `X-Webhook-Secret` matches `N8N_WEBHOOK_SECRET`.
- If you get a 404/400 from the backend webhook, the document/workspace IDs are wrong or missing.
