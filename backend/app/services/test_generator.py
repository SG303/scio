import httpx
import json
import re
import math
from typing import List, Dict, Any
from app.config import get_settings
from app.models import Document

settings = get_settings()


def build_prompt(documents: List[Document], num_questions: int, num_choices: int, topic: str = "", custom_prompt: str = None, existing_questions: List[str] = None) -> str:
    """Build the prompt for generating test questions"""
    
    # Normalize empty strings to None for consistency
    if custom_prompt is not None and not custom_prompt.strip():
        custom_prompt = None
    
    # Base output format instructions (always included)
    output_format = f"""OUTPUT FORMAT - Return ONLY a valid JSON array like this example:
[
  {{
    "question": "What is the capital of France?",
    "choices": ["Paris", "London", "Berlin", "Madrid"],
    "correct_answer": 0,
    "explanation": "Paris is the capital city of France."
  }},
  {{
    "question": "Which planet is closest to the Sun?",
    "choices": ["Venus", "Mercury", "Mars", "Earth"],
    "correct_answer": 1,
    "explanation": "Mercury is the closest planet to the Sun."
  }}
]

CRITICAL RULES:
- "choices" must be a simple JSON array of strings: ["choice1", "choice2", "choice3", "choice4"]
- Do NOT use letter prefixes like "A:" or "B:" in choices
- "correct_answer" is the 0-based index (0 for first choice, 1 for second, etc.)
- Return ONLY the JSON array, no markdown, no extra text"""
    
    # Check if we have documents or just a topic
    if documents:
        # Combine document contents
        context_parts = []
        for doc in documents:
            if doc.content:
                # Removed truncation as user requested no limits on token usage
                # Frontend will handle warnings and cost estimation
                content = doc.content
                context_parts.append(f"### {doc.title} ({doc.doc_type})\n{content}")
        
        context = "\n\n---\n\n".join(context_parts)
        
        # Removed safety truncation for the entire context
        # Frontend will warn user if context exceeds model limits
        
        # Use custom prompt if provided, otherwise use default
        if custom_prompt:
            prompt = f"""You are an expert test creator. Based on the following study materials, create {num_questions} multiple-choice questions.

STUDY MATERIALS:
{context}

CUSTOM INSTRUCTIONS:
{custom_prompt}

REQUIREMENTS:
1. Create exactly {num_questions} questions
2. Each question must have exactly {num_choices} choices
3. Each question must have exactly one correct answer
4. Provide a brief explanation for why the correct answer is correct

{output_format}"""
        else:
            prompt = f"""You are an expert test creator. Based on the following study materials, create {num_questions} multiple-choice questions to help someone prepare for an exam.

STUDY MATERIALS:
{context}

REQUIREMENTS:
1. Create exactly {num_questions} questions
2. Each question must have exactly {num_choices} choices
3. Questions should test understanding, not just memorization
4. Include a mix of difficulty levels
5. Each question must have exactly one correct answer
6. Provide a brief explanation for why the correct answer is correct

{output_format}"""
    else:
        # Topic-based generation without documents
        if custom_prompt:
            prompt = f"""You are an expert test creator. Create {num_questions} multiple-choice questions about the following topic.

TOPIC: {topic}

CUSTOM INSTRUCTIONS:
{custom_prompt}

REQUIREMENTS:
1. Create exactly {num_questions} questions about "{topic}"
2. Each question must have exactly {num_choices} choices
3. Each question must have exactly one correct answer
4. Provide a brief explanation for why the correct answer is correct

{output_format}"""
        else:
            prompt = f"""You are an expert test creator. Create {num_questions} multiple-choice questions about the following topic to help someone learn and test their knowledge.

TOPIC: {topic}

REQUIREMENTS:
1. Create exactly {num_questions} questions about "{topic}"
2. Each question must have exactly {num_choices} choices
3. Questions should cover important concepts, facts, and understanding of the topic
4. Include a mix of difficulty levels (easy, medium, hard)
5. Each question must have exactly one correct answer
6. Provide a brief explanation for why the correct answer is correct

{output_format}"""
    
    # Add existing questions to avoid duplicates
    if existing_questions:
        questions_list = "\n".join(f"- {q}" for q in existing_questions)
        prompt += f"""

PREVIOUSLY GENERATED QUESTIONS (DO NOT REPEAT):
{questions_list}

IMPORTANT: Create NEW questions that are different from the ones listed above. Do not rephrase or create variations of these existing questions."""
    
    return prompt


