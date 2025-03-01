import os
import json
import asyncio
import aiohttp
import re
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any, Union, Tuple
import anthropic
from app.prompts import MASTER_DECOMPOSITION_PROMPT

# Get API key from environment (already loaded by direnv)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# Maximum number of concurrent chats
MAX_CONCURRENT_CHATS = 5  # Increased to accommodate more parallel tasks


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
    task_subject: str = None,
):
    """Make a direct streaming request to Anthropic API using aiohttp."""
    try:
        api_url = "https://api.anthropic.com/v1/messages"

        # Send stream_start event with subject information
        await websocket.send_json({
            "type": "stream_start", 
            "chat_id": chat_id, 
            "subject": task_subject
        })

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

        # Send stream end event with subject
        await websocket.send_json({
            "type": "stream_end", 
            "chat_id": chat_id, 
            "content": full_response,
            "subject": task_subject
        })

        print(f"Chat {chat_id}: Stream complete, sent {chunk_count} chunks")
        return True

    except Exception as e:
        error_msg = f"Chat {chat_id}: Streaming error: {str(e)}"
        print(error_msg)
        await websocket.send_json(
            {"type": "error", "chat_id": chat_id, "error": error_msg}
        )
        return False


async def decompose_query(user_query: str, session: aiohttp.ClientSession) -> Tuple[List[str], List[str], int]:
    """
    Use an LLM to decompose the user query into multiple research tasks.
    
    Returns:
        Tuple containing:
            - task_subjects: List of subjects for each task
            - task_prompts: List of complete prompts for each task
            - count: Number of parallel tasks to run
    """
    try:
        # Send a special thinking message to the client
        print(f"Decomposing query: {user_query[:50]}...")
        
        # Format the master prompt with the user's query
        decomposition_prompt = MASTER_DECOMPOSITION_PROMPT.format(user_query=user_query)
        
        # Call Claude API for decomposition
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=4000,
            messages=[{"role": "user", "content": decomposition_prompt}],
        )
        
        # Extract response text
        decomposition_result = response.content[0].text
        print(f"Decomposition result received: {len(decomposition_result)} chars")
        
        # Parse the decomposition result
        decomposition_summary = re.search(r'DECOMPOSITION_SUMMARY:(.*?)(?:PARALLEL_TASKS_COUNT:|$)', decomposition_result, re.DOTALL)
        tasks_count = re.search(r'PARALLEL_TASKS_COUNT:\s*(\d+)', decomposition_result)
        task_type = re.search(r'TASK_TYPE:\s*([A-Za-z\s]+)', decomposition_result)
        
        if not (decomposition_summary and tasks_count):
            print("Failed to parse decomposition result, using default")
            return [user_query], [user_query], 1
        
        count = int(tasks_count.group(1))
        count = min(count, MAX_CONCURRENT_CHATS)  # Ensure we don't exceed max
        
        # Get each task subject and prompt
        task_subjects = []
        task_prompts = []
        
        for i in range(1, count + 1):
            subject_pattern = f'TASK_{i}_SUBJECT:(.*?)(?:TASK_{i}_PROMPT:|$)'
            prompt_pattern = f'TASK_{i}_PROMPT:(.*?)(?:TASK_{i+1}_SUBJECT:|SYNTHESIS_RECOMMENDATION:|$)'
            
            subject_match = re.search(subject_pattern, decomposition_result, re.DOTALL)
            prompt_match = re.search(prompt_pattern, decomposition_result, re.DOTALL)
            
            if subject_match and prompt_match:
                subject = subject_match.group(1).strip()
                prompt = prompt_match.group(1).strip()
                
                task_subjects.append(subject)
                task_prompts.append(prompt)
        
        # If we failed to get the right number of tasks, fall back to simpler approach
        if len(task_subjects) != count or len(task_prompts) != count:
            print(f"Parsed {len(task_subjects)} subjects and {len(task_prompts)} prompts but expected {count}, using default")
            return [user_query], [user_query], 1
        
        # Log the tasks
        for i, (subject, prompt) in enumerate(zip(task_subjects, task_prompts)):
            print(f"Task {i+1}: {subject} - Prompt length: {len(prompt)} chars")
            
        return task_subjects, task_prompts, count
        
    except Exception as e:
        print(f"Error in decomposition: {str(e)}")
        # Fall back to using the original query
        return [user_query], [user_query], 1


