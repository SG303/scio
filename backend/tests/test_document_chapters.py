"""Splitting a large document into one document per main chapter.

- Free detection first: PDF bookmarks, DOCX/Markdown headings.
- AI fallback (PDF only) sees the first pages and page tops, returns start
  pages only; the server corrects printed-vs-PDF page numbers.
- Splitting keeps the book, creates chapter documents in one commit and
  never stores anything for an invalid request.
- Deleting a book deletes its chapters and scrubs all references.
"""

import io
import json
import sqlite3

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.migrations.add_document_chapters import migrate
from app.routers import documents as documents_router
from app.schemas.document import ChapterDetectRequest, ChapterRange, ChapterSplitRequest
from app.services import document_chapters
from app.services.document_chapters import Chapter, DocumentUnits


def make_pdf(page_texts, outline=()):
    """PDF with one text line per '\\n' on each page plus top-level bookmarks
    given as (title, 0-based page index) or (title, index, [children])."""
    writer = PdfWriter()
    font = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
    )
    for text in page_texts:
        writer.add_blank_page(612, 792)
        page = writer.pages[-1]
        ops = " ".join(f"({line}) Tj T*" for line in text.split("\n"))
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 72 720 Td 14 TL {ops} ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
    for entry in outline:
        parent = writer.add_outline_item(entry[0], entry[1])
        for child_title, child_page in entry[2] if len(entry) > 2 else []:
            writer.add_outline_item(child_title, child_page, parent=parent)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


BOOK_PAGES = [
    "Contents\nChapter 1 Basics 1\nChapter 2 Networks 3",
    "Chapter 1 Basics\nAtoms are small",
    "Basics continued",
    "Chapter 2 Networks\nRouters forward packets",
    "Index\nAtoms 2",
]


@pytest.fixture
def book_pdf(tmp_path):
    path = tmp_path / "book.pdf"
    path.write_bytes(make_pdf(BOOK_PAGES, [("Chapter 1 Basics", 1), ("Chapter 2 Networks", 3)]))
    return str(path)


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            session.add(models.AIModel(name="Test", openrouter_id="test/model"))
            await session.commit()
            yield session
    finally:
        await engine.dispose()


async def _add_document(db, **fields):
    document = models.Document(title="Book", doc_type="study_guide", **fields)
    db.add(document)
    await db.commit()
    return document


async def _documents(db):
    return (await db.execute(select(models.Document).order_by(models.Document.id))).scalars().all()


# ============== Free detection ==============


async def test_pdf_bookmarks_are_the_chapters(book_pdf):
    source = await document_chapters.load_units(book_pdf, None)

    method, chapters = document_chapters.detect_chapters(source)

    assert source.kind == "pdf" and len(source.units) == 5
    assert method == "outline"
    assert chapters == [Chapter("Chapter 1 Basics", 2), Chapter("Chapter 2 Networks", 4)]


async def test_single_wrapping_bookmark_uses_its_children(tmp_path):
    path = tmp_path / "wrapped.pdf"
    path.write_bytes(make_pdf(BOOK_PAGES, [("My Book", 0, [("One", 1), ("Two", 3)])]))

    _, chapters = document_chapters.detect_chapters(
        await document_chapters.load_units(str(path), None)
    )

    assert [c.title for c in chapters] == ["One", "Two"]


async def test_pdf_without_bookmarks_finds_nothing_for_free(tmp_path):
    path = tmp_path / "plain.pdf"
    path.write_bytes(make_pdf(BOOK_PAGES))

    assert document_chapters.detect_chapters(
        await document_chapters.load_units(str(path), None)
    ) == ("none", [])


def test_markdown_h1_headings_outside_code_blocks():
    content = "# One\ntext\n```\n# not a heading\n```\n# Two\nmore"
    source = DocumentUnits("text", *document_chapters._read_text(content))

    method, chapters = document_chapters.detect_chapters(source)

    assert method == "headings"
    assert chapters == [Chapter("One", 1), Chapter("Two", 6)]
    assert document_chapters.chapter_text(source, 1, 5) == "# One\ntext\n```\n# not a heading\n```"


def test_markdown_falls_back_to_h2_when_only_one_h1():
    content = "# Book\n## A\nx\n## B\ny"
    _, chapters = document_chapters.detect_chapters(
        DocumentUnits("text", *document_chapters._read_text(content))
    )
    assert [c.title for c in chapters] == ["A", "B"]


