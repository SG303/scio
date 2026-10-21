from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import logging

from app.database import get_db
from app.models import Test, TestConfig, Question, Document, AIModel, Flashcard
from app.schemas.test import (
    TestConfigCreate, TestConfigUpdate, TestConfigResponse,
    TestResponse, TestDetailResponse,
    QuestionResponse, AnswerSubmit, TestResultResponse,
    Choice, GenerateFromTemplateRequest, CreateAndGenerateRequest
)
from app.services.test_generator import generate_test_questions, verify_question_integrity
from app.routers.settings import get_verification_model
from app.services import generation_progress
from app.services.generation_progress import GenerationCancelled
from app.services.subject_materials import ensure_subject_exists, existing_subject_questions


def _progress_reporter(token: Optional[str]):
    """P6.2: build an on_progress callback for a generation token (or None)."""
    if not token:
        return None

    async def report(**kw):
        generation_progress.update(token, status="running", **kw)

    return report


def build_test_response(test: Test, config: Optional[TestConfig]) -> TestResponse:
    """Single place that maps a Test (+ its config) to TestResponse, so
    config-derived fields cannot be forgotten in one of the endpoints."""
    return TestResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=config.title if config else None,
        subject_id=config.subject_id if config else None,
        from_template=bool(config.is_template) if config else False,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at,
    )

router = APIRouter(prefix="/api/tests", tags=["tests"])
logger = logging.getLogger(__name__)


