# Scio

Your AI Learning Hub. Upload study materials, generate practice tests, create flashcards, and organize your learning journey with AI-powered tools.

![Scio](https://img.shields.io/badge/AI-Powered-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![Python](https://img.shields.io/badge/Python-3.11-green)
![React](https://img.shields.io/badge/React-18-blue)

## Features

- 📚 **Document Management** - Upload PDFs, DOCX, TXT, or paste text directly
- 🤖 **Multiple AI Models** - Choose from GPT-6.1, Claude, Gemini and more via OpenRouter
- 📝 **Practice Tests** - Generate customizable tests with AI-powered questions
- 🎴 **Flashcards** - Create and study flashcards with spaced repetition
- 📁 **Subject Organization** - Organize your learning materials by subject
- 📊 **Progress Tracking** - Track your learning progress and performance
- 🌗 **Light/Dark Theme** - Follows your system setting by default, with a Sun/Moon toggle
- 💾 **Automatic Backups** - Daily snapshot backups of the database, keep 14
- 🐳 **Single Container** - Easy deployment with Docker

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenRouter API key ([Get one here](https://openrouter.ai/keys))

### 1. Clone and Configure

```bash
# Clone the repository
git clone <your-repo-url>
cd scio

# Copy Docker Compose template
cp docker-compose.yml.template docker-compose.yml

# Create environment file
cp env.example .env

# Edit .env and add your OpenRouter API key
nano .env
```

### 2. Run with Docker

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f
```

### 3. Access the App

Open [http://localhost:8001](http://localhost:8001) in your browser.

## Usage

### 1. Add Study Materials

Navigate to **Documents** and upload your study materials:
- **Exam Objectives** - Official exam topics and requirements
- **Study Guides** - Notes, textbooks, course materials
- **Example Questions** - Sample questions with answers

Supported formats: PDF, DOCX, TXT, Markdown

### 2. Configure AI Models

Go to **AI Models** to enable/disable models or add new ones. Default models include:
- GPT-6.1 Sol
- Claude Sonnet 5.5
- Gemini 3.8 Flash
- Claude Haiku 5.5
- MiMo V2.6 Pro

### 3. Create a Test

Click **Create Test** and:
1. Select which documents to use as context
2. Choose the AI model
3. Set number of questions (1-100, default 10)
4. Set number of choices (2-10, default 4)
5. Generate!

You'll see live progress while the AI generates; you can cancel long-running generations.

### 4. Take the Test

- Answer questions at your own pace
- Navigate freely between questions
- Submit when ready

### 5. Review Results

After submission, see:
- Your score and performance summary
- Each question with correct/incorrect indicators
- AI-generated explanations for answers

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (only needed for AI generation) | Yes |
| `DEBUG` | Enable debug mode (default: false) | No |
| `APP_NAME` | App display name (default: "Scio") | No |

### Data Persistence

The app stores data in two directories (mounted as Docker volumes):
- `./data/` - SQLite database + automatic backups
- `./uploads/` - Uploaded document files

### Backups

The app creates automatic daily backups of the database (about a minute after
startup, then every 24 hours) into `data/backups/`. Each backup is a consistent
snapshot named `scio-backup-YYYYMMDD-HHMMSS.db`, verified with an integrity
check, and the 14 most recent backups are kept. You can also trigger a backup
any time via the Settings page or `POST /api/settings/backups`
(`GET /api/settings/backups` lists them).

To backup your data manually:
```bash
# Stop the container
docker compose down

# Copy data directories
cp -r data/ backup/data/
cp -r uploads/ backup/uploads/
```

## Development

### Local Development Setup

```bash
# Backend (dependencies installed directly into your environment)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Backend tests (extra dev dependencies)
pip install -r requirements-dev.txt
pytest

# Frontend (in another terminal)
cd frontend
npm install
npm run dev        # Vite dev server on port 5173, API proxied to port 8000
npm test           # Vitest unit tests
npm run typecheck
npm run lint
```

### Project Structure

```
scio/
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml.template  # Docker Compose template
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py         # FastAPI application
│       ├── models.py       # Database models
│       ├── routers/        # API endpoints
│       ├── services/       # Business logic
│       └── schemas/        # Pydantic schemas
└── frontend/
    ├── package.json
    └── src/
        ├── App.tsx
        ├── pages/          # Page components
        ├── components/     # UI components
        └── services/       # API client
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/documents` | GET, POST | List / create documents |
| `/api/documents/{id}` | GET, PUT, DELETE | Get / update / delete a document |
| `/api/documents/upload` | POST | Upload a document file (PDF, DOCX, TXT, MD) |
| `/api/models` | GET, POST | List / create AI models (`?enabled_only=true`) |
| `/api/models/{id}` | GET, PUT, DELETE | Get / update / delete an AI model (delete refused with 409 while still referenced by a config, deck or subject) |
| `/api/settings` | GET, PUT | Get / update app settings |
| `/api/settings/backups` | GET, POST | List database backups / create a backup now |
| `/api/tests/configs` | GET, POST | List / create test configs |
| `/api/tests/configs/{id}/scores` | GET | Score history for a config |
| `/api/tests/templates` | GET | List test templates |
| `/api/tests/templates/{id}` | GET, PUT, DELETE | Get / update / delete a template |
| `/api/tests/create-and-generate` | POST | Create a config and generate the test in one call |
| `/api/tests/generate/{config_id}` | POST | Generate a test from a config |
| `/api/tests` | GET | List tests |
| `/api/tests/{id}` | GET, DELETE | Get test details / delete a test |
| `/api/tests/{id}/start` | POST | Start a test |
| `/api/tests/{id}/answer` | POST | Submit an answer |
| `/api/tests/{id}/submit` | POST | Submit a test for grading |
| `/api/tests/{id}/questions/{question_id}/verify` | POST | AI-based verification of a question |
| `/api/flashcards/decks` | GET, POST | List / create flashcard decks |
| `/api/flashcards/decks/{id}` | GET, PUT, DELETE | Get / update / delete a deck |
| `/api/flashcards/decks/{id}/cards` | GET, POST | List / create cards |
| `/api/flashcards/decks/{id}/generate` | POST | Generate cards for a deck |
| `/api/flashcards/decks/{id}/study` | GET | Get the SM-2 study queue |
| `/api/flashcards/decks/{id}/stats` | GET | Per-deck statistics |
| `/api/flashcards/decks/{id}/incomplete-session` | GET | Check for a resumable study session |
| `/api/flashcards/decks/{id}/export` | POST | Export a deck as Anki `.apkg` or CSV |
| `/api/flashcards/decks/{id}/import` | POST | Import cards from CSV |
| `/api/flashcards/create-and-generate` | POST | Create a deck and generate cards in one call |
| `/api/flashcards/cards/{id}` | PUT, DELETE | Update / delete a card |
| `/api/flashcards/cards/{id}/review` | POST | Submit an SM-2 review rating |
| `/api/flashcards/sessions` | POST | Start a study session |
| `/api/flashcards/sessions/{id}` | GET | Get a study session |
| `/api/flashcards/sessions/{id}/complete` | POST | Complete a study session |
| `/api/flashcards/stats` | GET | Global flashcard statistics |
| `/api/flashcards/analytics` | GET | Aggregated learning analytics |
| `/api/flashcards/streak` | GET | Study streak and daily goal |
| `/api/flashcards/from-test/{test_id}` | POST | Create a flashcard deck from a test |
| `/api/subjects` | GET, POST | List / create subjects |
| `/api/subjects/{id}` | GET, PUT, DELETE | Get / update / delete a subject; by default its test configs and decks are only unlinked, with `?cascade=true` they are deleted with it |
| `/api/subjects/{id}/generate-test` | POST | Generate a test for a subject |
| `/api/subjects/{id}/generate-flashcards` | POST | Generate flashcards for a subject |
| `/api/subjects/{id}/test-configs/{config_id}/add-questions` | POST | Add AI questions to an existing test |
| `/api/subjects/{id}/decks/{deck_id}/add-cards` | POST | Add AI cards to an existing deck |
| `/api/generation/progress/{token}` | GET | Poll AI generation progress |
| `/api/generation/progress/{token}/cancel` | POST | Request generation cancellation |

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, SQLite, aiosqlite
- **Frontend**: React 18, TypeScript, Tailwind CSS, TanStack Query
- **AI**: OpenRouter API (access to multiple LLM providers)
- **Theming**: Light/dark via semantic CSS variables — follows the system setting by default, with a Sun/Moon toggle persisting the choice in localStorage (`scio-theme`)
- **Container**: Docker with multi-stage build

## Troubleshooting

### "OpenRouter API key is not configured"
Make sure your `.env` file contains a valid `OPENROUTER_API_KEY`.

### "Failed to generate test"
- Check your OpenRouter API key has credits
- Try a different AI model
- Check the Docker logs: `docker compose logs`

### Document parsing errors
- Ensure the file isn't corrupted
- Try converting to TXT/Markdown format
- Check file size (very large files may fail)

## License

MIT License - feel free to use and modify for personal use.

## Contributing

Contributions welcome! Please open an issue or PR.

