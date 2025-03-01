from typing import List
from .types import EvalQuestion

eval_questions: List[EvalQuestion] = [
    EvalQuestion(
        id="tech-relocation",
        category="Best of N",
        question="Which city should our tech company relocate to, considering talent availability, cost of living, tax incentives, and quality of life?"
    ),
    EvalQuestion(
        id="ev-purchase",
        category="Best of N",
        question="What electric vehicle should I purchase, balancing range, charging infrastructure, price, and maintenance costs?"
    ),
    EvalQuestion(
        id="microservices",
        category="Best of N",
        question="Should our software team adopt microservices or maintain a monolithic architecture for our growing application?"
    ),
    # Add remaining questions...
] 