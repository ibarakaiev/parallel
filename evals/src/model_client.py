import time
import httpx
from datetime import datetime
from .types import ModelResponse

class ModelClient:
    def __init__(self, branchial_endpoint: str = 'http://localhost:4000/v1/messages', anthropic_api_key: str = None):
        self.branchial_endpoint = branchial_endpoint
        self.anthropic_api_key = anthropic_api_key
        self.client = httpx.AsyncClient()

    async def query_branchial_model(self, question: str) -> ModelResponse:
        start_time = time.time()
        
        response = await self.client.post(
            self.branchial_endpoint,
            json={"messages": [{"role": "user", "content": question}]}
        )
        data = response.json()
        
        return ModelResponse(
            model_id="Model A",
            response=data["response"],
            latency=(time.time() - start_time) * 1000,  # Convert to ms
            timestamp=datetime.now()
        )

    async def query_anthropic_model(self, question: str) -> ModelResponse:
        start_time = time.time()
        
        response = await self.client.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': self.anthropic_api_key,
                'anthropic-version': '2023-06-01'
            },
            json={
                'model': 'claude-3-haiku-20240307',
                'messages': [{'role': 'user', 'content': question}]
            }
        )
        data = response.json()
        
        return ModelResponse(
            model_id="Model B",
            response=data["content"][0]["text"],
            latency=(time.time() - start_time) * 1000,  # Convert to ms
            timestamp=datetime.now()
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose() 