import asyncio
import pandas as pd
from datetime import datetime
from .types import EvalSession, EvalSummary, EvalResult, ModelResponse
from .questions import eval_questions
from .model_client import ModelClient
from .evaluator import ResponseEvaluator
from typing import List
import matplotlib.pyplot as plt
import numpy as np

class EvalRunner:
    def __init__(self, model_client: ModelClient, evaluator: ResponseEvaluator):
        self.model_client = model_client
        self.evaluator = evaluator

    async def run_evaluation(self, questions=None) -> EvalSession:
        results = []
        
        # Use provided questions or default to eval_questions
        eval_questions_to_use = questions if questions is not None else eval_questions
        
        for question in eval_questions_to_use:
            # Get responses from both models
            response_a, response_b = await asyncio.gather(
                self.model_client.query_branchial_model(question.question),
                self.model_client.query_anthropic_model(question.question)
            )
            
            # Compare responses
            eval_result = await self.evaluator.evaluate_responses(
                question,
                response_a,
                response_b
            )
            
            results.append(eval_result)
        
        # Calculate summary statistics
        return self.create_eval_session(results)

    def create_eval_session(self, results: List[EvalResult]) -> EvalSession:
        session = EvalSession(
            id=str(int(datetime.now().timestamp())),
            timestamp=datetime.now(),
            results=results,
            summary=EvalSummary(
                total_questions=0,
                model_a_better_count=0,
                model_b_better_count=0,
                tie_count=0,
                model_a_faster_count=0,
                model_b_faster_count=0,
                average_latency_a=0,
                average_latency_b=0,
                model_a_total_input_tokens=0,
                model_a_total_output_tokens=0,
                model_b_total_input_tokens=0,
                model_b_total_output_tokens=0,
                model_a_score=0,
                model_b_score=0
            )
        )
        
        self._calculate_summary(session)
        return session

    def _calculate_summary(self, session: EvalSession) -> None:
        results = session.results
        session.summary.total_questions = len(results)
        
        total_latency_a = 0
        total_latency_b = 0
        
        for result in results:
            # Count better responses
            if result.better_response_model_id == "Model A":
                session.summary.model_a_better_count += 1
            elif result.better_response_model_id == "Model B":
                session.summary.model_b_better_count += 1
            else:
                session.summary.tie_count += 1
            
            # Count faster responses
            if result.faster_response_model_id == "Model A":
                session.summary.model_a_faster_count += 1
            else:
                session.summary.model_b_faster_count += 1
            
            # Sum latencies and token usage
            response_a = next(r for r in result.responses if r.model_id == "Model A")
            response_b = next(r for r in result.responses if r.model_id == "Model B")
            
            # Latencies
            total_latency_a += response_a.latency
            total_latency_b += response_b.latency
            
            # Token usage
            session.summary.model_a_total_input_tokens += response_a.usage.get("input_tokens", 0)
            session.summary.model_a_total_output_tokens += response_a.usage.get("output_tokens", 0)
            session.summary.model_b_total_input_tokens += response_b.usage.get("input_tokens", 0)
            session.summary.model_b_total_output_tokens += response_b.usage.get("output_tokens", 0)
        
        # Calculate averages
        session.summary.average_latency_a = total_latency_a / len(results)
        session.summary.average_latency_b = total_latency_b / len(results)
        
        # Calculate overall scores (percentage of wins)
        total_comparisons = session.summary.total_questions
        session.summary.model_a_score = (session.summary.model_a_better_count / total_comparisons) * 100
        session.summary.model_b_score = (session.summary.model_b_better_count / total_comparisons) * 100

    def print_summary(self, session: EvalSession):
        print("\n=== EVALUATION RESULTS ===")
        print(f"Total Questions: {len(session.results)}")
        
        # Print each question's results
        for i, result in enumerate(session.results, 1):
            print(f"\nQuestion {i}:")
            print("-" * 80)
            print(f"Winner: {result.better_response_model_id or 'Tie'}")
            
            try:
                # Get response scores from evaluation reasoning
                eval_lines = result.evaluator_reasoning.split('\n')
                
                def get_score(model: str, metric: str) -> str:
                    try:
                        for line in eval_lines:
                            if metric in line and model in line:
                                return line.split(':')[1].split('/')[0].strip()
                        return "N/A"  # Return N/A if score not found
                    except Exception:
                        return "N/A"
                
                print("\nModel A (FastAPI/Sonnet):")
                print(f"- Clarity: {get_score('Model A', 'Clarity & Structure')}")
                print(f"- Reasoning: {get_score('Model A', 'Reasoning Quality')}")
                print(f"- Practicality: {get_score('Model A', 'Practicality')}")
                print(f"- Latency: {result.responses[0].latency:.2f}ms")
                print(f"- Tokens: {result.responses[0].usage.get('total_tokens', 0)}")
                
                print("\nModel B (Claude 3 Sonnet):")
                print(f"- Clarity: {get_score('Model B', 'Clarity & Structure')}")
                print(f"- Reasoning: {get_score('Model B', 'Reasoning Quality')}")
                print(f"- Practicality: {get_score('Model B', 'Practicality')}")
                print(f"- Latency: {result.responses[1].latency:.2f}ms")
                print(f"- Tokens: {result.responses[1].usage.get('total_tokens', 0)}")
                
            except Exception as e:
                print(f"Error processing result: {str(e)}")
                continue
        
        # Print overall summary
        print("\n=== OVERALL SUMMARY ===")
        print(f"Model A wins: {session.summary.model_a_better_count}")
        print(f"Model B wins: {session.summary.model_b_better_count}")
        print(f"Ties: {session.summary.tie_count}")
        print(f"\nAverage Latency:")
        print(f"Model A: {session.summary.average_latency_a:.2f}ms")
        print(f"Model B: {session.summary.average_latency_b:.2f}ms")

    def save_results_to_csv(self, session: EvalSession, filename: str = None):
        if filename is None:
            filename = f"eval_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        # Prepare data for DataFrame
        records = []
        for result in session.results:
            response_a = result.responses[0]
            response_b = result.responses[1]
            
            # Extract scores directly from evaluator_reasoning using safer parsing
            try:
                eval_text = result.evaluator_reasoning
                lines = [line.strip() for line in eval_text.split('\n') if line.strip()]
                
                # Initialize default scores
                scores_a = {'clarity': 0, 'reasoning': 0, 'practicality': 0}
                scores_b = {'clarity': 0, 'reasoning': 0, 'practicality': 0}
                
                # Parse scores more safely
                for line in lines:
                    if 'Clarity & Structure:' in line:
                        if 'Model A' in line:
                            scores_a['clarity'] = float(line.split(':')[1].split('/')[0].strip())
                        elif 'Model B' in line:
                            scores_b['clarity'] = float(line.split(':')[1].split('/')[0].strip())
                    elif 'Reasoning Quality:' in line:
                        if 'Model A' in line:
                            scores_a['reasoning'] = float(line.split(':')[1].split('/')[0].strip())
                        elif 'Model B' in line:
                            scores_b['reasoning'] = float(line.split(':')[1].split('/')[0].strip())
                    elif 'Practicality:' in line:
                        if 'Model A' in line:
                            scores_a['practicality'] = float(line.split(':')[1].split('/')[0].strip())
                        elif 'Model B' in line:
                            scores_b['practicality'] = float(line.split(':')[1].split('/')[0].strip())
                
                record = {
                    'question': result.question.question,
                    'winner': result.better_response_model_id or "Tie",
                    'model_a_latency': response_a.latency,
                    'model_b_latency': response_b.latency,
                    'model_a_tokens': response_a.usage.get('total_tokens', 0),
                    'model_b_tokens': response_b.usage.get('total_tokens', 0),
                    'model_a_clarity': scores_a['clarity'],
                    'model_a_reasoning': scores_a['reasoning'],
                    'model_a_practicality': scores_a['practicality'],
                    'model_b_clarity': scores_b['clarity'],
                    'model_b_reasoning': scores_b['reasoning'],
                    'model_b_practicality': scores_b['practicality']
                }
                records.append(record)
                
            except Exception as e:
                print(f"Error processing result: {str(e)}")
                continue
        
        # Create and save DataFrame
        df = pd.DataFrame(records)
        df.to_csv(filename, index=False)
        print(f"\nResults saved to {filename}")
        return filename

    def visualize_comparison(self, session: EvalSession):
        self.visualize_quality_metrics(session)
        self.visualize_latency(session)
        self.visualize_tokens(session)

    def visualize_quality_metrics(self, session: EvalSession):
        # Quality metrics visualization
        metrics = {
            'Clarity': {
                'Model A': np.mean([float(r.evaluator_reasoning.split('Clarity & Structure: ')[1].split('/')[0].strip()) 
                                  for r in session.results]),
                'Model B': np.mean([float(r.evaluator_reasoning.split('Model B')[1].split('Clarity & Structure: ')[1].split('/')[0].strip())
                                  for r in session.results])
            },
            'Reasoning': {
                'Model A': np.mean([float(r.evaluator_reasoning.split('Reasoning Quality: ')[1].split('/')[0].strip())
                                  for r in session.results]),
                'Model B': np.mean([float(r.evaluator_reasoning.split('Model B')[1].split('Reasoning Quality: ')[1].split('/')[0].strip())
                                  for r in session.results])
            },
            'Practicality': {
                'Model A': np.mean([float(r.evaluator_reasoning.split('Practicality: ')[1].split('/')[0].strip())
                                  for r in session.results]),
                'Model B': np.mean([float(r.evaluator_reasoning.split('Model B')[1].split('Practicality: ')[1].split('/')[0].strip())
                                  for r in session.results])
            }
        }

        plt.figure(figsize=(10, 6))
        x = np.arange(len(metrics))
        width = 0.35

        bars1 = plt.bar(x - width/2, [metrics[m]['Model A'] for m in metrics], width, 
                        label='Branchial/FastAPI', color='#2ecc71', alpha=0.8)
        bars2 = plt.bar(x + width/2, [metrics[m]['Model B'] for m in metrics], width, 
                        label='Direct Claude', color='#3498db', alpha=0.8)

        plt.xlabel('Quality Metrics', fontsize=12)
        plt.ylabel('Score (0-100)', fontsize=12)
        plt.title('Response Quality Comparison', fontsize=14, pad=20)
        plt.xticks(x, list(metrics.keys()), fontsize=11)
        plt.ylim(0, 100)
        plt.grid(axis='y', linestyle='--', alpha=0.7)
        plt.legend(fontsize=10)

        for bars in [bars1, bars2]:
            for bar in bars:
                height = bar.get_height()
                plt.text(bar.get_x() + bar.get_width()/2., height,
                        f'{height:.1f}',
                        ha='center', va='bottom', fontsize=10)

        plt.tight_layout()
        plt.savefig('quality_metrics.png', dpi=300, bbox_inches='tight')
        print("\nQuality metrics visualization saved as quality_metrics.png")

    def visualize_latency(self, session: EvalSession):
        # Latency visualization
        plt.figure(figsize=(8, 6))
        
        latencies = {
            'Branchial/FastAPI': session.summary.average_latency_a,
            'Direct Claude': session.summary.average_latency_b
        }
        
        bars = plt.bar(range(len(latencies)), latencies.values(), color=['#2ecc71', '#3498db'], alpha=0.8)
        
        plt.title('Average Response Latency', fontsize=14, pad=20)
        plt.xlabel('Model', fontsize=12)
        plt.ylabel('Latency (ms)', fontsize=12)
        plt.xticks(range(len(latencies)), latencies.keys(), fontsize=11)
        plt.grid(axis='y', linestyle='--', alpha=0.7)
        
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height,
                    f'{height:.1f}ms',
                    ha='center', va='bottom', fontsize=10)
        
        plt.tight_layout()
        plt.savefig('latency_comparison.png', dpi=300, bbox_inches='tight')
        print("Latency visualization saved as latency_comparison.png")

    def visualize_tokens(self, session: EvalSession):
        # Token usage visualization
        plt.figure(figsize=(8, 6))
        
        tokens_a = np.mean([r.responses[0].usage.get('total_tokens', 0) for r in session.results])
        tokens_b = np.mean([r.responses[1].usage.get('total_tokens', 0) for r in session.results])
        
        tokens = {
            'Branchial/FastAPI': tokens_a,
            'Direct Claude': tokens_b
        }
        
        bars = plt.bar(range(len(tokens)), tokens.values(), color=['#2ecc71', '#3498db'], alpha=0.8)
        
        plt.title('Average Token Usage per Response', fontsize=14, pad=20)
        plt.xlabel('Model', fontsize=12)
        plt.ylabel('Tokens', fontsize=12)
        plt.xticks(range(len(tokens)), tokens.keys(), fontsize=11)
        plt.grid(axis='y', linestyle='--', alpha=0.7)
        
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height,
                    f'{height:.0f}',
                    ha='center', va='bottom', fontsize=10)
        
        plt.tight_layout()
        plt.savefig('token_usage.png', dpi=300, bbox_inches='tight')
        print("Token usage visualization saved as token_usage.png")
