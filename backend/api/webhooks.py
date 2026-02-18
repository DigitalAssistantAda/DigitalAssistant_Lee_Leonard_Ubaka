"""
n8n Integration Endpoints
Allows n8n workflows to interact with Ada's embedding and document processing system
"""
from fastapi import APIRouter, HTTPException, Header, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from tasks.embeddings import process_document_embeddings

router = APIRouter(prefix="/api/v1/webhooks", tags=["n8n Integration"])


# ============= Pydantic Models =============

class EmbeddingWebhookRequest(BaseModel):
    """Request from n8n to trigger document embedding"""
    document_id: int
    workspace_id: int
    triggered_by: Optional[int] = None


class WebhookResponse(BaseModel):
    """Response from webhook"""
    status: str
    task_id: str
    message: str


# ============= Webhooks =============

@router.post("/embeddings/process", response_model=WebhookResponse)
async def trigger_embedding_webhook(
    request: EmbeddingWebhookRequest,
    x_webhook_secret: Optional[str] = Header(None),
):
    """
    Webhook endpoint for n8n to trigger document embedding jobs
    
    Usage in n8n:
    - Method: POST
    - URL: http://backend:8000/api/v1/webhooks/embeddings/process
    - Body (JSON):
      {
        "document_id": 123,
        "workspace_id": 456,
        "triggered_by": 789
      }
    - Header: X-Webhook-Secret: (if configured)
    
    Returns:
        Celery task ID for tracking job progress
    """
    
    # Optional: Validate webhook secret if configured
    # if x_webhook_secret != settings.n8n_webhook_secret:
    #     raise HTTPException(status_code=403, detail="Invalid webhook secret")
    
    try:
        # Trigger async embedding task
        task = process_document_embeddings.delay(request.document_id, request.triggered_by)
        
        return WebhookResponse(
            status="queued",
            task_id=task.id,
            message=f"Embedding job queued for document {request.document_id}"
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue embedding job: {str(e)}"
        )


@router.get("/embeddings/status/{task_id}")
async def get_task_status(task_id: str):
    """
    Check status of an embedding task
    
    Usage in n8n:
    - Poll this endpoint with task_id from trigger_embedding_webhook response
    - Returns job progress and status
    
    Returns:
        {
          "status": "PENDING|PROGRESS|SUCCESS|FAILURE",
          "result": {...},
          "error": "..." (if failed)
        }
    """
    from celery.result import AsyncResult
    
    task_result = AsyncResult(task_id)
    
    return {
        "task_id": task_id,
        "status": task_result.status,
        "result": task_result.result,
        "traceback": task_result.traceback if task_result.failed() else None,
    }


# ============= n8n Workflow Examples =============
"""
EXAMPLE n8n WORKFLOW: Document Upload → Embedding

1. Webhook Trigger (on document upload)
   - Receives: document_id, user_id
   
2. Get Document Details
   - Query Ada API: GET /api/v1/documents/{document_id}
   - Extract: workspace_id
   
3. Trigger Embedding
   - POST /api/v1/webhooks/embeddings/process
   - Body: {document_id, workspace_id, triggered_by: user_id}
   - Extract: task_id from response
   
4. Wait for Completion (loop)
   - GET /api/v1/webhooks/embeddings/status/{task_id}
   - Sleep 5s between polls
   - Until: status == "SUCCESS" or "FAILURE"
   
5. On Success
   - Notify user: "Document indexed and searchable"
   - Trigger downstream workflows (hints, recommendations, etc.)
   
6. On Failure
   - Alert: "Embedding failed"
   - Retry with backoff

ALTERNATIVE: Use Ollama directly in n8n

n8n HTTP node to Ollama:
- Method: POST
- URL: http://ollama:11434/api/embed
- Body:
  {
    "model": "nomic-embed-text",
    "input": "{{ $json.text }}"
  }
- Returns: {"embeddings": [[0.1, 0.2, ...]]}
"""
