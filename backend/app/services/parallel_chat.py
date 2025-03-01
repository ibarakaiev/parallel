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
            
            # STEP 3: "FINAL RESPONSE" - Generate a synthesized response
            # Generate the final response by synthesizing all the completed task results
            if task_count > 1:
                final_response = await self._generate_final_response(
                    sequence_id=sequence_id,
                    user_query=user_query,
                    task_results=task_results,
                    task_subjects=task_subjects
                )
            else:
                # If there's only one task, use its result as the final response
                final_response = task_results[0]["content"] if task_results else "No results were generated."
            
            # Send the final synthesized response
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.FINAL_RESPONSE,
                sequence_id=sequence_id,
                content=final_response,
                metadata={"task_count": task_count}
            ))
            
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
                    "subtask": True
                }
            ))
            
            # Add result to task_results for later synthesis
            task_results.append({
                "subject": subject,
                "content": full_content,
                "task_index": task_index
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
                                     task_subjects: List[str]) -> str:
        """Generate a final synthesized response from all the parallel task results"""
        try:
            # Sort results by task_index to ensure correct order
            sorted_results = sorted(task_results, key=lambda x: x["task_index"])
            
            # Generate the synthesis using the synthesizer component
            synthesis = await self.synthesizer.generate_synthesis(
                user_query=user_query,
                task_results=sorted_results
            )
            
            return synthesis
            
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
                
            return fallback_synthesis
    
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