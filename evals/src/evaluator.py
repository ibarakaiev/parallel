from .types import EvalQuestion, ModelResponse, EvalResult, ResponseScores
from .model_client import ModelClient
from typing import Dict

class ResponseEvaluator:
    def __init__(self, model_client: ModelClient):
        self.model_client = model_client

    async def evaluate_responses(
        self,
        question: EvalQuestion,
        response_a: ModelResponse,
        response_b: ModelResponse
    ) -> EvalResult:
        evaluation_prompt = f"""You are an impartial expert evaluator tasked with comparing two AI responses to determine which one is more helpful and effective. Your evaluation must be thorough, objective, and based on specific criteria.

Question posed to both AIs:
{question.question}

Response A:
{response_a.response}

Response B:
{response_b.response}

Evaluation Criteria:
1. Comprehensiveness (35 points)
- Does the response address all key aspects of the question?
- Are important considerations and edge cases covered?

2. Practical Applicability (35 points)
- How actionable and implementable is the advice?
- Does it consider real-world constraints and feasibility?
- Are specific examples or steps provided?

3. Clarity of Communication (20 points)
- Is the response clear and easy to understand?
- Is information organized effectively?
- Is technical language used appropriately?

4. Structure (10 points)
- Is the response well-organized with clear sections?
- Are bullet points, numbering, or other formatting used effectively?
- Does the structure enhance readability?

Provide your evaluation in this exact format:

DETAILED ANALYSIS:
[Provide a thorough comparison of both responses across all criteria]

SCORING:
Response A:
- Comprehensiveness: [Score /35]
- Practical Applicability: [Score /35]
- Clarity: [Score /20]
- Structure: [Score /10]
Total Score A: [Sum /100]

Response B:
- Comprehensiveness: [Score /35]
- Practical Applicability: [Score /35]
- Clarity: [Score /20]
- Structure: [Score /10]
Total Score B: [Sum /100]

BETTER_RESPONSE: [A or B]

SUMMARY REASONING:
[2-3 sentences explaining the key factors that determined the winner]"""

        eval_response = await self.model_client.query_anthropic_model(evaluation_prompt)
        
        # Parse scores from the response
        def extract_scores(text: str, model: str) -> ResponseScores:
            import re
            scores = {}
            pattern = fr"Response {model}:\n- Comprehensiveness: (\d+)/35\n- Practical Applicability: (\d+)/35\n- Clarity: (\d+)/20\n- Structure: (\d+)/10"
            match = re.search(pattern, text)
            if match:
                scores = {
                    'comprehensiveness': int(match.group(1)),
                    'practical_applicability': int(match.group(2)),
                    'clarity': int(match.group(3)),
                    'structure': int(match.group(4))
                }
                scores['total_score'] = sum(scores.values())
            else:
                scores = {
                    'comprehensiveness': 0,
                    'practical_applicability': 0,
                    'clarity': 0,
                    'structure': 0,
                    'total_score': 0
                }
            return ResponseScores(**scores)

        model_a_scores = extract_scores(eval_response.response, "A")
        model_b_scores = extract_scores(eval_response.response, "B")

        # Determine better response
        if "BETTER_RESPONSE: A" in eval_response.response:
            better_response = "Model A"
        elif "BETTER_RESPONSE: B" in eval_response.response:
            better_response = "Model B"
        else:
            better_response = "Model A" if model_a_scores.total_score > model_b_scores.total_score else "Model B"

        # Get token usage from responses
        model_a_tokens = response_a.usage or {"input_tokens": 0, "output_tokens": 0}
        model_b_tokens = response_b.usage or {"input_tokens": 0, "output_tokens": 0}
        evaluator_tokens = eval_response.usage or {"input_tokens": 0, "output_tokens": 0}

        return EvalResult(
            question_id=question.id,
            responses=[response_a, response_b],
            better_response_model_id=better_response,
            faster_response_model_id="Model A" if response_a.latency < response_b.latency else "Model B",
            evaluator_reasoning=eval_response.response,
            model_a_scores=model_a_scores,
            model_b_scores=model_b_scores,
            model_a_tokens=model_a_tokens,
            model_b_tokens=model_b_tokens,
            evaluator_tokens=evaluator_tokens
        ) 