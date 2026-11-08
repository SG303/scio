# Multi-stage build for Scio - AI Learning Hub

# Stage 1: Build frontend
FROM node:25-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files
COPY frontend/package.json frontend/package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ .

# Build frontend with output
RUN echo "Starting frontend build..." && npm run build && echo "Frontend build completed successfully!"

# Stage 2: Python backend with frontend static files
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

# Install system dependencies for document parsing; curl runs Anthropic's
# official Claude Code installer (triggered from the web UI)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Claude subscription: the Claude Code CLI is NOT part of the image. It is
# installed on demand into this directory (mount it as a volume), together
# with its sign-in and self-updates.
ENV CLAUDE_CLI_HOME=/app/claude

# Copy backend requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/app ./app

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist /app/static

# Create directories for data and uploads
RUN mkdir -p /app/data /app/uploads /app/claude

# Trust X-Forwarded-Proto/-For from any peer so the same-origin check on API
# writes sees the public https scheme behind a reverse proxy (Traefik, nginx,
# Caddy). Restrict to the proxy's IP/CIDR if port 8000 is reachable directly.
ENV FORWARDED_ALLOW_IPS=*

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/api/health')" || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

