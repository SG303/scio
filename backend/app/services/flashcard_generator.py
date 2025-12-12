"""
Flashcard AI Generator service.

This module handles AI-powered generation of flashcards from documents or topics,
similar to the test_generator but optimized for Q&A flashcard format.
"""
import httpx
import json
import re
import math
from typing import List, Dict, Any, Optional
from app.config import get_settings
from app.models import Document, Question

settings = get_settings()


def build_flashcard_prompt(
    documents: List[Document],
    num_cards: int,
    topic: str = "",
    custom_prompt: Optional[str] = None,
    existing_fronts: Optional[List[str]] = None
) -> str:
    """Build the prompt for generating flashcards."""
    
    # Normalize empty strings to None
    if custom_prompt is not None and not custom_prompt.strip():
        custom_prompt = None
    
    # Output format instructions
    output_format = """OUTPUT FORMAT - Return ONLY a valid JSON array like this example:
[
  {"front": "What is the capital of France?", "back": "Paris"},
  {"front": "What does HTTP stand for?", "back": "HyperText Transfer Protocol"},
  {"front": "Explain the concept of polymorphism in OOP", "back": "Polymorphism allows objects of different classes to be treated as objects of a common parent class. It enables one interface to be used for different data types."}
]

CRITICAL RULES:
- Each flashcard must have exactly two fields: "front" and "back"
- "front" is the question or prompt shown to the learner
- "back" is the answer that should be recalled
- Keep answers concise but complete
- Return ONLY the JSON array, no markdown, no extra text"""
    
    # Build prompt based on whether we have documents
    if documents:
        # Combine document contents
        context_parts = []
        for doc in documents:
            if doc.content:
                content = doc.content
                context_parts.append(f"### {doc.title} ({doc.doc_type})\n{content}")
        
        context = "\n\n---\n\n".join(context_parts)
        
        if custom_prompt:
            prompt = f"""You are an expert educator creating flashcards for effective learning. Based on the following study materials, create {num_cards} flashcards.

STUDY MATERIALS:
{context}

CUSTOM INSTRUCTIONS:
{custom_prompt}

REQUIREMENTS:
1. Create exactly {num_cards} flashcards
2. Each card should test ONE atomic concept
3. Front should be a clear, specific question or prompt
4. Back should be a concise but complete answer
5. Mix difficulty levels (basic recall to application)

{output_format}"""
        else:
            prompt = f"""You are an expert educator creating flashcards for effective learning. Based on the following study materials, create {num_cards} flashcards to help someone learn and retain the key concepts.

STUDY MATERIALS:
{context}

REQUIREMENTS:
1. Create exactly {num_cards} flashcards
2. Each card should test ONE atomic concept (single piece of knowledge)
3. Front should be a clear, specific question or prompt
4. Back should be a concise but complete answer
5. Avoid yes/no questions - prefer "what", "how", "why", "explain"
6. Mix difficulty levels (basic definitions to applied understanding)
7. Cover the most important concepts from the material

{output_format}"""
    else:
        # Topic-based generation
        if custom_prompt:
            prompt = f"""You are an expert educator creating flashcards for effective learning. Create {num_cards} flashcards about the following topic.

TOPIC: {topic}

CUSTOM INSTRUCTIONS:
{custom_prompt}

REQUIREMENTS:
1. Create exactly {num_cards} flashcards about "{topic}"
2. Each card should test ONE atomic concept
3. Front should be a clear, specific question
4. Back should be a concise but complete answer

{output_format}"""
        else:
            prompt = f"""You are an expert educator creating flashcards for effective learning. Create {num_cards} flashcards to help someone learn about the following topic.

TOPIC: {topic}

REQUIREMENTS:
1. Create exactly {num_cards} flashcards about "{topic}"
2. Each card should test ONE atomic concept (single piece of knowledge)
3. Cover fundamental concepts, key terminology, and important details
4. Front should be a clear, specific question or prompt
5. Back should be a concise but complete answer
6. Avoid yes/no questions - prefer "what", "how", "why", "explain"
7. Mix difficulty levels (basic definitions to applied understanding)

{output_format}"""
    
    # Add existing cards to avoid duplicates
    if existing_fronts:
        fronts_list = "\n".join(f"- {f}" for f in existing_fronts)
        prompt += f"""

EXISTING FLASHCARDS (DO NOT REPEAT):
{fronts_list}

IMPORTANT: Create NEW flashcards that are different from the ones listed above. Do not rephrase or create variations of these existing cards."""
    
    return prompt


