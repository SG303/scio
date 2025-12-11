from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import logging

from app.database import get_db
from app.models import Test, TestConfig, Question, Document, AIModel
from app.schemas.test import (
    TestConfigCreate, TestConfigResponse,
    TestResponse, TestDetailResponse,
    QuestionResponse, AnswerSubmit, TestResultResponse,
    Choice, GenerateFromTemplateRequest
)
from app.services.test_generator import generate_test_questions, verify_question_integrity

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


@router.get("/templates", response_model=List[TestConfigResponse])
async def list_test_templates(db: AsyncSession = Depends(get_db)):
    """List all test templates"""
    result = await db.execute(
        select(TestConfig)
        .where(TestConfig.is_template.is_(True))
        .order_by(TestConfig.created_at.desc())
    )
    templates = result.scalars().all()
    return templates


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
    
    await db.delete(template)
    await db.commit()
    return {"message": "Template deleted successfully"}


@router.post("/generate/{config_id}", response_model=TestResponse)
async def generate_test(
    config_id: int,
    request: Optional[GenerateFromTemplateRequest] = Body(default=None),
    db: AsyncSession = Depends(get_db)
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
        select(Question)
        .join(Test, Question.test_id == Test.id)
        .where(Test.config_id == config_id)
    )
    existing_questions = [q.question_text for q in existing_result.scalars().all()]
    
    # Generate questions using AI
    try:
        questions_data = await generate_test_questions(
            documents=documents,
            num_questions=num_questions,
            num_choices=config.num_choices,
            model_id=config.ai_model.openrouter_id,
            topic=config.title,  # Pass title as topic for document-less generation
            custom_prompt=config.custom_prompt,  # Pass custom prompt if set
            existing_questions=existing_questions if existing_questions else None
        )
    except ValueError as e:
        # ValueError typically contains user-friendly messages (e.g., "API key not configured")
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate test: {str(e)}")
    except Exception as e:
        # Generic exceptions - log full error but return sanitized message
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
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
    
    return TestResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=config.title,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at
    )


@router.get("", response_model=List[TestResponse])
async def list_tests(db: AsyncSession = Depends(get_db)):
    """List all tests"""
    result = await db.execute(
        select(Test)
        .options(selectinload(Test.config))
        .order_by(Test.created_at.desc())
    )
    tests = result.scalars().all()
    
    return [
        TestResponse(
            id=t.id,
            config_id=t.config_id,
            config_title=t.config.title if t.config else None,
            status=t.status,
            started_at=t.started_at,
            completed_at=t.completed_at,
            score=t.score,
            total_questions=t.total_questions,
            correct_answers=t.correct_answers,
            created_at=t.created_at
        )
        for t in tests
    ]


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
    
    return TestResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=test.config.title if test.config else None,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at
    )


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
    
    await db.delete(test)
    await db.commit()
    return {"message": "Test deleted successfully"}


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
            explanation=question.explanation
        )
        
        return verification_result
        
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify question with AI")
