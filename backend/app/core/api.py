import os
import json
import aiohttp
import asyncio
from abc import ABC, abstractmethod
from typing import Dict, List, Any, AsyncIterator, Optional, Tuple

import anthropic

class LLMProvider(ABC):
    """Abstract base class for LLM providers (Anthropic, OpenAI, etc.)"""
    
    @abstractmethod
    async def generate_completion(self, messages: List[Dict[str, Any]], 
                                 stream: bool = False, **kwargs) -> AsyncIterator[Dict[str, Any]]:
        """Generate completion from the LLM provider with streaming support"""
        pass
        
    @abstractmethod
    async def generate_completion_sync(self, messages: List[Dict[str, Any]], **kwargs) -> Dict[str, Any]:
        """Generate non-streaming completion from the LLM provider"""
        pass

class AnthropicProvider(LLMProvider):
    """Anthropic-specific implementation of LLMProvider"""
    
    def __init__(self, api_key: str, model: str = "claude-3-sonnett-20240307"):
        self.api_key = api_key
        self.model = model
        self.client = anthropic.Anthropic(api_key=api_key)
    
    async def generate_completion(self, messages: List[Dict[str, Any]], 
                                stream: bool = True, **kwargs) -> AsyncIterator[Dict[str, Any]]:
        """Implementation of streaming completion for Anthropic"""
        # Use aiohttp for direct API access with streaming
        async with aiohttp.ClientSession() as session:
            api_url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            payload = {
                "model": self.model,
                "max_tokens": kwargs.get("max_tokens", 1024),
                "messages": messages,
                "stream": True,
            }
            
            input_tokens = 0
            output_tokens = 0
            
            async with session.post(api_url, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for line in response.content:
                    line = line.decode("utf-8").strip()
                    if not line or not line.startswith("data: "):
                        continue
                    
                    data = line[6:]  # Strip 'data: ' prefix
                    if data == "[DONE]":
                        break
                    
                    try:
                        event = json.loads(data)
                        
                        # Extract token usage from message_start event
                        if event.get("type") == "message_start" and "message" in event:
                            if "usage" in event["message"]:
                                input_tokens = event["message"]["usage"].get("input_tokens", 0)
                        
                        # Extract token usage from message_delta event
                        if event.get("type") == "message_delta" and "usage" in event["delta"]:
                            output_tokens_delta = event["delta"]["usage"].get("output_tokens", 0)
                            if output_tokens_delta > output_tokens:
                                output_tokens = output_tokens_delta
                                
                        # Extract content delta
                        if event.get("type") == "content_block_delta" and "delta" in event:
                            text = event["delta"].get("text", "")
                            if text:
                                yield {
                                    "content": text,
                                    "input_tokens": input_tokens,
                                    "output_tokens": output_tokens
                                }
                                
                        # Handle message_stop event to capture final output tokens
                        if event.get("type") == "message_stop" and "usage" in event:
                            final_output_tokens = event["usage"].get("output_tokens", 0)
                            if final_output_tokens > output_tokens:
                                output_tokens = final_output_tokens
                                
                    except json.JSONDecodeError:
                        continue
            
            # Final yield to provide token usage
            yield {
                "content": "",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "final": True
            }
        
    async def generate_completion_sync(self, messages: List[Dict[str, Any]], **kwargs) -> Dict[str, Any]:
        """Implementation of non-streaming completion for Anthropic"""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=kwargs.get("max_tokens", 1024),
            messages=messages,
        )
        
        # Extract response text and token usage
        return {
            "content": response.content[0].text,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens
        }

class TaskDecomposer:
    """Handles decomposition of queries into parallel tasks"""
    
    def __init__(self, llm_provider: LLMProvider, prompt_template: str):
        self.llm_provider = llm_provider
        self.prompt_template = prompt_template
    
    async def decompose_query(self, query: str, max_tasks: int = 4) -> Dict[str, Any]:
        """Decompose a query into multiple parallel tasks"""
        # Format the prompt with the user's query
        decomposition_prompt = self.prompt_template.format(user_query=query)
        
        # Call LLM for decomposition
        response = await self.llm_provider.generate_completion_sync([
            {"role": "user", "content": decomposition_prompt}
        ])
        
        decomposition_result = response["content"]
        
        # Extract token usage
        input_tokens = response.get("input_tokens", 0)
        output_tokens = response.get("output_tokens", 0)
        
        # Parse the decomposition result using regex
        import re
        decomposition_summary = re.search(r'DECOMPOSITION_SUMMARY:(.*?)(?:PARALLEL_TASKS_COUNT:|$)', decomposition_result, re.DOTALL)
        tasks_count = re.search(r'PARALLEL_TASKS_COUNT:\s*(\d+)', decomposition_result)
        
        if not (decomposition_summary and tasks_count):
            return {
                "tasks": [{"subject": "Default", "prompt": query}],
                "summary": "Unable to decompose query",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens
            }
        
        count = min(int(tasks_count.group(1)), max_tasks)  # Ensure we don't exceed max
        
        # Get each task subject and prompt
        tasks = []
        
        for i in range(1, count + 1):
            subject_pattern = f'TASK_{i}_SUBJECT:(.*?)(?:TASK_{i}_PROMPT:|$)'
            prompt_pattern = f'TASK_{i}_PROMPT:(.*?)(?:TASK_{i+1}_SUBJECT:|SYNTHESIS_RECOMMENDATION:|$)'
            
            subject_match = re.search(subject_pattern, decomposition_result, re.DOTALL)
            prompt_match = re.search(prompt_pattern, decomposition_result, re.DOTALL)
            
            if subject_match and prompt_match:
                subject = subject_match.group(1).strip()
                prompt = prompt_match.group(1).strip()
                
                tasks.append({"subject": subject, "prompt": prompt})
        
        # If we failed to get the right number of tasks, fall back to simpler approach
        if len(tasks) != count:
            return {
                "tasks": [{"subject": "Default", "prompt": query}],
                "summary": "Unable to properly decompose query",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens
            }
            
        return {
            "tasks": tasks,
            "summary": decomposition_summary.group(1).strip() if decomposition_summary else "",
            "input_tokens": input_tokens,
            "output_tokens": output_tokens
        }

class SynthesisGenerator:
    """Handles synthesis of parallel task results into a final response"""
    
    def __init__(self, llm_provider: LLMProvider, prompt_template: str):
        self.llm_provider = llm_provider
        self.prompt_template = prompt_template
    
    async def generate_synthesis(self, user_query: str, task_results: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
        """Generate a synthesized response from multiple task results with streaming"""
        # Format the synthesis prompt
        task_results_text = ""
        for i, result in enumerate(task_results):
            subject = result["subject"]
            content = result["content"]
            task_results_text += f"RESULT {i+1} - {subject}:\n{content}\n\n"
        
        synthesis_prompt = self.prompt_template.format(
            user_query=user_query,
            task_results=task_results_text
        )
        
        # Track token usage
        input_tokens = 0
        output_tokens = 0
        
        # Call LLM for synthesis with streaming
        async for chunk in self.llm_provider.generate_completion([
            {"role": "user", "content": synthesis_prompt}
        ], stream=True):
            # Track token usage
            if "input_tokens" in chunk:
                input_tokens = chunk["input_tokens"]
            if "output_tokens" in chunk:
                output_tokens = chunk["output_tokens"]
                
            # Pass along content with token usage
            if "content" in chunk:
                yield {
                    "content": chunk["content"],
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens
                }