import asyncio
from datetime import datetime
from .types import EvalSession, EvalSummary
from .questions import eval_questions
from .model_client import ModelClient
from .evaluator import ResponseEvaluator
from pydantic import BaseModel

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
                # Initialize scoring metrics with 0
                model_a_avg_comprehensiveness=0.0,
                model_b_avg_comprehensiveness=0.0,
                model_a_avg_practical=0.0,
                model_b_avg_practical=0.0,
                model_a_avg_clarity=0.0,
                model_b_avg_clarity=0.0,
                model_a_avg_structure=0.0,
                model_b_avg_structure=0.0,
                model_a_avg_total=0.0,
                model_b_avg_total=0.0,
                # Initialize overall scores
                overall_winner="",
                model_a_total_score=0.0,
                model_b_total_score=0.0,
                # Initialize performance metrics
                model_a_faster_count=0,
                model_b_faster_count=0,
                average_latency_a=0.0,
                average_latency_b=0.0,
                # Initialize token usage
                total_model_a_input_tokens=0,
                total_model_a_output_tokens=0,
                total_model_b_input_tokens=0,
                total_model_b_output_tokens=0
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
        
        # Initialize scoring totals
        total_a_comprehensiveness = 0
        total_b_comprehensiveness = 0
        total_a_practical = 0
        total_b_practical = 0
        total_a_clarity = 0
        total_b_clarity = 0
        total_a_structure = 0
        total_b_structure = 0
        total_a_score = 0
        total_b_score = 0
        
        for result in results:
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
            
            # Sum scores
            total_a_comprehensiveness += result.model_a_scores.comprehensiveness
            total_b_comprehensiveness += result.model_b_scores.comprehensiveness
            total_a_practical += result.model_a_scores.practical_applicability
            total_b_practical += result.model_b_scores.practical_applicability
            total_a_clarity += result.model_a_scores.clarity
            total_b_clarity += result.model_b_scores.clarity
            total_a_structure += result.model_a_scores.structure
            total_b_structure += result.model_b_scores.structure
            total_a_score += result.model_a_scores.total_score
            total_b_score += result.model_b_scores.total_score
            
            # Calculate token totals
            session.summary.total_model_a_input_tokens += result.model_a_tokens["input_tokens"]
            session.summary.total_model_a_output_tokens += result.model_a_tokens["output_tokens"]
            session.summary.total_model_b_input_tokens += result.model_b_tokens["input_tokens"]
            session.summary.total_model_b_output_tokens += result.model_b_tokens["output_tokens"]
        
        # Calculate averages and totals
        num_results = len(results)
        
        # Calculate averages
        session.summary.model_a_avg_comprehensiveness = total_a_comprehensiveness / num_results
        session.summary.model_b_avg_comprehensiveness = total_b_comprehensiveness / num_results
        session.summary.model_a_avg_practical = total_a_practical / num_results
        session.summary.model_b_avg_practical = total_b_practical / num_results
        session.summary.model_a_avg_clarity = total_a_clarity / num_results
        session.summary.model_b_avg_clarity = total_b_clarity / num_results
        session.summary.model_a_avg_structure = total_a_structure / num_results
        session.summary.model_b_avg_structure = total_b_structure / num_results
        session.summary.model_a_avg_total = total_a_score / num_results
        session.summary.model_b_avg_total = total_b_score / num_results
        
        # Calculate total scores
        session.summary.model_a_total_score = total_a_score
        session.summary.model_b_total_score = total_b_score
        
        # Determine overall winner
        session.summary.overall_winner = (
            "Model A" if total_a_score > total_b_score else "Model B"
        )
        
        # Performance metrics
        session.summary.average_latency_a = total_latency_a / num_results
        session.summary.average_latency_b = total_latency_b / num_results 