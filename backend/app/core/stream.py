import time
import uuid
import json
from enum import Enum
from typing import Dict, Any, Optional, List

class StreamEventType(Enum):
    """Standard event types for any client implementation"""
    THINKING_START = "thinking_start"
    THINKING_UPDATE = "thinking_update"
    THINKING_END = "thinking_end"
    STREAM_START = "stream_start"
    CONTENT_CHUNK = "content_chunk"
    STREAM_END = "stream_end"
    ERROR = "error"
    METADATA = "metadata"

class StreamEvent:
    """Standardized event format for streaming responses"""
    
    def __init__(self, 
                event_type: StreamEventType,
                sequence_id: str,
                task_id: Optional[str] = None,
                content: Optional[str] = None,
                metadata: Optional[Dict[str, Any]] = None):
        self.event_type = event_type
        self.sequence_id = sequence_id  # Unique ID for the streaming sequence
        self.task_id = task_id  # ID for parallel tasks
        self.content = content
        self.metadata = metadata or {}
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "type": self.event_type.value,
            "sequence_id": self.sequence_id,
            "task_id": self.task_id,
            "content": self.content,
            "metadata": self.metadata,
            "timestamp": self._get_timestamp()
        }
    
    def to_sse(self) -> str:
        """Convert to Server-Sent Events format"""
        data = json.dumps(self.to_dict())
        return f"data: {data}\n\n"
        
    def _get_timestamp(self) -> int:
        """Get current timestamp in milliseconds"""
        return int(time.time() * 1000)

def generate_id() -> str:
    """Generate a unique ID for a sequence or task"""
    return str(uuid.uuid4())