async def generate_test_questions(
    documents: List[Document],
    num_questions: int,
    num_choices: int,
    model_id: str,
    topic: str = "",
    custom_prompt: str = None,
    existing_questions: List[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate test questions using OpenRouter API.
    
    Uses a tiered approach for token efficiency:
    1. Try to generate all questions in a single call (most efficient)
    2. Fall back to medium batches (25) if single call fails
    3. Final fallback to small batches (10) for reliability
    
    This avoids resending documents multiple times, which was causing 5x+ token overhead.
    """
    
    # Start with any previously existing questions passed to the function
    current_existing = list(existing_questions) if existing_questions else []
    
    # Strategy 1: Try single call for all questions (most token-efficient)
    # This works well for most models - 60 questions = ~7,200 output tokens
    if num_questions <= 60:
        try:
            questions = await _generate_batch(
                documents, 
                num_questions, 
                num_choices, 
                model_id, 
                topic, 
                custom_prompt, 
                current_existing
            )
            if len(questions) >= num_questions * 0.8:  # Accept if we got at least 80%
                return questions[:num_questions]
        except Exception as e:
            # Log and continue to fallback strategy
            print(f"Single-call generation failed, falling back to batches: {e}")
    
    # Strategy 2: Medium batches (25 questions each)
    # More reliable than single call, still much more efficient than small batches
    MEDIUM_BATCH_SIZE = 25
    all_questions = []
    
    try:
        all_questions = await _generate_with_batch_size(
            documents, num_questions, num_choices, model_id,
            topic, custom_prompt, current_existing, MEDIUM_BATCH_SIZE
        )
        if len(all_questions) >= num_questions * 0.8:
            return all_questions[:num_questions]
    except Exception as e:
        print(f"Medium batch generation failed, falling back to small batches: {e}")
    
    # Strategy 3: Small batches (10 questions each) - most reliable fallback
    SMALL_BATCH_SIZE = 10
    all_questions = await _generate_with_batch_size(
        documents, num_questions, num_choices, model_id,
        topic, custom_prompt, current_existing, SMALL_BATCH_SIZE
    )
    
    return all_questions


async def _generate_with_batch_size(
    documents: List[Document],
    num_questions: int,
    num_choices: int,
    model_id: str,
    topic: str,
    custom_prompt: str,
    existing_questions: List[str],
    batch_size: int
) -> List[Dict[str, Any]]:
    """Generate questions using the specified batch size."""
    
    all_questions = []
    num_batches = math.ceil(num_questions / batch_size)
    current_existing = list(existing_questions) if existing_questions else []
    
    for i in range(num_batches):
        questions_in_batch = min(batch_size, num_questions - len(all_questions))
        
        if questions_in_batch <= 0:
            break
            
        try:
            batch_questions = await _generate_batch(
                documents, 
                questions_in_batch, 
                num_choices, 
                model_id, 
                topic, 
                custom_prompt, 
                current_existing
            )
            
            all_questions.extend(batch_questions)
            
            # Add new questions to existing list for the next batch to avoid duplicates
            for q in batch_questions:
                current_existing.append(q["question"])
                
        except Exception as e:
            if not all_questions:
                raise e
            # Return what we have so far
            break
            
    return all_questions


async def _generate_batch(
    documents: List[Document],
    num_questions: int,
    num_choices: int,
    model_id: str,
    topic: str = "",
    custom_prompt: str = None,
    existing_questions: List[str] = None
) -> List[Dict[str, Any]]:
    """Generate a single batch of test questions using OpenRouter API"""
    
    if not settings.openrouter_api_key:
        raise ValueError("OpenRouter API key is not configured")
    
    prompt = build_prompt(documents, num_questions, num_choices, topic, custom_prompt, existing_questions)
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8000",
                "X-Title": "AI Practice Test Generator"
            },
            json={
                "model": model_id,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert educational test creator. Always respond with valid JSON only, no markdown formatting."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.7,
                # "max_tokens": 4096  # Removed max_tokens to avoid Context Window limits for large documents
            }
        )
        
        if response.status_code != 200:
            error_detail = response.text
            print(f"OpenRouter API error response: {error_detail}") # Added logging
            raise ValueError(f"OpenRouter API error ({response.status_code}): {error_detail}")
        
        data = response.json()
        
        if "error" in data:
            print(f"OpenRouter error: {data['error']}") # Added logging
            raise ValueError(f"OpenRouter error: {data['error']}")
        
        content = data["choices"][0]["message"]["content"]
        
        # Parse the JSON response
        questions = parse_questions_response(content, num_choices)
        
        return questions


def parse_questions_response(content: str, num_choices: int) -> List[Dict[str, Any]]:
    """Parse the AI response and extract questions"""
    
    # Try to extract JSON from the response
    content = content.strip()
    
    # Remove markdown code blocks if present
    if content.startswith("```"):
        # Find the end of the code block
        lines = content.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]  # Remove opening ```
        if lines[-1].strip() == "```":
            lines = lines[:-1]  # Remove closing ```
        content = "\n".join(lines)
    
    # Try to find JSON array in the content
    json_match = re.search(r'\[[\s\S]*\]', content)
    if json_match:
        content = json_match.group()
    
    # Fix common JSON formatting issues from AI responses
    # Fix: "choices": ["A": "text", "B": "text"] -> "choices": ["text", "text"]
    content = re.sub(r'"([A-Z])"\s*:\s*"([^"]*)"', r'"\2"', content)
    # Fix: "choices": [A: "text", B: "text"] -> "choices": ["text", "text"]
    content = re.sub(r'([A-Z])\s*:\s*"([^"]*)"', r'"\2"', content)
    # Fix: choices with letter prefixes like "A. text" or "A) text"
    content = re.sub(r'"([A-Z])[.\)]\s*([^"]*)"', r'"\2"', content)
    
    try:
        questions = json.loads(content)
    except json.JSONDecodeError as e:
        # Try a more aggressive fix - extract question objects manually
        try:
            questions = extract_questions_fallback(content, num_choices)
        except Exception:
            raise ValueError(f"Failed to parse AI response as JSON: {str(e)}\nResponse: {content[:500]}")
    
    if not isinstance(questions, list):
        raise ValueError("AI response is not a list of questions")
    
    # Validate and normalize questions
    validated_questions = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        
        # Validate required fields
        if "question" not in q:
            continue
        
        # Handle choices - can be list or dict
        choices = q.get("choices", [])
        if isinstance(choices, dict):
            # Convert dict to list (handle {"A": "text", "B": "text"} format)
            sorted_keys = sorted(choices.keys())
            choices = [choices[k] for k in sorted_keys]
        elif isinstance(choices, list):
            # Clean up choices - remove letter prefixes if present
            cleaned_choices = []
            for c in choices:
                if isinstance(c, str):
                    # Remove patterns like "A. ", "A) ", "A: " at the start
                    cleaned = re.sub(r'^[A-Z][.\):\s]+\s*', '', c)
                    cleaned_choices.append(cleaned)
                elif isinstance(c, dict):
                    # Handle {"A": "text"} format in list
                    for v in c.values():
                        cleaned_choices.append(str(v))
                        break
                else:
                    cleaned_choices.append(str(c))
            choices = cleaned_choices
        
        # Ensure we have enough choices
        while len(choices) < num_choices:
            choices.append(f"Choice {len(choices) + 1}")
        choices = choices[:num_choices]
        
        # Get correct answer
        correct = q.get("correct_answer", 0)
        if isinstance(correct, str):
            # Convert letter to index (A=0, B=1, etc.)
            if len(correct) == 1 and correct.upper() in "ABCDEFGH":
                correct = ord(correct.upper()) - 65
            else:
                try:
                    correct = int(correct)
                except ValueError:
                    correct = 0
        correct = max(0, min(int(correct), num_choices - 1))
        
        validated_questions.append({
            "question": str(q["question"]),
            "choices": [str(c) for c in choices],
            "correct_answer": correct,
            "explanation": str(q.get("explanation", ""))
        })
    
    if not validated_questions:
        raise ValueError("No valid questions found in AI response")
    
    return validated_questions


def extract_questions_fallback(content: str, num_choices: int) -> List[Dict[str, Any]]:
    """Fallback parser for malformed JSON responses"""
    questions = []
    
    # Try to find question patterns
    question_pattern = r'"question"\s*:\s*"([^"]+)"'
    choices_pattern = r'"choices"\s*:\s*\[(.*?)\]'
    correct_pattern = r'"correct_answer"\s*:\s*(\d+|"[A-Z]")'
    explanation_pattern = r'"explanation"\s*:\s*"([^"]*)"'
    
    # Split by question blocks (roughly)
    blocks = re.split(r'\},\s*\{', content)
    
    for block in blocks:
        q_match = re.search(question_pattern, block, re.DOTALL)
        if not q_match:
            continue
            
        question_text = q_match.group(1)
        
        # Extract choices
        choices = []
        c_match = re.search(choices_pattern, block, re.DOTALL)
        if c_match:
            choices_raw = c_match.group(1)
            # Find all quoted strings
            choice_strings = re.findall(r'"([^"]+)"', choices_raw)
            # Filter out letter keys like "A", "B", etc.
            choices = [c for c in choice_strings if len(c) > 1 or c not in "ABCDEFGH"]
        
        # Extract correct answer
        correct = 0
        correct_match = re.search(correct_pattern, block)
        if correct_match:
            val = correct_match.group(1).strip('"')
            if val.isdigit():
                correct = int(val)
            elif len(val) == 1 and val.upper() in "ABCDEFGH":
                correct = ord(val.upper()) - 65
        
        # Extract explanation
        explanation = ""
        exp_match = re.search(explanation_pattern, block, re.DOTALL)
        if exp_match:
            explanation = exp_match.group(1)
        
        if question_text and choices:
            questions.append({
                "question": question_text,
                "choices": choices[:num_choices],
                "correct_answer": min(correct, len(choices) - 1),
                "explanation": explanation
            })
    
    if not questions:
        raise ValueError("Could not extract questions from response")
    
    return questions


async def verify_question_integrity(
    question_text: str,
    choices: List[str],
    correct_answer_index: int,
    explanation: str
) -> Dict[str, Any]:
    """Verify if a question and its answer key are logically sound"""
    
    # We use a specific lightweight model as requested
    VERIFICATION_MODEL = "google/gemini-2.5-flash-lite"
    
    prompt = f"""You are a quality assurance assistant for an exam system. 
Please review this multiple-choice question to verify if the "Marked Correct Answer" is actually correct and if the question makes sense.

QUESTION: {question_text}

CHOICES:
{json.dumps(choices, indent=2)}

MARKED CORRECT ANSWER (Index {correct_answer_index}): {choices[correct_answer_index] if 0 <= correct_answer_index < len(choices) else "Invalid Index"}

PROVIDED EXPLANATION: {explanation}

TASK:
Analyze the question logic. 
1. Is the marked answer actually correct?
2. Are the other distractors clearly incorrect?
3. Is the question ambiguous?

OUTPUT JSON ONLY:
{{
  "status": "likely_ok" OR "potential_issue",
  "confidence": "high" OR "medium" OR "low",
  "analysis": "A brief, 1-2 sentence assessment of the question's validity. If you disagree with the answer, explain why."
}}
"""

    if not settings.openrouter_api_key:
        raise ValueError("OpenRouter API key is not configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8000",
                "X-Title": "AI Practice Test Verifier"
            },
            json={
                "model": VERIFICATION_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant that outputs only valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1, # Low temperature for more analytical results
                "max_tokens": 500
            }
        )
        
        if response.status_code != 200:
             # Fallback if the specific 'lite' model isn't available/working
            raise ValueError(f"Verification API error ({response.status_code})")
            
        data = response.json()
        
        if "error" in data:
             raise ValueError(f"OpenRouter error: {data['error']}")
             
        content = data["choices"][0]["message"]["content"]
        
        # Simple cleanup to ensure we get just the JSON
        if "```" in content:
            content = content.split("```")[1]
            if content.strip().startswith("json"):
                content = content.strip()[4:]
        
        return json.loads(content.strip())