@router.post("/configs", response_model=TestConfigResponse)
async def create_test_config(
    config: TestConfigCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new test configuration"""
    # Validate AI model exists and is enabled
    result = await db.execute(select(AIModel).where(AIModel.id == config.ai_model_id))
    ai_model = result.scalar_one_or_none()
    if not ai_model:
        raise HTTPException(status_code=404, detail="AI model not found")
    if not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Validate documents exist (if any provided) - single query instead of N queries
    if config.document_ids:
        result = await db.execute(
            select(Document.id).where(Document.id.in_(config.document_ids))
        )
        found_ids = set(row[0] for row in result.fetchall())
        missing_ids = set(config.document_ids) - found_ids
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Document(s) not found: {missing_ids}")

    if config.is_template and config.subject_id is not None:
        raise HTTPException(status_code=400, detail="Templates cannot belong to a subject")
    await ensure_subject_exists(db, config.subject_id)
    
    db_config = TestConfig(**config.model_dump())
    db.add(db_config)
    await db.commit()
    await db.refresh(db_config)
    return db_config


@router.get("/configs", response_model=List[TestConfigResponse])
async def list_test_configs(db: AsyncSession = Depends(get_db)):
    """List all test configurations (non-templates)"""
    result = await db.execute(
        select(TestConfig)
        .where(TestConfig.is_template.is_(False))
        .order_by(TestConfig.created_at.desc())
    )
    configs = result.scalars().all()
    return configs


@router.patch("/configs/{config_id}", response_model=TestConfigResponse)
async def update_test_config(
    config_id: int,
    update_data: TestConfigUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Assign or unassign a subject for a (non-template) test config."""
    result = await db.execute(
        select(TestConfig).where(
            TestConfig.id == config_id,
            TestConfig.is_template.is_(False)
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Test configuration not found")

    fields = update_data.model_dump(exclude_unset=True)
    if "subject_id" in fields:
        await ensure_subject_exists(db, fields["subject_id"])
        config.subject_id = fields["subject_id"]

    await db.commit()
    await db.refresh(config)
    return config


@router.delete("/configs/{config_id}")
async def delete_test_config(config_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a (non-template) test config together with all of its tests."""
    result = await db.execute(
        select(TestConfig).where(
            TestConfig.id == config_id,
            TestConfig.is_template.is_(False)
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Test configuration not found")

    await _clear_flashcard_source_for_config(config.id, db)
    await db.delete(config)
    await db.commit()
    return {"message": "Test configuration deleted successfully"}


@router.get("/configs/{config_id}/scores", response_model=List[int])
async def get_config_scores(
    config_id: int, limit: int = 20, db: AsyncSession = Depends(get_db)
):
    """
    P5.1: chronological scores of the last completed tests for a config.
    Used by the frontend to render a score sparkline per template.
    """
    result = await db.execute(
        select(Test.score)
        .where(and_(Test.config_id == config_id, Test.status == "completed"))
        .order_by(Test.completed_at.desc())
        .limit(max(1, min(limit, 100)))
    )
    scores = [s for (s,) in result.all() if s is not None]
    # newest first -> flip to chronological for the sparkline
    return list(reversed(scores))


@router.get("/templates", response_model=List[TestConfigResponse])
async def list_test_templates(db: AsyncSession = Depends(get_db)):
    """List all test templates"""
    result = await db.execute(
        select(TestConfig)
        .where(TestConfig.is_template.is_(True))
        .order_by(TestConfig.created_at.desc())
    )
    templates = result.scalars().all()

    # Tests still attached to a template (legacy "Generate" from the template
    # page) are deleted with it — the UI shows this count before deleting.
    result = await db.execute(
        select(Test.config_id, func.count(Test.id))
        .join(TestConfig, Test.config_id == TestConfig.id)
        .where(TestConfig.is_template.is_(True))
        .group_by(Test.config_id)
    )
    test_count_by_config = dict(result.all())

    response = []
    for template in templates:
        item = TestConfigResponse.model_validate(template)
        item.test_count = test_count_by_config.get(template.id, 0)
        response.append(item)
    return response


@router.get("/templates/{template_id}", response_model=TestConfigResponse)
async def get_test_template(template_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific test template"""
    result = await db.execute(
        select(TestConfig).where(
            TestConfig.id == template_id,
            TestConfig.is_template.is_(True)
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put("/templates/{template_id}", response_model=TestConfigResponse)
async def update_test_template(
    template_id: int,
    config: TestConfigCreate,
    db: AsyncSession = Depends(get_db)
):
    """Update a test template"""
    result = await db.execute(
        select(TestConfig).where(
            TestConfig.id == template_id,
            TestConfig.is_template.is_(True)
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Validate AI model exists and is enabled
    result = await db.execute(select(AIModel).where(AIModel.id == config.ai_model_id))
    ai_model = result.scalar_one_or_none()
    if not ai_model:
        raise HTTPException(status_code=404, detail="AI model not found")
    if not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Validate documents exist (if any provided) - single query instead of N queries
    if config.document_ids:
        result = await db.execute(
            select(Document.id).where(Document.id.in_(config.document_ids))
        )
        found_ids = set(row[0] for row in result.fetchall())
        missing_ids = set(config.document_ids) - found_ids
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Document(s) not found: {missing_ids}")
    
    # Update template fields
    template.title = config.title
    template.num_questions = config.num_questions
    template.num_choices = config.num_choices
    template.ai_model_id = config.ai_model_id
    template.document_ids = config.document_ids
    template.custom_prompt = config.custom_prompt
    
    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/templates/{template_id}")
async def delete_test_template(template_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a test template"""
    result = await db.execute(
        select(TestConfig).where(
            TestConfig.id == template_id,
            TestConfig.is_template.is_(True)
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # With the TestConfig.tests cascade (referential integrity), deleting the
    # template also deletes its tests and questions. Clear the source links
    # before the questions disappear, so flashcards don't keep dangling
    # source_question_id values.
    await _clear_flashcard_source_for_config(template.id, db)

    await db.delete(template)
    await db.commit()
    return {"message": "Template deleted successfully"}


@router.post("/create-and-generate", response_model=TestResponse)
async def create_and_generate_test(
    request: CreateAndGenerateRequest,
    db: AsyncSession = Depends(get_db),
    progress_token: Optional[str] = Query(None),
):
    """P5.2: create a config and generate its first test in one commit.

    The AI generation runs before anything is written, so a failed
    generation leaves no empty config behind.
    """
    # Validate AI model (same rules as POST /configs)
    result = await db.execute(select(AIModel).where(AIModel.id == request.ai_model_id))
    ai_model = result.scalar_one_or_none()
    if not ai_model:
        raise HTTPException(status_code=404, detail="AI model not found")
    if not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model is not enabled")

    # Validate documents (if any provided)
    documents = []
    if request.document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(request.document_ids))
        )
        documents = list(result.scalars().all())
        found_ids = {d.id for d in documents}
        missing_ids = set(request.document_ids) - found_ids
        if missing_ids:
            raise HTTPException(
                status_code=404, detail=f"Document(s) not found: {missing_ids}"
            )

    await ensure_subject_exists(db, request.subject_id)

    # Inside a subject, avoid regenerating questions the subject already has
    # (same dedupe as POST /subjects/{id}/generate-test — saves paid calls)
    existing_questions = (
        await existing_subject_questions(db, request.subject_id)
        if request.subject_id is not None
        else []
    )

    num_questions = (
        request.generate_num_questions
        if request.generate_num_questions is not None
        else request.num_questions
    )

    # AI call first — nothing is persisted if it fails
    if progress_token:
        generation_progress.update(
            progress_token, status="running", stage="Starting generation"
        )
    try:
        questions_data = await generate_test_questions(
            documents=documents,
            num_questions=num_questions,
            num_choices=request.num_choices,
            model_id=ai_model.openrouter_id,
            topic=request.title,
            custom_prompt=request.custom_prompt,
            existing_questions=existing_questions if existing_questions else None,
            on_progress=_progress_reporter(progress_token),
        )
        if progress_token:
            generation_progress.complete(progress_token, len(questions_data), num_questions)
    except GenerationCancelled:
        raise HTTPException(status_code=400, detail="Generation cancelled")
    except ValueError as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        if progress_token:
            generation_progress.fail(progress_token, str(e))
        raise HTTPException(status_code=500, detail=f"Failed to generate test: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        if progress_token:
            generation_progress.fail(progress_token, "Generation failed")
        raise HTTPException(
            status_code=500, detail="Failed to generate test. Please try again."
        )

    # Persist config + test + questions in a single commit
    db_config = TestConfig(
        title=request.title,
        num_questions=request.num_questions,
        num_choices=request.num_choices,
        ai_model_id=request.ai_model_id,
        document_ids=request.document_ids,
        is_template=False,
        custom_prompt=request.custom_prompt,
        subject_id=request.subject_id,
    )
    db.add(db_config)
    await db.flush()

    test = Test(
        config_id=db_config.id,
        status="generated",
        total_questions=len(questions_data),
    )
    db.add(test)
    await db.flush()

    for i, q_data in enumerate(questions_data):
        question = Question(
            test_id=test.id,
            question_number=i + 1,
            question_text=q_data["question"],
            choices=[{"index": j, "text": c} for j, c in enumerate(q_data["choices"])],
            correct_answer=q_data["correct_answer"],
            explanation=q_data.get("explanation", ""),
        )
        db.add(question)

    await db.commit()
    await db.refresh(test)

    return build_test_response(test, db_config)


@router.post("/generate/{config_id}", response_model=TestResponse)
async def generate_test(
    config_id: int,
    request: Optional[GenerateFromTemplateRequest] = Body(default=None),
    db: AsyncSession = Depends(get_db),
    progress_token: Optional[str] = Query(None),
):
    """Generate a new test from a configuration or template"""
    # Get config with AI model
    result = await db.execute(
        select(TestConfig)
        .options(selectinload(TestConfig.ai_model))
        .where(TestConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Test configuration not found")

    # Tests generated here hang on the config; for a template, deleting the
    # template would cascade to them. Templates are used via the create
    # wizard (create-and-generate) instead.
    if config.is_template:
        raise HTTPException(
            status_code=400,
            detail="Templates cannot generate tests directly. Use the template in the Create Test wizard.",
        )
    
    # Validate AI model exists
    if not config.ai_model:
        raise HTTPException(status_code=400, detail="AI model not found for this configuration")
    
    if not config.ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Determine number of questions (allow override for templates)
    num_questions = config.num_questions
    if request is not None and request.num_questions is not None:
        num_questions = request.num_questions
    
    # Get documents (if any) - single query instead of N queries
    documents = []
    if config.document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(config.document_ids))
        )
        documents = list(result.scalars().all())
    
    # Query existing questions from same template to avoid duplicates
    existing_result = await db.execute(
        select(Question.question_text)
        .join(Test, Question.test_id == Test.id)
        .where(Test.config_id == config_id)
    )
    existing_questions = [row[0] for row in existing_result.fetchall()]
    
    # Generate questions using AI
    if progress_token:
        generation_progress.update(
            progress_token, status="running", stage="Starting generation"
        )
    try:
        questions_data = await generate_test_questions(
            documents=documents,
            num_questions=num_questions,
            num_choices=config.num_choices,
            model_id=config.ai_model.openrouter_id,
            topic=config.title,  # Pass title as topic for document-less generation
            custom_prompt=config.custom_prompt,  # Pass custom prompt if set
            existing_questions=existing_questions if existing_questions else None,
            on_progress=_progress_reporter(progress_token),
        )
        if progress_token:
            generation_progress.complete(progress_token, len(questions_data), num_questions)
    except GenerationCancelled:
        raise HTTPException(status_code=400, detail="Generation cancelled")
    except ValueError as e:
        # ValueError typically contains user-friendly messages (e.g., "API key not configured")
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        if progress_token:
            generation_progress.fail(progress_token, str(e))
        raise HTTPException(status_code=500, detail=f"Failed to generate test: {str(e)}")
    except Exception as e:
        # Generic exceptions - log full error but return sanitized message
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        if progress_token:
            generation_progress.fail(progress_token, "Generation failed")
        raise HTTPException(status_code=500, detail="Failed to generate test. Please try again or contact support.")

    # Create test
    test = Test(
        config_id=config.id,
        status="generated",
        total_questions=len(questions_data)
    )
    db.add(test)
    await db.flush()
    
    # Create questions
    for i, q_data in enumerate(questions_data):
        question = Question(
            test_id=test.id,
            question_number=i + 1,
            question_text=q_data["question"],
            choices=[{"index": j, "text": c} for j, c in enumerate(q_data["choices"])],
            correct_answer=q_data["correct_answer"],
            explanation=q_data.get("explanation", "")
        )
        db.add(question)
    
    await db.commit()
    await db.refresh(test)
    
    return build_test_response(test, config)


@router.get("", response_model=List[TestResponse])
async def list_tests(db: AsyncSession = Depends(get_db)):
    """List all tests"""
    result = await db.execute(
        select(Test)
        .options(selectinload(Test.config))
        .order_by(Test.created_at.desc())
    )
    tests = result.scalars().all()
    
    return [build_test_response(t, t.config) for t in tests]


@router.get("/{test_id}", response_model=TestDetailResponse)
async def get_test(test_id: int, db: AsyncSession = Depends(get_db)):
    """Get a test with its questions"""
    result = await db.execute(
        select(Test)
        .options(selectinload(Test.questions), selectinload(Test.config))
        .where(Test.id == test_id)
    )
    test = result.scalar_one_or_none()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Build questions response
    questions = []
    for q in sorted(test.questions, key=lambda x: x.question_number):
        q_response = QuestionResponse(
            id=q.id,
            question_number=q.question_number,
            question_text=q.question_text,
            choices=[Choice(**c) for c in q.choices],
            user_answer=q.user_answer,
            is_correct=q.is_correct,
            # Only show correct answer and explanation if test is completed
            correct_answer=q.correct_answer if test.status == "completed" else None,
            explanation=q.explanation if test.status == "completed" else None
        )
        questions.append(q_response)
    
    return TestDetailResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=test.config.title if test.config else None,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at,
        questions=questions
    )


@router.post("/{test_id}/start", response_model=TestResponse)
async def start_test(test_id: int, db: AsyncSession = Depends(get_db)):
    """Start a test"""
    result = await db.execute(
        select(Test).options(selectinload(Test.config)).where(Test.id == test_id)
    )
    test = result.scalar_one_or_none()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.status != "generated":
        raise HTTPException(status_code=400, detail="Test has already been started")
    
    test.status = "in_progress"
    test.started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(test)
    
    return build_test_response(test, test.config)


@router.post("/{test_id}/answer")
async def submit_answer(
    test_id: int,
    answer: AnswerSubmit,
    db: AsyncSession = Depends(get_db)
):
    """Submit an answer for a question"""
    # Get test
    result = await db.execute(select(Test).where(Test.id == test_id))
    test = result.scalar_one_or_none()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.status != "in_progress":
        raise HTTPException(status_code=400, detail="Test is not in progress")
    
    # Get question
    result = await db.execute(
        select(Question).where(
            Question.id == answer.question_id,
            Question.test_id == test_id
        )
    )
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    # Update answer
    question.user_answer = answer.answer
    question.is_correct = (answer.answer == question.correct_answer)
    
    await db.commit()
    
    return {"message": "Answer submitted", "is_correct": question.is_correct}


@router.post("/{test_id}/submit", response_model=TestResultResponse)
async def submit_test(test_id: int, db: AsyncSession = Depends(get_db)):
    """Submit a test for grading"""
    result = await db.execute(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.id == test_id)
    )
    test = result.scalar_one_or_none()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.status == "completed":
        raise HTTPException(status_code=400, detail="Test has already been submitted")
    
    # Calculate score
    correct = sum(1 for q in test.questions if q.is_correct)
    total = len(test.questions)
    score = int((correct / total) * 100) if total > 0 else 0
    
    # Update test
    test.status = "completed"
    test.completed_at = datetime.now(timezone.utc)
    test.score = score
    test.correct_answers = correct
    
    await db.commit()
    
    # Build response with full question details
    questions = []
    for q in sorted(test.questions, key=lambda x: x.question_number):
        questions.append(QuestionResponse(
            id=q.id,
            question_number=q.question_number,
            question_text=q.question_text,
            choices=[Choice(**c) for c in q.choices],
            user_answer=q.user_answer,
            is_correct=q.is_correct,
            correct_answer=q.correct_answer,
            explanation=q.explanation
        ))
    
    return TestResultResponse(
        test_id=test.id,
        status=test.status,
        score=score,
        total_questions=total,
        correct_answers=correct,
        questions=questions
    )


@router.delete("/{test_id}")
async def delete_test(test_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a test"""
    result = await db.execute(select(Test).where(Test.id == test_id))
    test = result.scalar_one_or_none()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    # Referential integrity: flashcards generated from this test's questions
    # keep a source_question_id; clear it before the questions are deleted,
    # so they don't dangle (foreign_keys=OFF would hide this silently).
    await _clear_flashcard_source_for_test(test_id, db)

    await db.delete(test)
    await db.commit()
    return {"message": "Test deleted successfully"}


async def _clear_flashcard_source_for_test(test_id: int, db: AsyncSession):
    """Bulk-clear Flashcard.source_question_id for one test's questions."""
    await db.execute(
        update(Flashcard)
        .where(
            Flashcard.source_question_id.in_(
                select(Question.id).where(Question.test_id == test_id)
            )
        )
        .values(source_question_id=None)
    )


async def _clear_flashcard_source_for_config(config_id: int, db: AsyncSession):
    """Bulk-clear Flashcard.source_question_id for all of a config's questions."""
    await db.execute(
        update(Flashcard)
        .where(
            Flashcard.source_question_id.in_(
                select(Question.id)
                .join(Test, Question.test_id == Test.id)
                .where(Test.config_id == config_id)
            )
        )
        .values(source_question_id=None)
    )


@router.post("/{test_id}/questions/{question_id}/verify")
async def verify_single_question(
    test_id: int, 
    question_id: int, 
    db: AsyncSession = Depends(get_db)
):
    """Verify a specific question's validity using AI (only allowed after test completion)"""
    
    # 1. Fetch Test and Question
    result = await db.execute(
        select(Question)
        .join(Test, Question.test_id == Test.id)
        .where(
            Question.id == question_id,
            Test.id == test_id
        )
        .options(selectinload(Question.test))
    )
    question = result.scalar_one_or_none()
    
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
        
    # 2. Enforce "Review Phase" Only
    if question.test.status != "completed":
        raise HTTPException(
            status_code=400, 
            detail="Verification is only available after completing the test."
        )

    # 3. Prepare data for the AI
    # Helper to extract text from choices structure
    choices_text = [c["text"] for c in sorted(question.choices, key=lambda x: x["index"])]
    
    try:
        verification_result = await verify_question_integrity(
            question_text=question.question_text,
            choices=choices_text,
            correct_answer_index=question.correct_answer,
            explanation=question.explanation,
            verification_model=await get_verification_model(db)
        )
        
        return verification_result
        
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify question with AI")
