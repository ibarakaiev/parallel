import os
import json
import asyncio
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union

from app.core.api import AnthropicProvider, TaskDecomposer, SynthesisGenerator, SolutionEvaluator
from app.core.stream import StreamEvent, StreamEventType, generate_id
from app.transport.base import TransportAdapter
from app.transport.websocket import WebSocketAdapter
from app.transport.sse import SSEAdapter
from app.services.parallel_chat import ParallelChatService
from app.prompts import (
    MASTER_DECOMPOSITION_PROMPT, 
    SYNTHESIS_PROMPT, 
    SOLUTION_EVALUATION_PROMPT,
    REBRANCH_PROMPT
)

# Get API key from environment
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

# Create core service components
anthropic_provider = AnthropicProvider(api_key=ANTHROPIC_API_KEY)
decomposer = TaskDecomposer(
    llm_provider=anthropic_provider,
    prompt_template=MASTER_DECOMPOSITION_PROMPT
)
evaluator = SolutionEvaluator(
    llm_provider=anthropic_provider,
    evaluation_prompt_template=SOLUTION_EVALUATION_PROMPT,
    rebranch_prompt_template=REBRANCH_PROMPT
)
synthesizer = SynthesisGenerator(
    llm_provider=anthropic_provider,
    prompt_template=SYNTHESIS_PROMPT
)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Schema definitions
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    stream: bool = True
    max_tokens: Optional[int] = 1024
    model: Optional[str] = "claude-3-haiku-20240307"

@app.get("/")
async def root():
    return {"message": "Welcome to the Parallel API"}

