"""Format lecture notes with AI: fix spelling and structure the Markdown,
without adding or removing content.

The owner checks the result in a diff view; the server additionally makes
sure every image survives unchanged, because a lost image link is hard to
spot in a diff and impossible to recover from the AI output.
"""

import json
import logging
import re
from collections import Counter

from app.services.openrouter_client import chat_completion_json

logger = logging.getLogger(__name__)

# ![alt](url "title") — the URL is what identifies an uploaded image
IMAGE_RE = re.compile(r"!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")

SYSTEM_PROMPT = (
    "You are a meticulous copy editor for a student's lecture notes. "
    "Always respond with valid JSON only."
)


def build_format_prompt(markdown: str) -> str:
    return f"""Clean up the following lecture notes written in Markdown.

DO:
- Fix spelling, grammar, punctuation and obvious typos.
- Keep the language of the notes (German notes stay German, English stays English, mixed stays mixed).
- Give the notes a clear, consistent Markdown structure: headings for topics, bullet or numbered lists for enumerations, **bold** for key terms, tables only where the notes already list tabular data.
- Keep the order of the content.

DO NOT:
- Do not add information, explanations, examples, definitions, summaries or conclusions that are not in the notes.
- Do not remove or shorten content, even if it seems unimportant or repeated.
- Do not translate.
- Image lines like ![...](...) must be kept exactly as they are, character for character, at their position.

OUTPUT FORMAT - Return ONLY a JSON object: {{"markdown": "<the cleaned-up notes>"}}

LECTURE NOTES:
{markdown}"""


def image_urls(markdown: str) -> Counter:
    """Multiset of image URLs referenced in the Markdown."""
    return Counter(IMAGE_RE.findall(markdown))


def parse_format_response(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"The AI response was not valid JSON: {e}") from e
    markdown = data.get("markdown") if isinstance(data, dict) else None
    if not isinstance(markdown, str) or not markdown.strip():
        raise ValueError("The AI response contained no formatted notes")
    return markdown.strip() + "\n"


async def format_lecture(markdown: str, model_id: str) -> str:
    """Return the formatted notes; raises ValueError if the result is
    unusable (invalid JSON, empty, or images were changed/dropped)."""
    content = await chat_completion_json(
        model_id=model_id,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=build_format_prompt(markdown),
        temperature=0.2,
    )
    formatted = parse_format_response(content)
    if image_urls(formatted) != image_urls(markdown):
        logger.warning("Formatting changed the images of the notes; result discarded")
        raise ValueError(
            "The AI changed or dropped images in your notes, so the result was discarded. "
            "Your notes are unchanged. Try again or pick another model."
        )
    return formatted
