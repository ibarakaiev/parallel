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

    async def query_branchial_model(self, question: str) -> ModelResponse:
        start_time = time.time()
        
        try:
            response = await self.client.post(
                self.fastapi_url,
                json={"message": question}
            )
            data = response.json()
            
            return ModelResponse(
                model_id="Model A",
                response=data.get("response", "No response"),
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage=data.get("usage", {})
            )
        except Exception as e:
            print(f"Error in FastAPI request: {str(e)}")
            return ModelResponse(
                model_id="Model A",
                response="Error: Request failed",
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage={"input_tokens": 0, "output_tokens": 0}
            )

    async def query_anthropic_model(self, question: str) -> ModelResponse:
        start_time = time.time()
        
        try:
            response = await self.anthropic_client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=1024,
                temperature=0.7,
                messages=[{"role": "user", "content": question}]
            )
            
            return ModelResponse(
                model_id="Model B",
                response=response.content[0].text,
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage={
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens
                }
            )
        except Exception as e:
            print(f"Error in Anthropic request: {str(e)}")
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
        await self.client.aclose() 