async def process_single_chat(
    websocket: WebSocket,
    chat_id: int,
    anthropic_messages: List[Dict[str, str]],
    session: aiohttp.ClientSession,
    task_subject: str = None,
    task_prompt: str = None
):
    """Process a single chat stream using a dedicated session."""
    try:
        print(f"Chat {chat_id}: Processing using dedicated connection for task: {task_subject or 'Default'}")
        
        # Create a copy of the messages to avoid modifying the original
        messages_copy = anthropic_messages.copy()
        
        # If we have a task prompt, replace the last user message with the task prompt
        if task_prompt and messages_copy:
            for i in range(len(messages_copy) - 1, -1, -1):
                if messages_copy[i]["role"] == "user":
                    # Replace the content with the specific task prompt
                    messages_copy[i]["content"] = task_prompt
                    break

        # Stream using direct API call with our session
        success = await anthropic_stream_request(
            websocket, chat_id, messages_copy, session, task_subject
        )

        if not success:
            # Fallback to the old method
            print(f"Chat {chat_id}: Direct streaming failed, falling back to SDK")

            # Generate a normal response using the SDK as fallback
            response = client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1024,
                messages=messages_copy,
            )

            # Extract response text
            full_response = response.content[0].text

            # Send the full response at once with subject
            await websocket.send_json({
                "type": "stream_end", 
                "chat_id": chat_id, 
                "content": full_response,
                "subject": task_subject if task_subject else None
            })

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

            # Convert client messages format to Anthropic's format
            anthropic_messages = []
            for msg in request_data["messages"]:
                anthropic_messages.append(
                    {"role": msg["role"], "content": msg["content"]}
                )
                
            # Get the user's query from the last user message
            user_query = ""
            for msg in reversed(anthropic_messages):
                if msg["role"] == "user":
                    user_query = msg["content"]
                    break
                    
            if not user_query:
                await websocket.send_json(
                    {"type": "error", "error": "No user query found in messages."}
                )
                continue

            try:
                # Send "thinking" message to client
                await websocket.send_json(
                    {"type": "decomposition_start", "message": "Decomposing query..."}
                )
                
                # Create a new aiohttp session for this batch
                async with await get_aiohttp_session() as session:
                    # Call Claude to decompose the query into parallel tasks
                    task_subjects, task_prompts, count = await decompose_query(user_query, session)
                    
                    print(f"Decomposed into {count} tasks")
                    
                    # Include task subjects as part of UI message
                    await websocket.send_json({
                        "type": "batch_start", 
                        "count": count,
                        "subjects": task_subjects
                    })
                    
                    # Start all streams in parallel with their own connections
                    streams = []
                    for i in range(count):
                        chat_id = i
                        # Get the specific task information for this chat
                        subject = task_subjects[i] if i < len(task_subjects) else None
                        prompt = task_prompts[i] if i < len(task_prompts) else None
                        
                        # Create an independent task for each stream
                        stream = asyncio.create_task(
                            process_single_chat(
                                websocket, 
                                chat_id, 
                                anthropic_messages.copy(),  # Important to copy to avoid cross-contamination
                                session,
                                subject,
                                prompt
                            )
                        )
                        streams.append(stream)

                    # Run all streams truly in parallel
                    await asyncio.gather(*streams)

                print(f"All {count} chat streams completed in parallel")

                # Send a final completion message when all batches are done
                await websocket.send_json({"type": "all_complete", "total": count})

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
