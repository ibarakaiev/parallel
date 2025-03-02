import time
import httpx
from datetime import datetime
from .types import ModelResponse

class ModelClient:
    def __init__(self, fastapi_endpoint: str = 'http://localhost:4000/chat', anthropic_api_key: str = None):
        self.fastapi_endpoint = fastapi_endpoint
        self.anthropic_api_key = anthropic_api_key
        self.client = httpx.AsyncClient(timeout=30.0)

    async def query_branchial_model(self, question: str) -> ModelResponse:
        start_time = time.time()
        
        try:
            response = await self.client.post(
                self.fastapi_endpoint,
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
            response = await self.client.post(
                'https://api.anthropic.com/v1/messages',
                headers={
                    'x-api-key': self.anthropic_api_key,
                    'anthropic-version': '2023-06-01'
                },
                json={
                    'model': 'claude-3-haiku-20240307',
                    'max_tokens': 1024,
                    'messages': [{'role': 'user', 'content': question}]
                }
            )
            data = response.json()
            
            return ModelResponse(
                model_id="Model B",
                response=data.get("content", [{}])[0].get("text", "No response"),
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage=data.get("usage", {})
            )
        except Exception as e:
            print(f"Error in Anthropic request: {str(e)}")
            return ModelResponse(
                model_id="Model B",
                response="Error: Request failed",
                latency=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                usage={"input_tokens": 0, "output_tokens": 0}
            )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose() 