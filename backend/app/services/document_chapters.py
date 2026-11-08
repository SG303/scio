"""Split a large document (e.g. a 1000-page book) into one document per main
chapter, so generations only send the chapters that matter.

A document is read as a list of "units": PDF pages, DOCX blocks (paragraphs
and tables in document order) or text lines. A chapter is a title plus a
1-based start unit; the owner reviews the proposal before anything is stored.

Detection, cheapest first:
1. PDF bookmarks (outline) or DOCX/Markdown headings — free and exact.
2. AI fallback for PDFs without bookmarks: the model only sees the first
   pages (table of contents) and the top line of every page, never the whole
   book, and only returns start pages. The text itself is always cut by the
   server, so the AI can neither rewrite nor lose content.
"""
import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from app.services.openrouter_client import chat_completion_json

logger = logging.getLogger(__name__)

# AI fallback budget: full text of the first pages (they usually hold the
# table of contents) plus the top line of every page (running headers)
TOC_PAGES = 30
TOC_CHARS = 60_000
HEADS_CHARS = 100_000
MAX_HEAD_LEN = 120
MIN_HEAD_LEN = 40

# How far around the AI's page the chapter title is searched (printed page
# numbers are usually smaller than PDF page numbers because of front matter)
SEARCH_BEFORE = 3
SEARCH_AFTER = 40
HEADING_ZONE_CHARS = 400

SYSTEM_PROMPT = (
    "You find the chapter structure of books. Always respond with valid JSON only."
)


@dataclass
class Chapter:
    title: str
    start: int  # 1-based unit (PDF page, DOCX block or text line)


@dataclass
class DocumentUnits:
    kind: str  # "pdf" | "docx" | "text"
    units: List[str]
    # heading level per unit (DOCX/Markdown), None = not a heading
    levels: List[Optional[int]] = field(default_factory=list)
    # PDF bookmarks: top-level chapters
    outline: List[Chapter] = field(default_factory=list)


# ============== Loading ==============

_pdf_cache: Dict[Tuple[str, int, int], Tuple[List[str], List[Chapter]]] = {}


def _read_pdf(path: str) -> Tuple[List[str], List[Chapter]]:
    """Page texts and top-level bookmarks. The last PDF is cached: detection
    and splitting read the same (possibly very large) book back to back."""
    stat = os.stat(path)
    key = (path, stat.st_mtime_ns, stat.st_size)
    if key in _pdf_cache:
        return _pdf_cache[key]

    from pypdf import PdfReader

    reader = PdfReader(path)
    pages = []
    for index, page in enumerate(reader.pages):
        try:
            pages.append(page.extract_text() or "")
        except Exception as e:  # one broken page must not stop the split
            logger.warning("Could not read text of PDF page %s: %s", index + 1, e)
            pages.append("")

    outline: List[Chapter] = []
    try:
        outline = _top_level_outline(reader, reader.outline)
    except Exception as e:
        logger.warning("Could not read PDF bookmarks: %s", e)

    _pdf_cache.clear()
    _pdf_cache[key] = (pages, outline)
    return pages, outline


def _top_level_outline(reader, items) -> List[Chapter]:
    """Top-level bookmarks. A single top-level entry (book title wrapping
    everything) is skipped in favour of its children."""
    entries = []  # (title, page, children)
    for item in items:
        if isinstance(item, list):
            if entries:
                entries[-1] = (entries[-1][0], entries[-1][1], item)
            continue
        page = reader.get_destination_page_number(item)
        title = str(getattr(item, "title", "") or "").strip()
        entries.append((title, page, []))

    if len(entries) == 1 and entries[0][2]:
        return _top_level_outline(reader, entries[0][2])

    chapters = [
        Chapter(title=title, start=page + 1)
        for title, page, _ in entries
        if title and page is not None and page >= 0
    ]
    return _ordered(chapters)


def _read_docx(path: str) -> Tuple[List[str], List[Optional[int]]]:
    """Body blocks in document order (tables stay inside their chapter)."""
    from docx import Document as DocxDocument
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = DocxDocument(path)
    units: List[str] = []
    levels: List[Optional[int]] = []
    for element in doc.element.body.iterchildren():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = Paragraph(element, doc)
            units.append(paragraph.text)
            style = paragraph.style.name if paragraph.style is not None else ""
            match = re.fullmatch(r"Heading (\d)", style or "")
            levels.append(int(match.group(1)) if match and paragraph.text.strip() else None)
        elif tag == "tbl":
            rows = []
            for row in Table(element, doc).rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
            units.append("\n".join(rows))
            levels.append(None)
    return units, levels


def _read_text(content: str) -> Tuple[List[str], List[Optional[int]]]:
    """Lines with their Markdown heading level (ignoring code blocks)."""
    lines = content.split("\n")
    levels: List[Optional[int]] = []
    in_code = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_code = not in_code
            levels.append(None)
            continue
        match = None if in_code else re.match(r"^(#{1,6})\s+\S", line)
        levels.append(len(match.group(1)) if match else None)
    return lines, levels


def _load_units_sync(file_path: Optional[str], content: Optional[str]) -> DocumentUnits:
    ext = os.path.splitext(file_path)[1].lower() if file_path else ""
    if file_path and os.path.exists(file_path):
        if ext == ".pdf":
            pages, outline = _read_pdf(file_path)
            return DocumentUnits(kind="pdf", units=pages, outline=outline)
        if ext == ".docx":
            units, levels = _read_docx(file_path)
            return DocumentUnits(kind="docx", units=units, levels=levels)
    units, levels = _read_text(content or "")
    return DocumentUnits(kind="text", units=units, levels=levels)


