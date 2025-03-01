import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
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
        }
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
            anthropic_messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        # Call Claude API
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1024,
            messages=anthropic_messages
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
            }
        )
    except Exception as e:
        # Log the error (in a production environment, you'd want proper logging)
        print(f"Error calling Claude API: {str(e)}")
        # Return error response
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")