@app.route("/v1/messages", methods=["POST", "GET"])
async def messages_endpoint(request: Request):
    """
    Anthropic-compatible API endpoint that supports both streaming and non-streaming responses.
    For streaming, it returns a streaming response using SSE.
    For non-streaming, it returns a JSON response with the result.
    """
    # Handle preflight CORS requests
    if request.method == "OPTIONS":
        return JSONResponse(
            content={},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            }
        )
        
    # Parse request body for POST requests
    if request.method == "POST":
        try:
            request_data = await request.json()
        except Exception as e:
            print(f"Error parsing request JSON: {str(e)}")
            return JSONResponse(
                status_code=400, 
                content={"error": "Invalid JSON"},
                headers={"Access-Control-Allow-Origin": "*"}
            )
            
        messages = request_data.get("messages", [])
        stream = request_data.get("stream", True)
        max_tokens = request_data.get("max_tokens", 1024)
        model = request_data.get("model", "claude-3-haiku-20240307")
    else:
        # GET requests can only be for streaming
        stream = True
        messages = []
        max_tokens = 1024
        model = "claude-3-haiku-20240307"
    
    # If not streaming, use the ParallelChatService but collect the final response
    if not stream:
        try:
            # Create a special transport to capture the final response
            class FinalResponseCapture(TransportAdapter):
                def __init__(self):
                    self.final_response = None
                    self.input_tokens = 0
                    self.output_tokens = 0
                    self.decomposition_result = None
                    self.task_contents = []
                    self.task_subjects = []
                    self.evaluation_results = []
                    print("FinalResponseCapture initialized")
                
                async def send_event(self, event: StreamEvent):
                    # Log all events for debugging
                    print(f"Event received: {event.event_type}, task_id: {event.task_id}, metadata: {event.metadata}")
                    
                    # Capture decomposition results
                    if event.event_type == StreamEventType.THINKING_END and event.metadata.get("thinking_step") == 1:
                        self.decomposition_result = event.content
                        self.task_subjects = event.metadata.get("task_subjects", [])
                        print(f"Captured decomposition: {event.content[:100]}...")
                        
                    # Capture task results
                    if event.event_type == StreamEventType.THINKING_END and event.metadata.get("subtask") == True:
                        task_index = event.metadata.get("task_index")
                        subject = event.metadata.get("subject", f"Task {task_index}")
                        iteration = event.metadata.get("rebranch_iteration", 0)
                        print(f"Captured task result {task_index} - {subject} (iteration {iteration}): {event.content[:50]}...")
                        self.task_contents.append({
                            "index": task_index,
                            "subject": subject,
                            "content": event.content,
                            "iteration": iteration
                        })
                    
                    # Capture evaluation results
                    if event.event_type == StreamEventType.THINKING_END and event.metadata.get("stage") == "evaluation":
                        iteration = event.metadata.get("rebranch_iteration", 0)
                        print(f"Captured evaluation (iteration {iteration}): {event.content[:100]}...")
                        
                        # Make sure we have a slot for this iteration
                        while len(self.evaluation_results) <= iteration:
                            self.evaluation_results.append("")
                            
                        # Store the evaluation result for this iteration
                        self.evaluation_results[iteration] = event.content
                    
                    # We only care about the final content chunks
                    if event.event_type == StreamEventType.CONTENT_CHUNK and event.metadata.get("is_final_response", False):
                        if self.final_response is None:
                            self.final_response = ""
                            print("Started capturing final response")
                        self.final_response += event.content
                    
                    # Collect token usage from metadata
                    if event.event_type == StreamEventType.METADATA and "usage" in event.metadata:
                        self.input_tokens = event.metadata["usage"].get("input_tokens", 0)
                        self.output_tokens = event.metadata["usage"].get("output_tokens", 0)
                        print(f"Token usage: input={self.input_tokens}, output={self.output_tokens}")
                
                async def close(self):
                    print("FinalResponseCapture closed")
                    pass
                
                def get_response(self):
                    pass
            
            # Create transport
            transport = FinalResponseCapture()
            
            # Create service
            service = ParallelChatService(
                llm_provider=anthropic_provider,
                decomposer=decomposer,
                evaluator=evaluator,
                synthesizer=synthesizer,
                transport=transport,
                max_parallel_tasks=4,  # Configurable
                max_rebranch_iterations=3  # Maximum number of recursive rebranching iterations
            )
            
            # Process query and wait for it to complete
            await service.process_query([
                {"role": msg.get("role"), "content": msg.get("content")} for msg in messages
            ])
            
            # Return the captured final response with thinking and branches
            if transport.final_response:
                print(f"Final response captured in non-streaming mode: {transport.final_response[:100]}...")
                
                # Create response with separate thinking and branches sections
                content_items = []
                
                # Get thinking content for the initial step
                initial_thinking = "Processing query..." 
                if transport.decomposition_result:
                    initial_thinking = transport.decomposition_result
                
                # Add initial thinking item
                content_items.append({
                    "type": "thinking",
                    "thinking": initial_thinking,
                    "signature": "zbbJhbGciOiJFU8zI1NiIsImtakcjsu38219c0.eyJoYXNoIjoiYWJjMTIzIiwiaWFxxxjoxNjE0NTM0NTY3fQ...."
                })
                
                # Group tasks by iteration
                tasks_by_iteration = {}
                for task in transport.task_contents:
                    iteration = task.get("iteration", 0)
                    if iteration not in tasks_by_iteration:
                        tasks_by_iteration[iteration] = []
                    tasks_by_iteration[iteration].append({
                        "content": task["content"],
                        "subject": task["subject"],
                        "index": task["index"]
                    })
                
                # Add a branches item for each iteration
                for iteration in sorted(tasks_by_iteration.keys()):
                    iteration_branches = tasks_by_iteration[iteration]
                    
                    # Add branches item for this iteration
                    content_items.append({
                        "type": "branches",
                        "branches": iteration_branches
                    })
                    
                    # If there are evaluation results for this iteration, add them as thinking
                    if iteration < len(transport.evaluation_results):
                        content_items.append({
                            "type": "thinking",
                            "thinking": transport.evaluation_results[iteration],
                            "signature": "zbbJhbGciOiJFU8zI1NiIsImtakcjsu38219c0.eyJoYXNoIjoiYWJjMTIzIiwiaWFxxxjoxNjE0NTM0NTY3fQ...."
                        })
                
                # If no tasks were captured, add a dummy branches item
                if len(tasks_by_iteration) == 0:
                    content_items.append({
                        "type": "branches",
                        "branches": [{"content": "Task 1 analysis"}, {"content": "Task 2 analysis"}]
                    })
                
                # Add the text (final response) item
                content_items.append({
                    "type": "text", 
                    "text": transport.final_response
                })
                
                print(f"Returning response with {len(content_items)} content items, including multiple iterations of thinking/branches")
                for i, item in enumerate(content_items):
                    if item.get("type") == "branches":
                        print(f"  content[{i}]: type=branches, count={len(item.get('branches', []))}")
                    else:
                        print(f"  content[{i}]: type={item.get('type')}")
                
                # Create the final response with the proper content array
                return JSONResponse(
                    content={
                        "id": generate_id(),
                        "type": "message",
                        "role": "assistant",
                        "content": content_items,
                        "model": model,
                        "stop_reason": "end_turn",
                        "usage": {
                            "input_tokens": transport.input_tokens,
                            "output_tokens": transport.output_tokens
                        }
                    },
                    headers={"Access-Control-Allow-Origin": "*"}
                )
            else:
                # Fallback if no response was captured
                return JSONResponse(
                    status_code=500,
                    content={"error": "No response was generated"},
                    headers={"Access-Control-Allow-Origin": "*"}
                )
        except Exception as e:
            print(f"Error in non-streaming completion: {str(e)}")
            return JSONResponse(
                status_code=500,
                content={"error": f"Error processing request: {str(e)}"},
                headers={"Access-Control-Allow-Origin": "*"}
            )
    
    # For streaming, create an SSE response
    try:
        # Create transport adapter for SSE
        transport = SSEAdapter()
        
        # Create service
        service = ParallelChatService(
            llm_provider=anthropic_provider,
            decomposer=decomposer,
            evaluator=evaluator,
            synthesizer=synthesizer,
            transport=transport,
            max_parallel_tasks=4,  # Configurable
            max_rebranch_iterations=3  # Maximum number of recursive rebranching iterations
        )
        
        # Process query asynchronously (will send events to the transport)
        asyncio.create_task(service.process_query([
            {"role": msg.get("role"), "content": msg.get("content")} for msg in messages
        ]))
        
        # Return streaming response with CORS headers
        response = transport.get_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    
    except Exception as e:
        print(f"Error in streaming endpoint: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Error processing streaming request: {str(e)}"},
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    """Legacy WebSocket endpoint for backward compatibility with existing clients"""
    await websocket.accept()
    print("WebSocket connection accepted")

    try:
        # Process messages until client disconnects
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            print(f"Received data: {data[:100]}...")  # Log first 100 chars
            request_data = json.loads(data)

            if "messages" not in request_data:
                print("Error: 'messages' field not found in request")
                await websocket.send_json({
                    "type": "error",
                    "error": "Invalid request format. 'messages' field is required."
                })
                continue

            # Create transport adapter
            transport = WebSocketAdapter(websocket)
            
            # Create service
            service = ParallelChatService(
                llm_provider=anthropic_provider,
                decomposer=decomposer,
                evaluator=evaluator,
                synthesizer=synthesizer,
                transport=transport,
                max_parallel_tasks=4,  # Configurable
                max_rebranch_iterations=3  # Maximum number of recursive rebranching iterations
            )
            
            # Process the query (will send events through the WebSocket)
            await service.process_query(request_data["messages"])
    
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        error_msg = f"WebSocket error: {str(e)}"
        print(error_msg)
        try:
            await websocket.send_json({"type": "error", "error": error_msg})
        except:
            print("Failed to send error response")
