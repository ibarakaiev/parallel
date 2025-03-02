from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime

class EvalQuestion(BaseModel):
    id: str
    category: str
    question: str

class ModelResponse(BaseModel):
    model_id: str
    response: str
    latency: float
    timestamp: datetime
    usage: dict = {}

class EvalResult(BaseModel):
    question_id: str
    question: EvalQuestion
    responses: List[ModelResponse]
    better_response_model_id: Optional[str]
    faster_response_model_id: str
    evaluator_reasoning: str

class EvalSummary(BaseModel):
    total_questions: int
    # Scoring metrics
    model_a_better_count: int
    model_b_better_count: int
    tie_count: int
    # Performance metrics
    model_a_faster_count: int
    model_b_faster_count: int
    average_latency_a: float
    average_latency_b: float
    # Token usage metrics
    model_a_total_input_tokens: int = 0
    model_a_total_output_tokens: int = 0
    model_b_total_input_tokens: int = 0
    model_b_total_output_tokens: int = 0
    # Overall metrics
    model_a_score: float = 0  # Percentage of wins
    model_b_score: float = 0

class EvalSession(BaseModel):
    id: str
    timestamp: datetime
    results: List[EvalResult]
    summary: EvalSummary 