from fastapi import Response
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse
import asyncio
import json
from typing import List, AsyncGenerator, Optional

from .base import TransportAdapter
from ..core.stream import StreamEvent

class SSEAdapter(TransportAdapter):
    """Server-Sent Events implementation of TransportAdapter"""
    
    def __init__(self):
        self.queue = asyncio.Queue()
        self.is_closed = False
        
    async def send_event(self, event: StreamEvent) -> None:
        """Format and send an event as SSE"""
        await self.queue.put(event.to_sse())
        
    async def close(self) -> None:
        """Close the SSE connection"""
        await self.queue.put("data: [DONE]\n\n")
        self.is_closed = True
    
    async def event_generator(self) -> AsyncGenerator[str, None]:
        """Generate SSE events for streaming response"""
        while not self.is_closed:
            try:
                # Wait for the next event with a timeout
                event_data = await asyncio.wait_for(self.queue.get(), timeout=60.0)
                yield event_data
                self.queue.task_done()
                
                # If this was the [DONE] event, we're done
                if event_data == "data: [DONE]\n\n":
                    break
                    
            except asyncio.TimeoutError:
                # Send a keepalive comment to prevent connection timeout
                yield ": keepalive\n\n"
                continue
                
            except Exception as e:
                # Something went wrong, log and exit
                yield f"data: {{\"type\": \"error\", \"content\": \"{str(e)}\"}}\n\n"
                break
    
    def get_response(self) -> StreamingResponse:
        """Get a StreamingResponse for the SSE stream"""
        return StreamingResponse(
            self.event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no",  # Disable proxy buffering
            }
        )