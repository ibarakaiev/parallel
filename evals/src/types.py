from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class EvalQuestion(BaseModel):
    id: str
    category: str
    question: str

class ModelResponse(BaseModel):
    model_id: str  # "Model A" or "Model B"
    response: str
    latency: float  # in milliseconds
    timestamp: datetime

class EvalResult(BaseModel):
    question_id: str
    responses: List[ModelResponse]
    better_response_model_id: Optional[str]
    faster_response_model_id: str
    evaluator_reasoning: str

class EvalSummary(BaseModel):
    total_questions: int
    model_a_better_count: int
    model_b_better_count: int
    tie_count: int
    model_a_faster_count: int
    model_b_faster_count: int
    average_latency_a: float
    average_latency_b: float

class EvalSession(BaseModel):
    id: str
    timestamp: datetime
    results: List[EvalResult]
    summary: EvalSummary 