async def generate_flashcards(
    documents: List[Document],
    num_cards: int,
    model_id: str,
    topic: str = "",
    custom_prompt: Optional[str] = None,
    existing_fronts: Optional[List[str]] = None
) -> List[Dict[str, str]]:
    """
    Generate flashcards using OpenRouter API.
    
    Args:
        documents: List of documents to use as context
        num_cards: Number of flashcards to generate
        model_id: OpenRouter model ID
        topic: Topic for generation (used if no documents)
        custom_prompt: Optional custom instructions
        existing_fronts: List of existing card fronts to avoid duplicates
    
    Returns:
        List of flashcard dictionaries with 'front' and 'back' keys
    """
    # For large numbers of cards, batch the generation
    if num_cards <= 30:
        return await _generate_batch(
            documents, num_cards, model_id, topic, custom_prompt, existing_fronts
        )
    
    # Batch generation for larger requests
    all_cards = []
    batch_size = 25
    current_existing = list(existing_fronts) if existing_fronts else []
    
    num_batches = math.ceil(num_cards / batch_size)
    
    for i in range(num_batches):
        cards_in_batch = min(batch_size, num_cards - len(all_cards))
        
        if cards_in_batch <= 0:
            break
        
        try:
            batch_cards = await _generate_batch(
                documents, cards_in_batch, model_id, topic, custom_prompt, current_existing
            )
            
            all_cards.extend(batch_cards)
            
            # Add new fronts to existing list for next batch
            for card in batch_cards:
                current_existing.append(card["front"])
                
        except Exception as e:
            if not all_cards:
                raise e
            # Return what we have
            break
    
    return all_cards


async def _generate_batch(
    documents: List[Document],
    num_cards: int,
    model_id: str,
    topic: str = "",
    custom_prompt: Optional[str] = None,
    existing_fronts: Optional[List[str]] = None
) -> List[Dict[str, str]]:
    """Generate a single batch of flashcards."""
    
    if not settings.openrouter_api_key:
        raise ValueError("OpenRouter API key is not configured")
    
    prompt = build_flashcard_prompt(documents, num_cards, topic, custom_prompt, existing_fronts)
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8000",
                "X-Title": "Scio"
            },
            json={
                "model": model_id,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert educational content creator. Always respond with valid JSON only, no markdown formatting."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.7,
            }
        )
        
        if response.status_code != 200:
            error_detail = response.text
            raise ValueError(f"OpenRouter API error ({response.status_code}): {error_detail}")
        
        data = response.json()
        
        if "error" in data:
            raise ValueError(f"OpenRouter error: {data['error']}")
        
        content = data["choices"][0]["message"]["content"]
        
        # Parse the JSON response
        flashcards = parse_flashcards_response(content)
        
        return flashcards


def parse_flashcards_response(content: str) -> List[Dict[str, str]]:
    """Parse the AI response and extract flashcards."""
    
    content = content.strip()
    
    # Remove markdown code blocks if present
    if content.startswith("```"):
        lines = content.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    
    # Try to find JSON array in the content
    json_match = re.search(r'\[[\s\S]*\]', content)
    if json_match:
        content = json_match.group()
    
    try:
        flashcards = json.loads(content)
    except json.JSONDecodeError as e:
        # Try fallback parsing
        try:
            flashcards = extract_flashcards_fallback(content)
        except Exception:
            raise ValueError(f"Failed to parse AI response as JSON: {str(e)}\nResponse: {content[:500]}")
    
    if not isinstance(flashcards, list):
        raise ValueError("AI response is not a list of flashcards")
    
    # Validate and normalize flashcards
    validated = []
    for card in flashcards:
        if not isinstance(card, dict):
            continue
        
        front = card.get("front", "").strip()
        back = card.get("back", "").strip()
        
        # Also try alternate keys
        if not front:
            front = card.get("question", card.get("q", "")).strip()
        if not back:
            back = card.get("answer", card.get("a", "")).strip()
        
        if front and back:
            validated.append({
                "front": front,
                "back": back
            })
    
    if not validated:
        raise ValueError("No valid flashcards found in AI response")
    
    return validated


def extract_flashcards_fallback(content: str) -> List[Dict[str, str]]:
    """Fallback parser for malformed JSON responses."""
    flashcards = []
    
    # Try to find front/back patterns
    front_pattern = r'"front"\s*:\s*"([^"]+)"'
    back_pattern = r'"back"\s*:\s*"([^"]+)"'
    
    # Split by potential card boundaries
    blocks = re.split(r'\},\s*\{', content)
    
    for block in blocks:
        front_match = re.search(front_pattern, block, re.DOTALL)
        back_match = re.search(back_pattern, block, re.DOTALL)
        
        if front_match and back_match:
            flashcards.append({
                "front": front_match.group(1),
                "back": back_match.group(1)
            })
    
    if not flashcards:
        raise ValueError("Could not extract flashcards from response")
    
    return flashcards


def create_flashcards_from_questions(
    questions: List[Question],
    wrong_only: bool = True
) -> List[Dict[str, Any]]:
    """
    Convert test questions to flashcard format.
    
    Args:
        questions: List of Question objects from a test
        wrong_only: If True, only convert incorrectly answered questions
    
    Returns:
        List of flashcard data dictionaries
    """
    flashcards = []
    
    for q in questions:
        # Skip correct answers if wrong_only is True
        if wrong_only and q.is_correct:
            continue
        
        # Get the correct answer text
        correct_idx = q.correct_answer
        choices = q.choices
        correct_text = ""
        
        if choices and 0 <= correct_idx < len(choices):
            correct_choice = choices[correct_idx]
            if isinstance(correct_choice, dict):
                correct_text = correct_choice.get("text", "")
            else:
                correct_text = str(correct_choice)
        
        # Build the back content
        back = correct_text
        if q.explanation:
            back = f"{correct_text}\n\n{q.explanation}"
        
        flashcards.append({
            "front": q.question_text,
            "back": back,
            "source_type": "from_test",
            "source_question_id": q.id
        })
    
    return flashcards

