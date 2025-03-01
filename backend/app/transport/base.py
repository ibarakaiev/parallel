from abc import ABC, abstractmethod
from typing import Dict, Any, AsyncGenerator, Callable, Optional
from ..core.stream import StreamEvent

class TransportAdapter(ABC):
    """Abstract base class for transport adapters (WebSocket, SSE, etc.)"""
    
    @abstractmethod
    async def send_event(self, event: StreamEvent) -> None:
        """Send an event to the client"""
        pass
        
    @abstractmethod
    async def close(self) -> None:
        """Close the connection"""
        pass