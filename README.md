# Scio

Your AI Learning Hub. Upload study materials, generate practice tests, create flashcards, and organize your learning journey with AI-powered tools.

![Scio](https://img.shields.io/badge/AI-Powered-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![Python](https://img.shields.io/badge/Python-3.11-green)
![React](https://img.shields.io/badge/React-18-blue)

## Features

- 📚 **Document Management** - Upload PDFs, DOCX, TXT, or paste text directly
- 🤖 **Multiple AI Models** - Choose from GPT-4, Claude, Llama, and more via OpenRouter
- 📝 **Practice Tests** - Generate customizable tests with AI-powered questions
- 🎴 **Flashcards** - Create and study flashcards with spaced repetition
- 📁 **Subject Organization** - Organize your learning materials by subject
- 📊 **Progress Tracking** - Track your learning progress and performance
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
- GPT-4o / GPT-4o Mini
- Claude 3.5 Sonnet / Claude 3 Haiku
- Llama 3.1 (70B / 8B)
- Gemini Pro 1.5
- Mistral Large
- DeepSeek V3

### 3. Create a Test

Click **Create Test** and:
1. Select which documents to use as context
2. Choose the AI model
3. Set number of questions (5-30)
4. Set number of choices (3-6)
5. Generate!

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
| `OPENROUTER_API_KEY` | Your OpenRouter API key | Yes |
| `DEBUG` | Enable debug mode (default: false) | No |

### Data Persistence

The app stores data in two directories (mounted as Docker volumes):
- `./data/` - SQLite database
- `./uploads/` - Uploaded document files

### Backup

To backup your data:
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
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

### Project Structure

```
scio/
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Container orchestration
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
| `/api/documents` | GET, POST | List/create documents |
| `/api/documents/upload` | POST | Upload document file |
| `/api/models` | GET, POST | List/create AI models |
| `/api/tests/configs` | GET, POST | List/create test configs |
| `/api/tests/generate/{id}` | POST | Generate test from config |
| `/api/tests/{id}` | GET | Get test details |
| `/api/tests/{id}/start` | POST | Start a test |
| `/api/tests/{id}/answer` | POST | Submit an answer |
| `/api/tests/{id}/submit` | POST | Submit test for grading |

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, SQLite, aiosqlite
- **Frontend**: React 18, TypeScript, Tailwind CSS, TanStack Query
- **AI**: OpenRouter API (access to multiple LLM providers)
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

