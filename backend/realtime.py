"""
Real-time WebSocket connection manager.
Broadcast events to specific users so the frontend can refetch without polling.
"""
import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Maps user_id -> list of WebSocket connections for that user."""

    def __init__(self) -> None:
        self._connections: dict[int, list[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def register(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id not in self._connections:
                self._connections[user_id] = []
            self._connections[user_id].append(websocket)
        logger.debug("WebSocket registered for user_id=%s", user_id)

    async def unregister(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id in self._connections:
                try:
                    self._connections[user_id].remove(websocket)
                except ValueError:
                    pass
                if not self._connections[user_id]:
                    del self._connections[user_id]
        logger.debug("WebSocket unregistered for user_id=%s", user_id)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> None:
        """Send a JSON message to all connections for the given user."""
        async with self._lock:
            sockets = list(self._connections.get(user_id, []))
        if not sockets:
            return
        text = json.dumps(payload)
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(text)
            except Exception as e:
                logger.debug("Send to user %s failed: %s", user_id, e)
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    if user_id in self._connections:
                        try:
                            self._connections[user_id].remove(ws)
                        except ValueError:
                            pass
                if user_id in self._connections and not self._connections[user_id]:
                    del self._connections[user_id]


# Singleton used by API and WebSocket endpoint
connection_manager = ConnectionManager()
