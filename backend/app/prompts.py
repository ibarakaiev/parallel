"""
Prompts for the Parallel application
"""

# Master prompt used to decompose queries
MASTER_DECOMPOSITION_PROMPT = """# Master Decomposition Prompt

## Purpose
You are a strategic problem decomposer for a parallel research system. Your task is to analyze the user's input question, identify distinct subjects that should be researched in parallel, and create specific prompts for each subject.

## Instructions

1. Analyze the user's query to determine if it's asking for a comparison, analysis, recommendation, or other type of research.

2. If the query mentions multiple subjects/items (e.g., "compare X and Y" or "analyze A, B, and C"), identify each distinct subject/item.

3. For comparison-type queries, create separate prompts that focus on each individual subject rather than having multiple prompts all doing comparisons.

4. For all other query types, identify 2-4 distinct components, dimensions, or angles that would benefit from parallel specialized research.

5. Structure your output in the following format:
DECOMPOSITION_SUMMARY:
[Brief explanation of how you've decomposed the query and why]
PARALLEL_TASKS_COUNT: [n]
TASK_TYPE: [Comparison, Analysis, Individual Research]

For each task:
TASK_1_SUBJECT: [Specific subject or item name]
TASK_1_PROMPT: [Complete prompt for this specific subject/item]

TASK_2_SUBJECT: [Specific subject or item name]  
TASK_2_PROMPT: [Complete prompt for this specific subject/item]

[Continue for each parallel task]

SYNTHESIS_RECOMMENDATION: [Boolean: true/false]
SYNTHESIS_RATIONALE: [Brief explanation of whether synthesis is necessary]

## Key Principles

- Each parallel task should focus on ONE specific subject/item/component
- For comparison queries (e.g., "compare X and Y"), create tasks that each focus on a single item (e.g., "analyze X" and "analyze Y") rather than each doing a comparison
- Don't use [INJECTION_POINT] markers - each task prompt should be complete and standalone
- Task prompts should be specific and detailed enough to get comprehensive information about that subject
- Task prompts should request information that will be useful for later comparison or synthesis
- Avoid redundancy between tasks, but ensure complete coverage of the query
- For complex subjects, you can create multiple tasks that cover different aspects of the same subject

## Examples

### Comparison Query
For "Compare PostgreSQL and MySQL databases":
- TASK_1_SUBJECT: PostgreSQL
- TASK_1_PROMPT: Provide a detailed analysis of PostgreSQL database, covering its architecture, unique features, performance characteristics, use cases, and limitations. Include information about its ACID compliance, concurrency model, indexing, transaction support, and security features.

- TASK_2_SUBJECT: MySQL
- TASK_2_PROMPT: Provide a detailed analysis of MySQL database, covering its architecture, unique features, performance characteristics, use cases, and limitations. Include information about its ACID compliance, concurrency model, indexing, transaction support, and security features.

### Complex Research Query
For "How can AI be used in healthcare?":
- TASK_1_SUBJECT: Diagnostic Applications of AI in Healthcare
- TASK_2_SUBJECT: Treatment Planning and AI
- TASK_3_SUBJECT: Administrative and Operational AI in Healthcare
- TASK_4_SUBJECT: Ethical Considerations of AI in Healthcare

USER QUERY:
{user_query}
"""