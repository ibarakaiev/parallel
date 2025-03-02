from typing import List
from .types import EvalQuestion

BUSINESS_QUESTION_PROMPT = """Generate a unique "Best of N" type business decision question that's different from previous ones. 
Focus on one of these business scenarios:
1. Technology Stack Decisions (e.g., choosing between cloud providers, development frameworks)
2. Market Entry Strategy (e.g., which market segment to target first)
3. Product Development (e.g., which features to prioritize)
4. Resource Allocation (e.g., budget distribution across departments)
5. Vendor Selection (e.g., choosing between suppliers)
6. Operational Strategy (e.g., in-house vs outsourcing)
7. Growth Strategy (e.g., organic growth vs acquisition)
8. Business Model Selection (e.g., subscription vs one-time purchase)
9. Partnership Decisions (e.g., which strategic partner to choose)
10. Investment Decisions (e.g., which project to fund)

The question should:
1. Present 2-4 clear options
2. Require analyzing specific tradeoffs
3. Include relevant context and constraints
4. Be specific and actionable"""

class QuestionGenerator:
    def __init__(self, anthropic_client):
        self.client = anthropic_client
        self.used_categories = set()  # Track used categories to ensure diversity

    async def generate_business_questions(self, num_questions: int = 10) -> List[EvalQuestion]:
        questions = []
        for i in range(num_questions):
            response = await self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=1024,
                temperature=0.7,
                messages=[{
                    "role": "user", 
                    "content": f"{BUSINESS_QUESTION_PROMPT}\nMake sure this question is different from: {', '.join(self.used_categories)}"
                }]
            )
            
            question_text = response.content[0].text.strip()
            self.used_categories.add(question_text[:50])  # Add start of question to track uniqueness
            
            questions.append(
                EvalQuestion(
                    id=f"business-q{i+1}",
                    category="Best of N",
                    question=question_text
                )
            )
        return questions 