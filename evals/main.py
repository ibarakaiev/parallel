import asyncio
import os
from datetime import datetime
from dotenv import load_dotenv
from anthropic import AsyncAnthropic
from .src.model_client import ModelClient
from .src.evaluator import ResponseEvaluator
from .src.runner import EvalRunner
from .src.question_generator import QuestionGenerator

load_dotenv()

async def main():
    # Initialize components
    anthropic_client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    question_generator = QuestionGenerator(anthropic_client)
    
    # Generate business questions
    print("Generating business questions...")
    questions = await question_generator.generate_business_questions(num_questions=10)
    
    # Initialize evaluation components
    model_client = ModelClient(
        fastapi_url=os.getenv("FASTAPI_ENDPOINT", "http://localhost:4000"),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")
    )
    evaluator = ResponseEvaluator()
    runner = EvalRunner(model_client, evaluator)
    
    # Run evaluation
    print("Running evaluation...")
    session = await runner.run_evaluation(questions)  # Modified to accept questions parameter
    
    # Print summary and save to CSV
    runner.print_summary(session)
    csv_file = runner.save_results_to_csv(session)
    print(f"\nResults saved to {csv_file}")
    runner.visualize_comparison(session)

if __name__ == "__main__":
    asyncio.run(main()) 