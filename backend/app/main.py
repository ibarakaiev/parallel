import os
import json
import asyncio
from fastapi import (
    FastAPI,
    Request,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union

from app.core.api import AnthropicProvider, TaskDecomposer, SynthesisGenerator
from app.core.stream import StreamEvent, StreamEventType, generate_id
from app.transport.websocket import WebSocketAdapter
from app.transport.sse import SSEAdapter
from app.services.parallel_chat import ParallelChatService
from app.prompts import MASTER_DECOMPOSITION_PROMPT, SYNTHESIS_PROMPT

# Get API key from environment
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

# Create core service components
anthropic_provider = AnthropicProvider(api_key=ANTHROPIC_API_KEY)
decomposer = TaskDecomposer(
    llm_provider=anthropic_provider, prompt_template=MASTER_DECOMPOSITION_PROMPT
)
synthesizer = SynthesisGenerator(
    llm_provider=anthropic_provider, prompt_template=SYNTHESIS_PROMPT
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
            },
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
                headers={"Access-Control-Allow-Origin": "*"},
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

    # If not streaming, use synchronous completion
    if not stream:
        try:
            # Convert our messages format to Anthropic's format
            anthropic_messages = [
                {"role": msg.get("role"), "content": msg.get("content")}
                for msg in messages
            ]

            # Call Anthropic API
            result = await anthropic_provider.generate_completion_sync(
                messages=anthropic_messages, max_tokens=max_tokens
            )

            # Format response to match Anthropic's API
            return JSONResponse(
                content={
                    "id": generate_id(),
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": result["content"]}],
                    "model": model,
                    "stop_reason": "end_turn",
                    "usage": {
                        "input_tokens": result["input_tokens"],
                        "output_tokens": result["output_tokens"],
                    },
                },
                headers={"Access-Control-Allow-Origin": "*"},
            )
        except Exception as e:
            print(f"Error in non-streaming completion: {str(e)}")
            return JSONResponse(
                status_code=500,
                content={"error": f"Error processing request: {str(e)}"},
                headers={"Access-Control-Allow-Origin": "*"},
            )

    # For streaming, create an SSE response
    try:
        # Create transport adapter for SSE
        transport = SSEAdapter()

        # Create service
        service = ParallelChatService(
            llm_provider=anthropic_provider,
            decomposer=decomposer,
            synthesizer=synthesizer,
            transport=transport,
            max_parallel_tasks=4,  # Configurable
        )

        # Process query asynchronously (will send events to the transport)
        asyncio.create_task(
            service.process_query(
                [
                    {"role": msg.get("role"), "content": msg.get("content")}
                    for msg in messages
                ]
            )
        )

        # Return streaming response with CORS headers
        response = transport.get_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    except Exception as e:
        print(f"Error in streaming endpoint: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Error processing streaming request: {str(e)}"},
            headers={"Access-Control-Allow-Origin": "*"},
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
                await websocket.send_json(
                    {
                        "type": "error",
                        "error": "Invalid request format. 'messages' field is required.",
                    }
                )
                continue

            # Create transport adapter
            transport = WebSocketAdapter(websocket)

            # Create service
            service = ParallelChatService(
                llm_provider=anthropic_provider,
                decomposer=decomposer,
                synthesizer=synthesizer,
                transport=transport,
                max_parallel_tasks=4,  # Configurable
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
