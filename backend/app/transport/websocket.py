from fastapi import WebSocket
from .base import TransportAdapter
from ..core.stream import StreamEvent

class WebSocketAdapter(TransportAdapter):
    """WebSocket-specific implementation of TransportAdapter"""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        
    async def send_event(self, event: StreamEvent) -> None:
        """Send an event over WebSocket"""
        await self.websocket.send_json(event.to_dict())
        
    async def close(self) -> None:
        """Close the WebSocket connection"""
        await self.websocket.close()