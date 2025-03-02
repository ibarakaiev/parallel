import asyncio
import os
from dotenv import load_dotenv
from evals.src.model_client import ModelClient
from evals.src.evaluator import ResponseEvaluator
from evals.src.runner import EvalRunner
import json

async def main():
    load_dotenv()
    
    # Initialize clients
    model_client = ModelClient(
        fastapi_endpoint='http://localhost:8000/chat',  # Your FastAPI endpoint
        anthropic_api_key=os.getenv('ANTHROPIC_API_KEY')
    )
    
    evaluator = ResponseEvaluator(model_client)
    runner = EvalRunner(model_client, evaluator)
    
    # Run evaluation
    results = await runner.run_evaluation()
    
    # Print or save results
    print("\nEvaluation Results:")
    print(f"Total Questions: {results.summary.total_questions}")
    print(f"\nOverall Winner: {results.summary.overall_winner}")
    print(f"\nScoring Summary:")
    print(f"Model A (FastAPI) Total Score: {results.summary.model_a_total_score:.2f}")
    print(f"Model B (Haiku) Total Score: {results.summary.model_b_total_score:.2f}")
    
    print(f"\nDetailed Metrics:")
    print(f"Comprehensiveness - Model A: {results.summary.model_a_avg_comprehensiveness:.2f}/35, Model B: {results.summary.model_b_avg_comprehensiveness:.2f}/35")
    print(f"Practical - Model A: {results.summary.model_a_avg_practical:.2f}/35, Model B: {results.summary.model_b_avg_practical:.2f}/35")
    print(f"Clarity - Model A: {results.summary.model_a_avg_clarity:.2f}/20, Model B: {results.summary.model_b_avg_clarity:.2f}/20")
    print(f"Structure - Model A: {results.summary.model_a_avg_structure:.2f}/10, Model B: {results.summary.model_b_avg_structure:.2f}/10")
    
    print(f"\nPerformance Metrics:")
    print(f"Average Latency - Model A: {results.summary.average_latency_a:.2f}ms, Model B: {results.summary.average_latency_b:.2f}ms")
    print(f"Faster Responses - Model A: {results.summary.model_a_faster_count}, Model B: {results.summary.model_b_faster_count}")

    # Save results to file
    with open(f'eval_results_{results.id}.json', 'w') as f:
        json.dump(results.dict(), f, indent=2, default=str)

if __name__ == "__main__":
    asyncio.run(main()) 