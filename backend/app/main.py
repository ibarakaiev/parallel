import os
import json
import asyncio
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any
import anthropic

# Get API key from environment (already loaded by direnv)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

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

            # Convert client messages format to Anthropic's format
            anthropic_messages = []
            for msg in request_data["messages"]:
                anthropic_messages.append(
                    {"role": msg["role"], "content": msg["content"]}
                )

            print(f"Processing {len(anthropic_messages)} messages")

            try:
                # First, send a stream_start event
                print("Sending stream_start event")
                await websocket.send_json({"type": "stream_start"})

                # First, attempt to use Anthropic's native streaming with text_stream
                try:
                    print("Attempting to use Anthropic native streaming with text_stream")
                    stream_success = False
                    full_response = ""
                    chunk_count = 0
                    
                    # Create a streaming response from Anthropic
                    with client.messages.stream(
                        model="claude-3-haiku-20240307",
                        max_tokens=1024,
                        messages=anthropic_messages
                    ) as stream:
                        # Access the text_stream directly as shown in the example
                        for text_chunk in stream.text_stream:
                            # Update full response
                            full_response += text_chunk
                            chunk_count += 1
                            
                            # Send the chunk to the client
                            print(f"Native streaming: Chunk #{chunk_count}: {text_chunk[:20]}...")
                            await websocket.send_json({
                                "type": "chunk",
                                "content": text_chunk
                            })
                            stream_success = True
                    
                    if stream_success:
                        print(f"Native streaming complete, sent {chunk_count} chunks")
                        await websocket.send_json({
                            "type": "stream_end",
                            "content": full_response
                        })
                        return  # Exit early since streaming worked
                    
                except Exception as streaming_error:
                    print(f"Native streaming failed, falling back to simulation: {streaming_error}")
                    # Continue to fallback method below
                
                # Fallback to manual chunking if Anthropic streaming fails
                print("Using manual streaming simulation as fallback")
                
                # Generate a normal response
                response = client.messages.create(
                    model="claude-3-haiku-20240307",  # Use the same model as in streaming
                    max_tokens=1024,
                    messages=anthropic_messages,
                )

                # Extract response text
                full_response = response.content[0].text
                print(f"Got response of length: {len(full_response)}")

                # Manually stream it in larger chunks with minimal delay
                chunk_size = 15  # Characters per chunk
                chunk_count = 0

                for i in range(0, len(full_response), chunk_size):
                    chunk = full_response[i : i + chunk_size]
                    chunk_count += 1

                    # Add a very minimal delay to simulate streaming
                    await asyncio.sleep(0.005)  # 5ms delay

                    # Send the chunk to the client
                    print(f"Sending chunk #{chunk_count}: {chunk}")
                    await websocket.send_json({"type": "chunk", "content": chunk})

                # Send a final message with the complete response
                print(f"Stream complete, sent {chunk_count} chunks")
                await websocket.send_json(
                    {"type": "stream_end", "content": full_response}
                )

            except Exception as e:
                error_msg = f"Error streaming response: {str(e)}"
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

