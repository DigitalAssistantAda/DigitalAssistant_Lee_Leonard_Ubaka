"""
WebSocket endpoint for real-time push. Clients connect with ?token=JWT.
Server sends JSON messages: { "type": "notifications.changed" | "workspaces.changed", "payload": {} }
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException

from database import SessionLocal
from models.user import User
from utils.auth import decode_token
from realtime import connection_manager

router = APIRouter(tags=["WebSocket"])
logger = logging.getLogger(__name__)


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., alias="token"),
):
    """Authenticate via token query param and keep connection open for server push."""
    await websocket.accept()
    user_id: int | None = None

    try:
        try:
            payload = decode_token(token)
        except HTTPException:
            await websocket.close(code=4001)
            return
        user_id = int(payload.get("sub", 0))
        if user_id <= 0:
            await websocket.close(code=4001)
            return
        db = SessionLocal()
        try:
            user = db.query(User).filter(
                User.id == user_id,
                User.is_active == True,
                User.is_deleted == False,
            ).first()
            if not user:
                await websocket.close(code=4001)
                return
        finally:
            db.close()

        await connection_manager.register(user_id, websocket)
        try:
            # Keep connection alive; client doesn't have to send anything
            while True:
                _ = await websocket.receive_text()
        except WebSocketDisconnect:
            pass
    except Exception as e:
        logger.debug("WebSocket auth or receive error: %s", e)
        try:
            await websocket.close(code=4001)
        except Exception:
            pass
    finally:
        if user_id is not None:
            await connection_manager.unregister(user_id, websocket)
