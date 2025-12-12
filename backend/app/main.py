import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import os

from app.database import init_db, async_session
from app.routers import documents, ai_models, tests, flashcards, subjects
from app.routers.ai_models import seed_default_models
from app.config import get_settings
from app.migrations.add_template_fields import migrate as migrate_template_fields
from app.migrations.add_flashcard_tables import migrate as migrate_flashcard_tables
from app.migrations.add_subjects_table import migrate as migrate_subjects_table

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    
    # Run migrations to add any missing columns/tables
    migrate_template_fields()
    migrate_flashcard_tables()
    migrate_subjects_table()
    
    # Seed default AI models
    async with async_session() as db:
        await seed_default_models(db)
    
    yield
    # Shutdown (nothing to clean up)


app = FastAPI(
    title=settings.app_name,
    description="Your AI Learning Hub - Generate practice tests, create flashcards, and organize your learning journey",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware - configurable via ALLOWED_ORIGINS env var
# Parse comma-separated origins, or allow all if "*" is specified
cors_origins = [
    origin.strip() 
    for origin in settings.allowed_origins.split(",") 
    if origin.strip()
]
# If "*" is in the list or list is empty, allow all origins (development mode)
if "*" in cors_origins or not cors_origins:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True if cors_origins != ["*"] else False,  # credentials require specific origins
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(documents.router)
app.include_router(ai_models.router)
app.include_router(tests.router)
app.include_router(flashcards.router)
app.include_router(subjects.router)


# Health check endpoint
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app": settings.app_name}


# Serve frontend static files in production
# The frontend build will be copied to /app/static
static_dir = "/app/static"
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=f"{static_dir}/assets"), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # API routes are handled by routers above
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
        
        # Try to serve static files from root (favicon, logo, etc.)
        file_path = f"{static_dir}/{full_path}"
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Serve index.html for all other routes (SPA routing)
        index_path = f"{static_dir}/index.html"
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"detail": "Frontend not found"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