async def load_units(file_path: Optional[str], content: Optional[str]) -> DocumentUnits:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _load_units_sync, file_path, content)


# ============== Detection without AI ==============


def detect_chapters(source: DocumentUnits) -> Tuple[str, List[Chapter]]:
    """("outline" | "headings" | "none", chapters). At least two chapters,
    otherwise there is nothing to split."""
    if source.kind == "pdf":
        if len(source.outline) >= 2:
            return "outline", source.outline
        return "none", []

    for level in (1, 2):
        chapters = [
            Chapter(title=_clean_heading(source.units[i]), start=i + 1)
            for i, unit_level in enumerate(source.levels)
            if unit_level == level
        ]
        if len(chapters) >= 2:
            return "headings", chapters
    return "none", []


def _clean_heading(text: str) -> str:
    return re.sub(r"^#{1,6}\s+", "", text.strip())[:255]


# ============== AI fallback (PDF only) ==============


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_ai_prompt(pages: List[str]) -> str:
    total = len(pages)
    front, used = [], 0
    for number, text in enumerate(pages[:TOC_PAGES], start=1):
        if used >= TOC_CHARS:
            break
        chunk = text[: TOC_CHARS - used]
        used += len(chunk)
        front.append(f"=== PDF page {number} ===\n{chunk}")

    head_len = max(MIN_HEAD_LEN, min(MAX_HEAD_LEN, HEADS_CHARS // max(total, 1)))
    heads = "\n".join(
        f"[{number}] {_collapse(text)[:head_len]}" for number, text in enumerate(pages, start=1)
    )

    return f"""This book PDF has {total} pages. Find where each MAIN chapter starts.

PART A contains the full text of the first pages (usually the table of contents).
PART B contains the first characters of EVERY page, prefixed with its PDF page number in brackets. Chapter start pages and running headers show up there.

RULES:
- Only top-level chapters. No sections or subsections.
- List every appendix and every glossary as its own entry: they are study material.
- Skip cover, title page, table of contents, index and bibliography.
- "pdf_page" is the PDF page number from the brackets in PART B, NOT the printed page number from the table of contents. Printed numbers are usually smaller because of the front matter; use PART B to find the page where the chapter really starts.
- Use the chapter titles as written in the book.
- List the chapters in book order.

OUTPUT FORMAT - Return ONLY a JSON object:
{{"chapters": [{{"title": "Chapter 1: Introduction", "pdf_page": 15}}]}}

PART A - FIRST PAGES:
{chr(10).join(front)}

PART B - FIRST CHARACTERS OF EVERY PAGE:
{heads}"""


def parse_ai_response(content: str, page_count: int) -> List[Chapter]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"The AI response was not valid JSON: {e}") from e

    items = data.get("chapters") if isinstance(data, dict) else None
    chapters = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        try:
            page = int(item.get("pdf_page"))
        except (TypeError, ValueError):
            continue
        if isinstance(title, str) and title.strip() and 1 <= page <= page_count:
            chapters.append(Chapter(title=title.strip()[:255], start=page))
    return chapters


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", text.lower()).split())


def _is_toc_page(page_text: str, titles: List[str]) -> bool:
    """A table-of-contents page mentions several chapter titles at once."""
    if len(titles) < 2:
        return False
    text = _norm(page_text)
    return sum(1 for title in titles if title and title in text) >= min(3, len(titles))


def locate_chapters(chapters: List[Chapter], pages: List[str]) -> List[Chapter]:
    """Move each AI start page to the page whose top shows the chapter title.

    Guards against the AI using printed instead of PDF page numbers. A title
    that cannot be found keeps the AI's page; the owner checks the preview.
    """
    titles = [_norm(c.title)[:60] for c in chapters]
    located = []
    for chapter, needle in zip(chapters, titles):
        start = chapter.start
        if len(needle) >= 4:
            candidates = [start] + list(
                range(max(1, start - SEARCH_BEFORE), min(len(pages), start + SEARCH_AFTER) + 1)
            )
            for page in candidates:
                text = pages[page - 1]
                if needle in _norm(text[:HEADING_ZONE_CHARS]) and not _is_toc_page(text, titles):
                    start = page
                    break
        located.append(Chapter(title=chapter.title, start=start))
    return _ordered(located)


def _ordered(chapters: List[Chapter]) -> List[Chapter]:
    """Book order, one chapter per start unit."""
    seen, result = set(), []
    for chapter in sorted(chapters, key=lambda c: c.start):
        if chapter.start not in seen:
            seen.add(chapter.start)
            result.append(chapter)
    return result


async def detect_chapters_with_ai(pages: List[str], model_id: str) -> List[Chapter]:
    """Raises ValueError if the AI found no usable chapters."""
    content = await chat_completion_json(
        model_id=model_id,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=build_ai_prompt(pages),
        temperature=0.1,
    )
    chapters = locate_chapters(parse_ai_response(content, len(pages)), pages)
    if not chapters:
        raise ValueError("The AI could not find any chapters in this document.")
    return chapters


# ============== Splitting ==============


def chapter_text(source: DocumentUnits, start: int, end: int) -> str:
    """Text of units start..end (1-based, inclusive)."""
    units = source.units[start - 1 : end]
    if source.kind == "text":
        return "\n".join(units).strip()
    return "\n\n".join(u.strip() for u in units if u.strip())