async def test_docx_heading_1_with_table_staying_in_its_chapter(tmp_path):
    from docx import Document as DocxDocument

    docx = DocxDocument()
    docx.add_heading("Chapter A", level=1)
    docx.add_paragraph("Alpha text")
    table = docx.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Key"
    table.rows[0].cells[1].text = "Value"
    docx.add_heading("Chapter B", level=1)
    docx.add_paragraph("Beta text")
    path = tmp_path / "notes.docx"
    docx.save(path)

    source = await document_chapters.load_units(str(path), None)
    method, chapters = document_chapters.detect_chapters(source)

    assert method == "headings"
    assert [c.title for c in chapters] == ["Chapter A", "Chapter B"]
    first = document_chapters.chapter_text(source, chapters[0].start, chapters[1].start - 1)
    assert first == "Chapter A\n\nAlpha text\n\nKey | Value"


# ============== AI fallback ==============


def test_ai_prompt_sends_front_pages_and_page_tops_only():
    pages = [f"top of page {i}\n" + "body " * 50 + f"SECRET{i}" for i in range(1, 101)]

    prompt = document_chapters.build_ai_prompt(pages)

    assert "This book PDF has 100 pages" in prompt
    assert "[100] top of page 100" in prompt
    assert "SECRET30" in prompt  # first pages in full (table of contents)
    assert "SECRET31" not in prompt  # later pages: only their top line
    assert "NOT the printed page number" in prompt
    assert "every glossary as its own entry" in prompt


def test_ai_response_drops_unusable_entries():
    response = json.dumps(
        {
            "chapters": [
                {"title": "Good", "pdf_page": 3},
                {"title": "Page as text", "pdf_page": "5"},
                {"title": "Out of range", "pdf_page": 99},
                {"title": "", "pdf_page": 4},
                {"title": "No page"},
                "garbage",
            ]
        }
    )

    assert document_chapters.parse_ai_response(response, 10) == [
        Chapter("Good", 3),
        Chapter("Page as text", 5),
    ]


def test_ai_response_that_is_not_json_raises():
    with pytest.raises(ValueError):
        document_chapters.parse_ai_response("not json", 10)


def test_ai_response_without_chapter_list_finds_nothing():
    assert document_chapters.parse_ai_response(json.dumps(["x"]), 10) == []


def test_printed_page_numbers_are_moved_to_the_real_page():
    pages = ["Contents\nOrigins 1\nGrowth 3\nDecline 5", "Preface", "Preface"] + [
        "1 Origins\nx",
        "",
        "2 Growth\ny",
        "",
        "3: Decline\nz",
    ]
    # the AI used the printed numbers from the table of contents
    ai = [Chapter("Origins", 1), Chapter("Growth", 3), Chapter("Decline", 5)]

    located = document_chapters.locate_chapters(ai, pages)

    # the contents page (page 1) mentions all titles and is skipped
    assert located == [Chapter("Origins", 4), Chapter("Growth", 6), Chapter("Decline", 8)]


def test_unfindable_title_keeps_the_ai_page():
    located = document_chapters.locate_chapters([Chapter("Nowhere to be seen", 2)], ["a", "b", "c"])
    assert located == [Chapter("Nowhere to be seen", 2)]


# ============== Endpoints ==============


async def test_detect_proposes_bookmarks_without_storing(db, book_pdf):
    book = await _add_document(db, file_path=book_pdf, content="x")

    proposal = await documents_router.detect_chapters(book.id, ChapterDetectRequest(), db)

    assert proposal.method == "outline" and proposal.unit == "page"
    assert proposal.unit_count == 5 and proposal.ai_available
    assert [(c.title, c.start) for c in proposal.chapters] == [
        ("Chapter 1 Basics", 2),
        ("Chapter 2 Networks", 4),
    ]
    assert len(await _documents(db)) == 1


async def test_split_creates_chapters_and_keeps_the_book(db, book_pdf):
    book = await _add_document(db, file_path=book_pdf, content="x")
    request = ChapterSplitRequest(
        chapters=[
            ChapterRange(title="Chapter 1 Basics", start=2, end=3),
            ChapterRange(title="Chapter 2 Networks", start=4, end=4),
        ]
    )

    created = await documents_router.split_into_chapters(book.id, request, db)

    assert [(c.title, c.page_start, c.page_end) for c in created] == [
        ("Chapter 1 Basics", 2, 3),
        ("Chapter 2 Networks", 4, 4),
    ]
    assert all(c.parent_document_id == book.id and c.doc_type == "study_guide" for c in created)
    assert created[0].content == "Chapter 1 Basics\nAtoms are small\n\nBasics continued"
    assert "Index" not in created[1].content  # deselected back matter stays out
    assert len(await _documents(db)) == 3  # the book is kept


