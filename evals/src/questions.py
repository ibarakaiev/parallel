from typing import List
from .types import EvalQuestion

eval_questions: List[EvalQuestion] = [
    # Best of N Decisions
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
    EvalQuestion(
        id="college-choice",
        category="Best of N",
        question="Which college should I attend, considering academic reputation, financial aid, location, and career outcomes?"
    ),
    
    # Reasoning Under Uncertainty
    EvalQuestion(
        id="startup-budget",
        category="Uncertainty",
        question="How should we allocate our startup's marketing budget with limited market data?"
    ),
    EvalQuestion(
        id="investment-strategy",
        category="Uncertainty",
        question="What investment strategy is optimal given current economic indicators and geopolitical tensions?"
    ),
    
    # Ethical Dilemmas
    EvalQuestion(
        id="ai-ethics",
        category="Ethics",
        question="Is it ethical to implement this AI system that improves efficiency but may lead to job displacement?"
    ),
    EvalQuestion(
        id="autonomous-vehicles",
        category="Ethics",
        question="How should autonomous vehicles be programmed to handle unavoidable accident scenarios?"
    ),
    
    # Systems Thinking
    EvalQuestion(
        id="agi-impact",
        category="Systems",
        question="How will artificial general intelligence potentially transform different sectors of society, and how should we prepare?"
    ),
    EvalQuestion(
        id="ubi-effects",
        category="Systems",
        question="How might implementing a universal basic income affect economic, social, and political systems?"
    ),
    
    # Creative Ideation
    EvalQuestion(
        id="blockchain-healthcare",
        category="Innovation",
        question="What innovative business models could emerge at the intersection of blockchain and healthcare?"
    ),
    EvalQuestion(
        id="remote-work",
        category="Innovation",
        question="How could we reimagine remote work tools to foster creativity and spontaneous collaboration?"
    )
] 