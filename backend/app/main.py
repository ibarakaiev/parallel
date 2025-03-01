import os
import json
import asyncio
import aiohttp
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any, Union
import anthropic

# Get API key from environment (already loaded by direnv)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# Maximum number of concurrent chats
MAX_CONCURRENT_CHATS = 4


# Create a separate session for multiple concurrent connections
async def get_aiohttp_session():
    return aiohttp.ClientSession(
        headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01"},
        timeout=aiohttp.ClientTimeout(total=300),
    )


app = FastAPI()


# Remove all middleware and handle CORS manually
@app.middleware("http")
async def add_cors_headers(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


@app.options("/{path:path}")
async def options_route(request: Request, path: str):
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
        },
    )


# Define the message schema
class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


# Define the chat request schema
class ChatRequest(BaseModel):
    messages: List[Message] = Field(..., description="The conversation history")
    n: int = Field(1, description="Number of parallel chat completions to generate")


@app.get("/")
async def root():
    return {"message": "Welcome to the Parallel API"}


@app.post("/chat_completion")
async def chat_completion(request: ChatRequest):
    try:
        # Convert our messages format to Anthropic's format
        anthropic_messages = []
        for msg in request.messages:
            anthropic_messages.append({"role": msg.role, "content": msg.content})

        # Call Claude API
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1024,
            messages=anthropic_messages,
        )

        # Extract response text
        assistant_message = response.content[0].text

        # Return response with CORS headers
        return JSONResponse(
            content={"response": assistant_message},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        )
    except Exception as e:
        # Log the error (in a production environment, you'd want proper logging)
        print(f"Error calling Claude API: {str(e)}")
        # Return error response
        raise HTTPException(
            status_code=500, detail=f"Error processing request: {str(e)}"
        )


async def anthropic_stream_request(
    websocket: WebSocket,
    chat_id: int,
    messages: List[Dict[str, str]],
    session: aiohttp.ClientSession,
):
    """Make a direct streaming request to Anthropic API using aiohttp."""
    try:
        api_url = "https://api.anthropic.com/v1/messages"

        # Send stream_start event
        await websocket.send_json({"type": "stream_start", "chat_id": chat_id})

        # Prepare the request payload
        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": 1024,
            "messages": messages,
            "stream": True,
        }

        full_response = ""
        chunk_count = 0
        buffer = ""

        # Make the streaming request
        async with session.post(api_url, json=payload) as response:
            response.raise_for_status()
            async for line in response.content:
                line = line.decode("utf-8").strip()
                if not line:
                    continue

                if line.startswith("data: "):
                    data = line[6:]  # Strip 'data: ' prefix
                    if data == "[DONE]":
                        break

                    try:
                        event = json.loads(data)
                        if (
                            event.get("type") == "content_block_delta"
                            and "delta" in event
                        ):
                            text = event["delta"].get("text", "")
                            if text:
                                full_response += text
                                chunk_count += 1
                                # Send chunk to client
                                await websocket.send_json(
                                    {
                                        "type": "chunk",
                                        "chat_id": chat_id,
                                        "content": text,
                                    }
                                )
                    except json.JSONDecodeError:
                        print(f"Chat {chat_id}: Error parsing Anthropic stream: {data}")

        # Send stream end event
        await websocket.send_json(
            {"type": "stream_end", "chat_id": chat_id, "content": full_response}
        )

        print(f"Chat {chat_id}: Stream complete, sent {chunk_count} chunks")
        return True

    except Exception as e:
        error_msg = f"Chat {chat_id}: Streaming error: {str(e)}"
        print(error_msg)
        await websocket.send_json(
            {"type": "error", "chat_id": chat_id, "error": error_msg}
        )
        return False


async def process_single_chat(
    websocket: WebSocket,
    chat_id: int,
    anthropic_messages: List[Dict[str, str]],
    session: aiohttp.ClientSession,
):
    """Process a single chat stream using a dedicated session."""
    try:
        print(f"Chat {chat_id}: Processing using dedicated connection")

        # Stream using direct API call with our session
        success = await anthropic_stream_request(
            websocket, chat_id, anthropic_messages, session
        )

        if not success:
            # Fallback to the old method
            print(f"Chat {chat_id}: Direct streaming failed, falling back to SDK")

            # Generate a normal response using the SDK as fallback
            response = client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1024,
                messages=anthropic_messages,
            )

            # Extract response text
            full_response = response.content[0].text

            # Send the full response at once
            await websocket.send_json(
                {"type": "stream_end", "chat_id": chat_id, "content": full_response}
            )

    except Exception as e:
        error_msg = f"Chat {chat_id}: Error processing chat: {str(e)}"
        print(error_msg)
        await websocket.send_json(
            {"type": "error", "chat_id": chat_id, "error": error_msg}
        )


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection accepted")

    try:
        while True:
            # Receive the message from the client
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

            # Get number of parallel chats to generate (default to 1 if not specified)
            n = min(int(request_data.get("n", 1)), MAX_CONCURRENT_CHATS)
            print(
                f"Requested {n} parallel chats, max allowed is {MAX_CONCURRENT_CHATS}"
            )

            # Convert client messages format to Anthropic's format
            anthropic_messages = []
            for msg in request_data["messages"]:
                anthropic_messages.append(
                    {"role": msg["role"], "content": msg["content"]}
                )

            try:
                # Set up all the chat streams with separate connections to ensure true parallelism
                print(f"Setting up {n} parallel connections to Anthropic")

                # Send batch_start event to initialize all UI placeholders
                await websocket.send_json({"type": "batch_start", "count": n})

                # Create a new aiohttp session for this batch
                async with await get_aiohttp_session() as session:
                    # Start all streams in parallel with their own connections
                    streams = []
                    for i in range(n):
                        chat_id = i
                        # Create an independent session for each stream
                        stream = asyncio.create_task(
                            process_single_chat(
                                websocket, chat_id, anthropic_messages, session
                            )
                        )
                        streams.append(stream)

                    # Run all streams truly in parallel
                    await asyncio.gather(*streams)

                print(f"All {n} chat streams completed in parallel")

                # Send a final completion message when all batches are done
                await websocket.send_json({"type": "all_complete", "total": n})

            except Exception as e:
                error_msg = f"Error processing parallel chats: {str(e)}"
                print(error_msg)
                await websocket.send_json({"type": "error", "error": error_msg})

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        error_msg = f"WebSocket error: {str(e)}"
        print(error_msg)
        try:
            await websocket.send_json({"type": "error", "error": error_msg})
        except:
            print("Failed to send error response")
            pass
