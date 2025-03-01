import asyncio
from datetime import datetime
from .types import EvalSession, EvalSummary
from .questions import eval_questions
from .model_client import ModelClient
from .evaluator import ResponseEvaluator

class EvalRunner:
    def __init__(self, model_client: ModelClient, evaluator: ResponseEvaluator):
        self.model_client = model_client
        self.evaluator = evaluator

    async def run_evaluation(self) -> EvalSession:
        session = EvalSession(
            id=str(int(datetime.now().timestamp())),
            timestamp=datetime.now(),
            results=[],
            summary=EvalSummary(
                total_questions=0,
                model_a_better_count=0,
                model_b_better_count=0,
                tie_count=0,
                model_a_faster_count=0,
                model_b_faster_count=0,
                average_latency_a=0,
                average_latency_b=0
            )
        )

        for question in eval_questions:
            # Query both models in parallel
            response_a, response_b = await asyncio.gather(
                self.model_client.query_branchial_model(question.question),
                self.model_client.query_anthropic_model(question.question)
            )

            # Evaluate responses
            result = await self.evaluator.evaluate_responses(question, response_a, response_b)
            session.results.append(result)

        # Calculate summary statistics
        self._calculate_summary(session)
        return session

    def _calculate_summary(self, session: EvalSession) -> None:
        results = session.results
        session.summary.total_questions = len(results)
        
        total_latency_a = 0
        total_latency_b = 0
        
        for result in results:
            # Count better responses
            if result.better_response_model_id == "Model A":
                session.summary.model_a_better_count += 1
            elif result.better_response_model_id == "Model B":
                session.summary.model_b_better_count += 1
            else:
                session.summary.tie_count += 1
            
            # Count faster responses
            if result.faster_response_model_id == "Model A":
                session.summary.model_a_faster_count += 1
            else:
                session.summary.model_b_faster_count += 1
            
            # Sum latencies
            response_a = next(r for r in result.responses if r.model_id == "Model A")
            response_b = next(r for r in result.responses if r.model_id == "Model B")
            total_latency_a += response_a.latency
            total_latency_b += response_b.latency
        
        session.summary.average_latency_a = total_latency_a / len(results)
        session.summary.average_latency_b = total_latency_b / len(results) 