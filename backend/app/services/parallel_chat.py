import asyncio
import json
from typing import List, Dict, Any, Optional, Tuple

from ..core.api import LLMProvider, TaskDecomposer, SynthesisGenerator, SolutionEvaluator
from ..core.stream import StreamEvent, StreamEventType, generate_id
from ..transport.base import TransportAdapter

class ParallelChatService:
    """Core service that orchestrates parallel chat interactions"""
    
    def __init__(self, 
                llm_provider: LLMProvider,
                decomposer: TaskDecomposer,
                evaluator: SolutionEvaluator,
                synthesizer: SynthesisGenerator,
                transport: TransportAdapter,
                max_parallel_tasks: int = 4,
                max_rebranch_iterations: int = 3):
        self.llm_provider = llm_provider
        self.decomposer = decomposer
        self.evaluator = evaluator
        self.synthesizer = synthesizer
        self.transport = transport
        self.max_parallel_tasks = max_parallel_tasks
        self.max_rebranch_iterations = max_rebranch_iterations
        
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
            
            # Initialize rebranching variables
            all_task_results = []  # Store all results across iterations for final synthesis
            rebranch_iteration = 0
            
            # Main processing loop with potential rebranching
            while rebranch_iteration <= self.max_rebranch_iterations:
                # Get the current tasks
                tasks = decomposition_result["tasks"]
                summary = decomposition_result["summary"]
                task_count = len(tasks)
                task_subjects = [task["subject"] for task in tasks]
                task_prompts = [task["prompt"] for task in tasks]
                
                # Send thinking end/update event with metadata
                thinking_step_text = "Analyzing query..." if rebranch_iteration == 0 else f"Refining approach (iteration {rebranch_iteration})..."
                await self.transport.send_event(StreamEvent(
                    event_type=StreamEventType.THINKING_END if rebranch_iteration == 0 else StreamEventType.THINKING_UPDATE,
                    sequence_id=sequence_id,
                    content=summary,
                    metadata={
                        "task_count": task_count,
                        "task_subjects": task_subjects,
                        "thinking_step": 1 + rebranch_iteration,
                        "rebranch_iteration": rebranch_iteration
                    }
                ))
                
                # STEP 2: "THINKING STAGE 2" - Parallel subtasks
                # Start parallel tasks - these are all considered "thinking" steps
                tasks_to_run = []
                task_results = []  # Store results for current iteration
                
                for i, task_info in enumerate(tasks):
                    task_id = f"{sequence_id}-task-{i}-iter-{rebranch_iteration}"
                    subject = task_info["subject"]
                    prompt = task_info["prompt"]
                    
                    # Copy messages and replace the last user message with the task prompt
                    messages_copy = messages.copy()
                    for j in range(len(messages_copy) - 1, -1, -1):
                        if messages_copy[j]["role"] == "user":
                            messages_copy[j]["content"] = prompt
                            break
                    
                    # Create task
                    # If this is a rebranched iteration, include prior task results as context
                    enhanced_messages = messages_copy.copy()
                    if rebranch_iteration > 0 and all_task_results:
                        # Find the user message to enhance with context
                        for j in range(len(enhanced_messages) - 1, -1, -1):
                            if enhanced_messages[j]["role"] == "user":
                                # Format previous task results as context
                                prior_results_text = "\n\n## Previous Analysis Results:\n"
                                for prior_result in all_task_results:
                                    # Only include results from previous iterations
                                    if prior_result.get("iteration", 0) < rebranch_iteration:
                                        subject = prior_result["subject"]
                                        content_preview = prior_result["content"][:500] + "..." if len(prior_result["content"]) > 500 else prior_result["content"]
                                        prior_results_text += f"\n### {subject}:\n{content_preview}\n"
                                
                                # Enhance the prompt with previous context
                                enhanced_messages[j]["content"] = enhanced_messages[j]["content"] + prior_results_text
                                break
                                
                    task = asyncio.create_task(
                        self._process_single_task(
                            sequence_id=sequence_id,
                            task_id=task_id,
                            task_index=i,
                            messages=enhanced_messages,
                            subject=subject,
                            task_results=task_results,
                            iteration=rebranch_iteration
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
                
                # Add this iteration's results to all results (for final synthesis)
                all_task_results.extend(task_results)
                
                # STEP 3: "EVALUATION STAGE" - Evaluate if ready for synthesis
                if rebranch_iteration < self.max_rebranch_iterations:
                    # Send thinking start event for evaluation
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.THINKING_START,
                        sequence_id=sequence_id,
                        content="Evaluating results...",
                        metadata={
                            "stage": "evaluation", 
                            "thinking_step": 2 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration
                        }
                    ))
                    
                    # Evaluate the results
                    evaluation_result = await self.evaluator.evaluate_results(
                        user_query=user_query,
                        task_results=task_results
                    )
                    
                    # Add token usage
                    if "input_tokens" in evaluation_result:
                        total_input_tokens += evaluation_result.get("input_tokens", 0)
                    if "output_tokens" in evaluation_result:
                        total_output_tokens += evaluation_result.get("output_tokens", 0)
                    
                    # Check if we need to rebranch
                    ready_for_synthesis = evaluation_result["ready_for_synthesis"]
                    explanation = evaluation_result["explanation"]
                    promising_paths = evaluation_result["promising_paths"]
                    
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.THINKING_END,
                        sequence_id=sequence_id,
                        content=explanation,
                        metadata={
                            "stage": "evaluation", 
                            "thinking_step": 2 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration,
                            "ready_for_synthesis": ready_for_synthesis
                        }
                    ))
                    
                    # If ready for synthesis, break out of the loop
                    if ready_for_synthesis or not promising_paths:
                        break
                    
                    # If we've reached the max iterations, break out
                    if rebranch_iteration >= self.max_rebranch_iterations - 1:
                        break
                    
                    # Otherwise, generate new subtasks and continue
                    # First, send a rebranch start event to indicate preserving previous tasks
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.REBRANCH_START,
                        sequence_id=sequence_id,
                        content="I need to explore promising paths further before finalizing an answer.",
                        metadata={
                            "stage": "rebranching", 
                            "thinking_step": 3 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration,
                            "promising_paths": promising_paths
                        }
                    ))
                    
                    # Then normal thinking start for the rebranching planning phase
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.THINKING_START,
                        sequence_id=sequence_id,
                        content="Planning deeper exploration...",
                        metadata={
                            "stage": "rebranching", 
                            "thinking_step": 3 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration
                        }
                    ))
                    
                    # Generate new subtasks
                    decomposition_result = await self.evaluator.generate_new_subtasks(
                        user_query=user_query,
                        task_results=task_results,
                        promising_paths=promising_paths,
                        max_tasks=self.max_parallel_tasks
                    )
                    
                    # Add token usage
                    if "input_tokens" in decomposition_result:
                        total_input_tokens += decomposition_result.get("input_tokens", 0)
                    if "output_tokens" in decomposition_result:
                        total_output_tokens += decomposition_result.get("output_tokens", 0)
                    
                    # Send thinking end event for rebranching planning phase
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.THINKING_END,
                        sequence_id=sequence_id,
                        content=f"Exploring {len(decomposition_result['tasks'])} promising directions...",
                        metadata={
                            "stage": "rebranching", 
                            "thinking_step": 3 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration
                        }
                    ))
                    
                    # Then send a rebranch end event to mark the end of this rebranch planning
                    await self.transport.send_event(StreamEvent(
                        event_type=StreamEventType.REBRANCH_END,
                        sequence_id=sequence_id,
                        content=decomposition_result["summary"],
                        metadata={
                            "stage": "rebranching", 
                            "thinking_step": 3 + rebranch_iteration,
                            "rebranch_iteration": rebranch_iteration,
                            "new_tasks": [task["subject"] for task in decomposition_result["tasks"]]
                        }
                    ))
                    
                    # Increment iteration counter
                    rebranch_iteration += 1
                else:
                    # If we've reached the max iterations, break out
                    break
            
            # STEP 4: "FINAL RESPONSE" - Generate a synthesized response
            # Generate the final response by synthesizing all the completed task results across all iterations
            synthesis_tokens = {"input_tokens": 0, "output_tokens": 0}
            
            if len(all_task_results) > 1:
                # Determine if we should stream the final response
                # Use non-streaming mode when the transport is capturing the final response
                transport_name = type(self.transport).__name__
                use_stream = transport_name != "FinalResponseCapture"
                
                print(f"Using stream={use_stream} for synthesis based on transport type: {transport_name}")
                
                # Generate the final response with appropriate streaming setting
                synthesis_tokens = await self._generate_final_response(
                    sequence_id=sequence_id,
                    user_query=user_query,
                    task_results=all_task_results,
                    task_subjects=[result["subject"] for result in all_task_results],
                    stream=use_stream
                )
                
                # Add synthesis tokens to totals
                total_input_tokens += synthesis_tokens.get("input_tokens", 0)
                total_output_tokens += synthesis_tokens.get("output_tokens", 0)
            else:
                # If there's only one task result, use it as the final response
                # Stream it as a single chunk
                result_content = all_task_results[0]["content"] if all_task_results else "No results were generated."
                
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
                    "task_count": len(all_task_results),
                    "rebranch_iterations": rebranch_iteration,
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
                                task_results: List,
                                iteration: int = 0) -> None:
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
                    "thinking_step": 2 + iteration,
                    "subtask": True,
                    "rebranch_iteration": iteration
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
                            "thinking_step": 2 + iteration,
                            "subtask": True,
                            "rebranch_iteration": iteration
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
                    "thinking_step": 2 + iteration,
                    "subtask": True,
                    "rebranch_iteration": iteration,
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
                "output_tokens": output_tokens,
                "iteration": iteration
            })
            
        except Exception as e:
            await self._send_error(
                sequence_id, 
                f"Error in task {task_id}: {str(e)}", 
                task_id,
                {"task_index": task_index, "rebranch_iteration": iteration}
            )
    
    async def _generate_final_response(self,
                                     sequence_id: str,
                                     user_query: str,
                                     task_results: List[Dict[str, Any]],
                                     task_subjects: List[str],
                                     stream: bool = True) -> Dict[str, int]:
        """Generate a final synthesized response from all the parallel task results with streaming"""
        input_tokens = 0
        output_tokens = 0
        
        try:
            # Send stream start event for final response
            await self.transport.send_event(StreamEvent(
                event_type=StreamEventType.STREAM_START,
                sequence_id=sequence_id,
                content="",
                metadata={"is_final_response": True}
            ))
            
            # Generate the synthesis using the synthesizer component
            # Pass along the stream parameter so we can control streaming behavior
            async for chunk in self.synthesizer.generate_synthesis(
                user_query=user_query,
                task_results=task_results,
                stream=stream
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
            
            # Group results by iteration for organized fallback
            results_by_iteration = {}
            for result in task_results:
                iteration = result.get("iteration", 0)
                if iteration not in results_by_iteration:
                    results_by_iteration[iteration] = []
                results_by_iteration[iteration].append(result)
            
            # Add results grouped by iteration
            for iteration, results in sorted(results_by_iteration.items()):
                fallback_synthesis += f"# Exploration Round {iteration+1}\n\n"
                for result in sorted(results, key=lambda x: x["task_index"]):
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