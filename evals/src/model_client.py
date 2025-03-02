import time
import httpx
from datetime import datetime
from .types import ModelResponse
from anthropic import AsyncAnthropic
import logging

logger = logging.getLogger(__name__)

class ModelClient:
    def __init__(self, fastapi_url: str, anthropic_api_key: str):
        self.fastapi_url = fastapi_url
        self.anthropic_client = AsyncAnthropic(api_key=anthropic_api_key)

    async def query_branchial_model(self, message: str) -> ModelResponse:
        start_time = time.time()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.fastapi_url}/v1/messages",
                json={"message": message},
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
        
        latency = (time.time() - start_time) * 1000  # Convert to ms
        
        # Extract token usage from response
        usage = {
            'total_tokens': data.get('usage', {}).get('input_tokens', 0) + 
                           data.get('usage', {}).get('output_tokens', 0),
            'input_tokens': data.get('usage', {}).get('input_tokens', 0),
            'output_tokens': data.get('usage', {}).get('output_tokens', 0)
        }
        
        return ModelResponse(
            model_id="Model A",
            response=data["response"],
            latency=latency,
            timestamp=datetime.now(),
            usage=usage
        )

    async def query_anthropic_model(self, message: str) -> ModelResponse:
        start_time = time.time()
        
        try:
            response = await self.anthropic_client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=1024,
                temperature=0.7,
                messages=[{"role": "user", "content": message}]
            )
            
            response_text = response.content[0].text if response.content else ""
            latency = (time.time() - start_time) * 1000
            
            # Extract token usage
            usage = {
                'total_tokens': response.usage.input_tokens + response.usage.output_tokens,
                'input_tokens': response.usage.input_tokens,
                'output_tokens': response.usage.output_tokens
            }
            
            return ModelResponse(
                model_id="Model B",
                response=response_text,
                latency=latency,
                timestamp=datetime.now(),
                usage=usage
            )
            
        except Exception as e:
            logger.error(f"Error in Anthropic request: {str(e)}")
            return ModelResponse(
                model_id="Model B",
                response="Error: " + str(e),
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage={}
            )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass 