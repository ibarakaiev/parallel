from pydantic import BaseModel
from typing import List, Optional, Dict
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
    usage: Optional[Dict[str, int]] = None

class ResponseScores(BaseModel):
    comprehensiveness: int  # Out of 35
    practical_applicability: int  # Out of 35 
    clarity: int  # Out of 20
    structure: int  # Out of 10
    total_score: int  # Out of 100

class EvalResult(BaseModel):
    question_id: str
    responses: List[ModelResponse]
    better_response_model_id: str
    faster_response_model_id: str
    evaluator_reasoning: str
    model_a_scores: ResponseScores
    model_b_scores: ResponseScores
    model_a_tokens: Dict[str, int]
    model_b_tokens: Dict[str, int]

class EvalSummary(BaseModel):
    total_questions: int
    # Scoring Metrics
    model_a_avg_comprehensiveness: float  # /35
    model_b_avg_comprehensiveness: float
    model_a_avg_practical: float  # /35
    model_b_avg_practical: float
    model_a_avg_clarity: float  # /20
    model_b_avg_clarity: float
    model_a_avg_structure: float  # /10
    model_b_avg_structure: float
    model_a_avg_total: float  # /100
    model_b_avg_total: float
    # Overall Winner
    overall_winner: str  # "Model A" or "Model B"
    model_a_total_score: float
    model_b_total_score: float
    # Performance Metrics
    model_a_faster_count: int
    model_b_faster_count: int
    average_latency_a: float
    average_latency_b: float
    # Token Usage
    total_model_a_input_tokens: int = 0
    total_model_a_output_tokens: int = 0
    total_model_b_input_tokens: int = 0
    total_model_b_output_tokens: int = 0

class EvalSession(BaseModel):
    id: str
    timestamp: datetime
    results: List[EvalResult]
    summary: EvalSummary 