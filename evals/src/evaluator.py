from .types import EvalQuestion, ModelResponse, EvalResult

class ResponseEvaluator:
    def _evaluate_clarity(self, response: str) -> int:
        """Evaluate response clarity and structure"""
        score = 60  # Base score
        
        # Structure scoring
        has_sections = bool(response.count('\n\n') > 2)
        has_bullets = bool(response.count('- ') > 2 or response.count('• ') > 2)
        has_numbering = bool(response.count('. ') > 2)
        has_headers = bool(response.count(':') > 2)
        
        if has_sections: score += 10
        if has_bullets or has_numbering: score += 10
        if has_headers: score += 10
        
        # Length and detail scoring
        words = len(response.split())
        if 100 <= words <= 500: score += 10  # Optimal length
        
        return min(score, 100)

    def _evaluate_reasoning_quality(self, response: str) -> int:
        """Evaluate depth and quality of reasoning"""
        score = 50  # Base score
        
        # Check for analytical elements
        has_comparisons = 'compared to' in response.lower() or 'versus' in response.lower()
        has_pros_cons = 'pros' in response.lower() and 'cons' in response.lower()
        has_examples = 'for example' in response.lower() or 'such as' in response.lower()
        has_considerations = 'consider' in response.lower() or 'factor' in response.lower()
        has_tradeoffs = 'tradeoff' in response.lower() or 'trade-off' in response.lower()
        has_analysis = 'analysis' in response.lower() or 'evaluate' in response.lower()
        
        if has_comparisons: score += 10
        if has_pros_cons: score += 10
        if has_examples: score += 10
        if has_considerations: score += 10
        if has_tradeoffs: score += 5
        if has_analysis: score += 5
        
        return min(score, 100)

    def _evaluate_practicality(self, response: str) -> int:
        """Evaluate practicality and actionability"""
        score = 50  # Base score
        
        # Check for practical elements
        has_steps = any(f"{i}." in response for i in range(1, 6))
        has_metrics = any(word in response.lower() for word in ['cost', 'time', 'roi', 'budget', 'metrics'])
        has_implementation = any(word in response.lower() for word in ['implement', 'execute', 'start', 'begin', 'plan'])
        has_risks = any(word in response.lower() for word in ['risk', 'challenge', 'limitation', 'constraint'])
        has_timeline = any(word in response.lower() for word in ['timeline', 'schedule', 'phase', 'period'])
        has_resources = any(word in response.lower() for word in ['resource', 'team', 'staff', 'personnel'])
        
        if has_steps: score += 10
        if has_metrics: score += 10
        if has_implementation: score += 10
        if has_risks: score += 10
        if has_timeline: score += 5
        if has_resources: score += 5
        
        return min(score, 100)

    async def evaluate_responses(
        self,
        question: EvalQuestion,
        response_a: ModelResponse,
        response_b: ModelResponse
    ) -> EvalResult:
        # Score each response
        scores_a = {
            'clarity': self._evaluate_clarity(response_a.response),
            'reasoning': self._evaluate_reasoning_quality(response_a.response),
            'practicality': self._evaluate_practicality(response_a.response)
        }
        
        scores_b = {
            'clarity': self._evaluate_clarity(response_b.response),
            'reasoning': self._evaluate_reasoning_quality(response_b.response),
            'practicality': self._evaluate_practicality(response_b.response)
        }

        # Calculate total scores
        total_a = sum(scores_a.values()) / len(scores_a)
        total_b = sum(scores_b.values()) / len(scores_b)

        # Determine winner with a minimum margin
        margin = 5  # Minimum difference to declare a winner
        if total_a > total_b + margin:
            better_model = "Model A"
        elif total_b > total_a + margin:
            better_model = "Model B"
        else:
            better_model = None  # Tie

        # Generate detailed evaluation reasoning
        evaluation = f"""
Evaluation Scores:

Model A (FastAPI/Sonnet):
- Clarity & Structure: {scores_a['clarity']}/100
- Reasoning Quality: {scores_a['reasoning']}/100
- Practicality: {scores_a['practicality']}/100
Total Score: {total_a:.1f}/100

Model B (Claude 3 Sonnet):
- Clarity & Structure: {scores_b['clarity']}/100
- Reasoning Quality: {scores_b['reasoning']}/100
- Practicality: {scores_b['practicality']}/100
Total Score: {total_b:.1f}/100

Analysis:
- Structure: {self._compare_aspect('Structure', scores_a['clarity'], scores_b['clarity'])}
- Reasoning: {self._compare_aspect('Reasoning', scores_a['reasoning'], scores_b['reasoning'])}
- Practicality: {self._compare_aspect('Practicality', scores_a['practicality'], scores_b['practicality'])}

Winner: {better_model or 'Tie'} {'(margin: ' + f'{abs(total_a - total_b):.1f}%)' if better_model else ''}
"""

        return EvalResult(
            question_id=question.id,
            question=question,
            responses=[response_a, response_b],
            better_response_model_id=better_model,
            faster_response_model_id="Model A" if response_a.latency < response_b.latency else "Model B",
            evaluator_reasoning=evaluation
        )

    def _compare_aspect(self, aspect: str, score_a: float, score_b: float) -> str:
        diff = score_a - score_b
        if abs(diff) < 5:
            return f"Both models showed similar {aspect.lower()} ({score_a:.1f} vs {score_b:.1f})"
        elif diff > 0:
            return f"Model A showed stronger {aspect.lower()} ({score_a:.1f} vs {score_b:.1f})"
        else:
            return f"Model B showed stronger {aspect.lower()} ({score_b:.1f} vs {score_a:.1f})"

    def _format_scores(self, scores: dict) -> str:
        """Format criterion scores into a readable string"""
        return "\n".join([f"- {criterion}: {score}/100" for criterion, score in scores.items()]) 