async def test_a_book_is_split_only_once_and_chapters_not_again(db, book_pdf):
    book = await _add_document(db, file_path=book_pdf, content="x")
    request = ChapterSplitRequest(chapters=[ChapterRange(title="All", start=1, end=5)])
    [chapter] = await documents_router.split_into_chapters(book.id, request, db)

    with pytest.raises(HTTPException) as again:
        await documents_router.detect_chapters(book.id, ChapterDetectRequest(), db)
    with pytest.raises(HTTPException) as nested:
        await documents_router.split_into_chapters(chapter.id, request, db)

    assert again.value.status_code == 409
    assert nested.value.status_code == 400


async def test_invalid_range_stores_nothing(db, book_pdf):
    book = await _add_document(db, file_path=book_pdf, content="x")
    request = ChapterSplitRequest(
        chapters=[
            ChapterRange(title="Fine", start=1, end=2),
            ChapterRange(title="Too far", start=3, end=6),
        ]
    )

    with pytest.raises(HTTPException) as error:
        await documents_router.split_into_chapters(book.id, request, db)

    assert error.value.status_code == 400 and "Too far" in error.value.detail
    assert len(await _documents(db)) == 1


async def test_ai_detection_for_a_pdf_without_bookmarks(db, tmp_path, monkeypatch):
    path = tmp_path / "plain.pdf"
    path.write_bytes(make_pdf(BOOK_PAGES))
    book = await _add_document(db, file_path=str(path), content="x")

    async def fake_completion(**kwargs):
        return json.dumps(
            {
                "chapters": [
                    {"title": "Chapter 1 Basics", "pdf_page": 1},  # printed number
                    {"title": "Chapter 2 Networks", "pdf_page": 4},
                ]
            }
        )

    monkeypatch.setattr(document_chapters, "chat_completion_json", fake_completion)

    free = await documents_router.detect_chapters(book.id, ChapterDetectRequest(), db)
    proposal = await documents_router.detect_chapters(
        book.id, ChapterDetectRequest(ai_model_id=1), db
    )

    assert free.method == "none" and free.ai_available
    assert free.ai_input_tokens and free.ai_input_tokens > 0
    assert proposal.method == "ai"
    assert [(c.title, c.start) for c in proposal.chapters] == [
        ("Chapter 1 Basics", 2),
        ("Chapter 2 Networks", 4),
    ]


async def test_failed_ai_detection_reports_an_error(db, tmp_path, monkeypatch):
    path = tmp_path / "plain.pdf"
    path.write_bytes(make_pdf(BOOK_PAGES))
    book = await _add_document(db, file_path=str(path), content="x")

    async def fake_completion(**kwargs):
        return json.dumps({"chapters": []})

    monkeypatch.setattr(document_chapters, "chat_completion_json", fake_completion)

    with pytest.raises(HTTPException) as error:
        await documents_router.detect_chapters(book.id, ChapterDetectRequest(ai_model_id=1), db)

    assert error.value.status_code == 500 and "could not find any chapters" in error.value.detail


async def test_ai_detection_is_pdf_only(db):
    notes = await _add_document(db, content="just text")

    with pytest.raises(HTTPException) as error:
        await documents_router.detect_chapters(notes.id, ChapterDetectRequest(ai_model_id=1), db)

    assert error.value.status_code == 400


async def test_deleting_a_book_deletes_its_chapters_and_references(db, book_pdf):
    book = await _add_document(db, file_path=book_pdf, content="x")
    request = ChapterSplitRequest(chapters=[ChapterRange(title="One", start=2, end=3)])
    [chapter] = await documents_router.split_into_chapters(book.id, request, db)
    other = await _add_document(db, content="other")
    subject = models.Subject(title="S", ai_model_id=1, document_ids=[chapter.id, other.id])
    db.add(subject)
    await db.commit()

    await documents_router.delete_document(book.id, db)

    assert [d.id for d in await _documents(db)] == [other.id]
    await db.refresh(subject)
    assert subject.document_ids == [other.id]


def test_migration_adds_chapter_columns_idempotently(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT)")
    conn.commit()
    conn.close()

    migrate(str(path))
    migrate(str(path))

    conn = sqlite3.connect(path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(documents)")}
    conn.close()
    assert {"parent_document_id", "page_start", "page_end"} <= columns
