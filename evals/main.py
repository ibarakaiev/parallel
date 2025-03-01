import asyncio
import os
from dotenv import load_dotenv
from src.model_client import ModelClient
from src.evaluator import ResponseEvaluator
from src.runner import EvalRunner

async def main():
    load_dotenv()
    
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is required")

    async with ModelClient(
        branchial_endpoint='http://localhost:4000/v1/messages',
        anthropic_api_key=anthropic_api_key
    ) as model_client:
        evaluator = ResponseEvaluator()
        runner = EvalRunner(model_client, evaluator)
        
        results = await runner.run_evaluation()
        print(results.json(indent=2))

if __name__ == "__main__":
    asyncio.run(main()) 