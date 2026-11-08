import asyncio
import logging
import sys
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import async_session, init_db
from app.migrations.add_document_chapters import migrate as migrate_document_chapters
from app.migrations.add_flashcard_tables import migrate as migrate_flashcard_tables
from app.migrations.add_language_columns import migrate as migrate_language_columns
from app.migrations.add_lecture_formatting import migrate as migrate_lecture_formatting
from app.migrations.add_lecture_sources import migrate as migrate_lecture_sources
from app.migrations.add_subjects_table import migrate as migrate_subjects_table
from app.migrations.add_template_fields import migrate as migrate_template_fields
from app.routers import (
    ai_models,
    documents,
    flashcards,
    generation,
    lectures,
    providers,
    subjects,
    tests,
)
from app.routers.ai_models import seed_default_models
from app.routers.settings import router as settings_router
from app.services import claude_cli, db_backup

settings = get_settings()


async def _backup_loop():
    """Run one backup ~60s after startup, then every 24h. Each cycle
    logs its result; a failed cycle never stops the loop."""
    await asyncio.sleep(db_backup.FIRST_BACKUP_DELAY_SECONDS)
    while True:
        await db_backup.run_backup_cycle(settings.database_path)
        await asyncio.sleep(db_backup.BACKUP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()

    # Run migrations to add any missing columns/tables
    migrate_template_fields()
    migrate_flashcard_tables()
    migrate_subjects_table()
    migrate_lecture_formatting()
    migrate_lecture_sources()
    migrate_language_columns()
    migrate_document_chapters()

    # Seed default AI models
    async with async_session() as db:
        await seed_default_models(db)

    backup_task = asyncio.create_task(_backup_loop())
    try:
        yield
    finally:
        # Shutdown: stop the backup scheduler cleanly
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass
        await claude_cli.shutdown()


app = FastAPI(
    title=settings.app_name,
    description="Your AI Learning Hub - Generate practice tests, create flashcards, and organize your learning journey",
    version=Path(__file__).with_name("VERSION").read_text().strip(),
    lifespan=lifespan,
)

# CORS middleware - configurable via ALLOWED_ORIGINS env var
# Parse comma-separated origins, or allow all if "*" is specified
cors_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
# If "*" is in the list or list is empty, allow all origins (development mode)
if "*" in cors_origins or not cors_origins:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_origins != ["*"],  # credentials require specific origins
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def protect_mutations(request: Request, call_next):
    """CORS alone does not block cross-origin form submissions."""
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        same_origin = str(request.base_url).rstrip("/")
        if (
            origin is not None
            and origin != same_origin
            and origin not in [o for o in cors_origins if o != "*"]
        ) or (origin is None and request.headers.get("sec-fetch-site") == "cross-site"):
            return JSONResponse(
                status_code=403, content={"detail": "Cross-origin writes are not allowed"}
            )
    return await call_next(request)


# Include API routers
app.include_router(documents.router)
app.include_router(ai_models.router)
app.include_router(tests.router)
app.include_router(flashcards.router)
app.include_router(subjects.router)
app.include_router(lectures.router)
app.include_router(settings_router)
app.include_router(providers.router)
# P6.2: progress polling for long-running AI generations
app.include_router(generation.router)


# Health check endpoint
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app": settings.app_name}


# Registered after all real API routes so those keep matching first.
@app.api_route("/api/{rest_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_fallback(rest_path: str) -> None:
    # unknown /api/* paths must return a real 404 instead of falling
    # through to the SPA catch-all below (which returns HTTP 200)
    raise HTTPException(status_code=404, detail="Not Found")


# Serve frontend static files in production
# The frontend build will be copied to /app/static
static_dir = "/app/static"
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=f"{static_dir}/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # P5.3b: path-traversal guard — only serve files that really live
        # inside the static directory (blocks ../ escapes and absolute paths)
        file_path = os.path.realpath(os.path.join(static_dir, full_path))
        static_root = os.path.realpath(static_dir)
        if os.path.commonpath([static_root, file_path]) != static_root:
            raise HTTPException(status_code=404, detail="Not Found")

        if os.path.isfile(file_path):
            return FileResponse(file_path)

        # Serve index.html for all other routes (SPA routing)
        index_path = f"{static_dir}/index.html"
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend not found")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
