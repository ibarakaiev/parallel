import asyncio
import json
from typing import List, Dict, Any, Optional, Tuple

from ..core.api import LLMProvider, TaskDecomposer, SynthesisGenerator
from ..core.stream import StreamEvent, StreamEventType, generate_id
from ..transport.base import TransportAdapter

class ParallelChatService:
    """Core service that orchestrates parallel chat interactions"""
    
    def __init__(self, 
                llm_provider: LLMProvider,
                decomposer: TaskDecomposer,
                synthesizer: SynthesisGenerator,
                transport: TransportAdapter,
                max_parallel_tasks: int = 4):
        self.llm_provider = llm_provider
        self.decomposer = decomposer
        self.synthesizer = synthesizer
        self.transport = transport
        self.max_parallel_tasks = max_parallel_tasks
        
    async def process_query(self, messages: List[Dict[str, str]]) -> None:
        """Process a query with potential parallelization"""
        sequence_id = generate_id()
        
        # Initialize token counters
        total_input_tokens = 0
        total_output_tokens = 0
        
        # Extract user query from messages
        user_query = next((msg["content"] for msg in reversed(messages) 
                        if msg["role"] == "user"), None)
        
        if not user_query:
            await self._send_error(sequence_id, "No user query found in messages")
            return
            
        try:
            # STEP 1: "THINKING STAGE 1" - Decomposition
            # Send thinking start event
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.THINKING_START,
                sequence_id=sequence_id,
                content="Analyzing query...",
                metadata={"stage": "decomposition", "thinking_step": 1}
            ))
            
            # Decompose the query
            decomposition_result = await self.decomposer.decompose_query(
                user_query, max_tasks=self.max_parallel_tasks
            )
            
            # If decomposition response has token counts, add them to totals
            if isinstance(decomposition_result, dict):
                if "input_tokens" in decomposition_result:
                    total_input_tokens += decomposition_result.get("input_tokens", 0)
                if "output_tokens" in decomposition_result:
                    total_output_tokens += decomposition_result.get("output_tokens", 0)
            
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
                    "task_subjects": task_subjects,
                    "thinking_step": 1
                }
            ))
            
            # STEP 2: "THINKING STAGE 2" - Parallel subtasks
            # Start parallel tasks - these are all considered "thinking" steps
            tasks_to_run = []
            task_results = []  # Store results for synthesis
            
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
                        subject=subject,
                        task_results=task_results
                    )
                )
                tasks_to_run.append(task)
            
            # Wait for all tasks to complete
            await asyncio.gather(*tasks_to_run)
            
            # Add up token counts from all tasks
            for result in task_results:
                if "input_tokens" in result:
                    total_input_tokens += result.get("input_tokens", 0)
                if "output_tokens" in result:
                    total_output_tokens += result.get("output_tokens", 0)
            
            # STEP 3: "FINAL RESPONSE" - Generate a synthesized response
            # Generate the final response by synthesizing all the completed task results
            synthesis_tokens = {"input_tokens": 0, "output_tokens": 0}
            
            if task_count > 1:
                # This will now stream the response directly as chunks
                synthesis_tokens = await self._generate_final_response(
                    sequence_id=sequence_id,
                    user_query=user_query,
                    task_results=task_results,
                    task_subjects=task_subjects
                )
                
                # Add synthesis tokens to totals
                total_input_tokens += synthesis_tokens.get("input_tokens", 0)
                total_output_tokens += synthesis_tokens.get("output_tokens", 0)
            else:
                # If there's only one task, use its result as the final response
                # Stream it as a single chunk
                result_content = task_results[0]["content"] if task_results else "No results were generated."
                
                # Send a stream start event
                await self.transport.send_event(StreamEvent(
                    event_type=StreamEventType.STREAM_START,
                    sequence_id=sequence_id,
                    content="",
                    metadata={"is_final_response": True}
                ))
                
                # Stream the single task result as the final response
                await self.transport.send_event(StreamEvent(
                    event_type=StreamEventType.CONTENT_CHUNK,
                    sequence_id=sequence_id,
                    content=result_content,
                    metadata={"is_final_response": True}
                ))
            
            # Send completion event with token usage
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.METADATA,
                sequence_id=sequence_id,
                metadata={
                    "status": "all_complete", 
                    "task_count": task_count,
                    "usage": {
                        "input_tokens": total_input_tokens,
                        "output_tokens": total_output_tokens
                    }
                }
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
                                subject: str,
                                task_results: List) -> None:
        """Process a single task with streaming - now treated as a thinking step"""
        try:
            # Send stream start event (now as a thinking step)
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.THINKING_START,
                sequence_id=sequence_id,
                task_id=task_id,
                content="",
                metadata={
                    "subject": subject,
                    "task_index": task_index,
                    "thinking_step": 2,
                    "subtask": True
                }
            ))
            
            full_content = ""
            input_tokens = 0
            output_tokens = 0
            
            # Generate streaming completion
            async for chunk in self.llm_provider.generate_completion(
                messages=messages,
                stream=True
            ):
                # Track token usage
                if "input_tokens" in chunk:
                    input_tokens = chunk["input_tokens"]
                if "output_tokens" in chunk:
                    output_tokens = chunk["output_tokens"]
                    
                # Handle content chunks
                if "content" in chunk and chunk["content"]:
                    text = chunk["content"]
                    full_content += text
                    
                    # Send content chunk
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.CONTENT_CHUNK,
                        sequence_id=sequence_id,
                        task_id=task_id,
                        content=text,
                        metadata={
                            "task_index": task_index,
                            "thinking_step": 2,
                            "subtask": True
                        }
                    ))
            
            # Send stream end event (now as thinking end)
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.THINKING_END,
                sequence_id=sequence_id,
                task_id=task_id,
                content=full_content,
                metadata={
                    "subject": subject,
                    "task_index": task_index,
                    "thinking_step": 2,
                    "subtask": True,
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens
                    }
                }
            ))
            
            # Add result to task_results for later synthesis
            task_results.append({
                "subject": subject,
                "content": full_content,
                "task_index": task_index,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens
            })
            
        except Exception as e:
            await self._send_error(
                sequence_id, 
                f"Error in task {task_id}: {str(e)}", 
                task_id,
                {"task_index": task_index}
            )
    
    async def _generate_final_response(self,
                                     sequence_id: str,
                                     user_query: str,
                                     task_results: List[Dict[str, Any]],
                                     task_subjects: List[str]) -> Dict[str, int]:
        """Generate a final synthesized response from all the parallel task results with streaming"""
        input_tokens = 0
        output_tokens = 0
        
        try:
            # Sort results by task_index to ensure correct order
            sorted_results = sorted(task_results, key=lambda x: x["task_index"])
            
            # Send stream start event for final response
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.STREAM_START,
                sequence_id=sequence_id,
                content="",
                metadata={"is_final_response": True}
            ))
            
            # Generate the synthesis using the synthesizer component with streaming
            # The synthesizer now returns chunks that we can stream to the client
            async for chunk in self.synthesizer.generate_synthesis(
                user_query=user_query,
                task_results=sorted_results
            ):
                # Track token usage if available
                if isinstance(chunk, dict):
                    if "input_tokens" in chunk:
                        input_tokens = chunk.get("input_tokens", 0)
                    if "output_tokens" in chunk:
                        output_tokens = chunk.get("output_tokens", 0)
                    if "content" in chunk:
                        chunk = chunk["content"]
                
                # Stream each chunk as a content chunk
                await self.transport.send_event(StreamEvent(
                    event_type=StreamEventType.CONTENT_CHUNK,
                    sequence_id=sequence_id,
                    content=chunk if isinstance(chunk, str) else "",
                    metadata={"is_final_response": True}
                ))
            
            # Return token usage for the synthesis
            return {"input_tokens": input_tokens, "output_tokens": output_tokens}
            
        except Exception as e:
            # If synthesis fails, create a simple synthesis ourselves
            error_message = f"Error generating synthesis: {str(e)}"
            print(error_message)  # Log the error
            
            # Create a basic fallback synthesis
            fallback_synthesis = f"Here's what I found in response to your query:\n\n"
            
            for result in sorted(task_results, key=lambda x: x["task_index"]):
                subject = result["subject"]
                content = result["content"]
                # Add a summary of each result (first 200 chars)
                summary = content[:200] + "..." if len(content) > 200 else content
                fallback_synthesis += f"## {subject}\n{summary}\n\n"
            
            # Send the fallback synthesis as a single chunk
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.CONTENT_CHUNK,
                sequence_id=sequence_id,
                content=fallback_synthesis,
                metadata={"is_final_response": True}
            ))
            
            # Return empty token usage for the fallback
            return {"input_tokens": 0, "output_tokens": 0}
    
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