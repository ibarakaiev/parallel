import asyncio
import json
from typing import List, Dict, Any, Optional, Tuple

from ..core.api import LLMProvider, TaskDecomposer
from ..core.stream import StreamEvent, StreamEventType, generate_id
from ..transport.base import TransportAdapter

class ParallelChatService:
    """Core service that orchestrates parallel chat interactions"""
    
    def __init__(self, 
                llm_provider: LLMProvider,
                decomposer: TaskDecomposer,
                transport: TransportAdapter,
                max_parallel_tasks: int = 4):
        self.llm_provider = llm_provider
        self.decomposer = decomposer
        self.transport = transport
        self.max_parallel_tasks = max_parallel_tasks
        
    async def process_query(self, messages: List[Dict[str, str]]) -> None:
        """Process a query with potential parallelization"""
        sequence_id = generate_id()
        
        # Extract user query from messages
        user_query = next((msg["content"] for msg in reversed(messages) 
                        if msg["role"] == "user"), None)
        
        if not user_query:
            await self._send_error(sequence_id, "No user query found in messages")
            return
            
        try:
            # Send thinking start event
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.THINKING_START,
                sequence_id=sequence_id,
                content="Analyzing query...",
                metadata={"stage": "decomposition"}
            ))
            
            # Decompose the query
            decomposition_result = await self.decomposer.decompose_query(
                user_query, max_tasks=self.max_parallel_tasks
            )
            
            tasks = decomposition_result["tasks"]
            summary = decomposition_result["summary"]
            task_count = len(tasks)
            task_subjects = [task["subject"] for task in tasks]
            task_prompts = [task["prompt"] for task in tasks]
            
            # Send thinking end event with metadata
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.THINKING_END,
                sequence_id=sequence_id,
                content=summary,
                metadata={
                    "task_count": task_count,
                    "task_subjects": task_subjects
                }
            ))
            
            # Start parallel tasks
            tasks_to_run = []
            for i, task_info in enumerate(tasks):
                task_id = f"{sequence_id}-task-{i}"
                subject = task_info["subject"]
                prompt = task_info["prompt"]
                
                # Copy messages and replace the last user message with the task prompt
                messages_copy = messages.copy()
                for j in range(len(messages_copy) - 1, -1, -1):
                    if messages_copy[j]["role"] == "user":
                        messages_copy[j]["content"] = prompt
                        break
                
                # Create task
                task = asyncio.create_task(
                    self._process_single_task(
                        sequence_id=sequence_id,
                        task_id=task_id,
                        task_index=i,
                        messages=messages_copy,
                        subject=subject
                    )
                )
                tasks_to_run.append(task)
            
            # Wait for all tasks to complete
            await asyncio.gather(*tasks_to_run)
            
            # Send completion event
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.METADATA,
                sequence_id=sequence_id,
                metadata={"status": "all_complete", "task_count": task_count}
            ))
            
            # Close the transport
            await self.transport.close()
            
        except Exception as e:
            await self._send_error(sequence_id, f"Error processing query: {str(e)}")
            await self.transport.close()
            
    async def _process_single_task(self, 
                                sequence_id: str,
                                task_id: str,
                                task_index: int,
                                messages: List[Dict[str, str]],
                                subject: str) -> None:
        """Process a single task with streaming"""
        try:
            # Send stream start event
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.STREAM_START,
                sequence_id=sequence_id,
                task_id=task_id,
                metadata={
                    "subject": subject,
                    "task_index": task_index
                }
            ))
            
            full_content = ""
            
            # Generate streaming completion
            async for chunk in self.llm_provider.generate_completion(
                messages=messages,
                stream=True
            ):
                if "content" in chunk and chunk["content"]:
                    text = chunk["content"]
                    full_content += text
                    
                    # Send content chunk
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.CONTENT_CHUNK,
                        sequence_id=sequence_id,
                        task_id=task_id,
                        content=text,
                        metadata={"task_index": task_index}
                    ))
            
            # Send stream end event
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.STREAM_END,
                sequence_id=sequence_id,
                task_id=task_id,
                content=full_content,
                metadata={
                    "subject": subject,
                    "task_index": task_index
                }
            ))
            
        except Exception as e:
            await self._send_error(
                sequence_id, 
                f"Error in task {task_id}: {str(e)}", 
                task_id,
                {"task_index": task_index}
            )
    
    async def _send_error(self, 
                         sequence_id: str, 
                         error_message: str, 
                         task_id: Optional[str] = None,
                         metadata: Optional[Dict[str, Any]] = None) -> None:
        """Send an error event"""
        await self.transport.send_event(StreamEvent(
            event_type=StreamEventType.ERROR,
            sequence_id=sequence_id,
            task_id=task_id,
            content=error_message,
            metadata=metadata or {}
        ))