# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pinterest CSV Tool — a full-stack web app for bulk-generating Pinterest pins from website sitemaps. It scrapes pages, generates pin drafts from SVG templates, and exports CSV files for Pinterest schedulers.

## Commands

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite dev server on :5173, proxies /api to :8000
npm run build        # TypeScript check + Vite build → backend/static/
npm run watch        # Vite watch mode
npm run dev:full     # Watch + auto-copy to backend/static
```

### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py       # or: uvicorn main:app --reload
```

### Quick Start (Development)
```bash
./scripts/build-and-serve.sh         # Single run
./scripts/build-and-serve.sh --watch # Watch mode with auto-rebuild
```

### Docker
```bash
docker build -t pinterest-tool .
docker run -p 8000:8000 --env-file .env \
  -v $(pwd)/data:/app/data -v $(pwd)/storage:/app/storage pinterest-tool
```

## Architecture

### Backend (FastAPI + SQLAlchemy + SQLite)
- **Entry point**: `backend/main.py` — FastAPI app, route mounting, middleware
- **Database**: SQLite at `data/pinterest.db` (WAL mode), `backend/database.py` defines tables and manual migrations via `alter_table_add_column()`
- **Models**: `backend/models.py` — SQLAlchemy 2.0 declarative ORM with `Mapped` columns
- **Schemas**: `backend/schemas.py` — Pydantic v2 request/response models
- **Routers**: `backend/routers/` — API route handlers (auth, websites, keywords, templates, images, pins, schedule, export, ai_presets)
- **Services**: `backend/services/` — Business logic (pin_renderer, template_parser, template_detection, sitemap, image_classifier, ai_generation, etc.)
- **Node Renderer**: `backend/node_renderer/render.js` — Canvas-based pin rendering invoked as subprocess from `pin_renderer.py`
- **Auth**: Session-based password auth via `APP_PASSWORD` env var. If blank, auth is disabled.

### Frontend (React 18 + TypeScript + Vite + Tailwind)
- **Entry**: `frontend/src/main.tsx`, `frontend/src/App.tsx` — routing, auth gate, layout
- **Routing**: React Router v6 with lazy-loaded pages (`React.lazy()`)
- **API Client**: `frontend/src/services/api.ts` — centralized Axios client, all TS interfaces defined here
- **Pages**: `frontend/src/pages/` — Websites, WebsiteDetail, Generate, Templates, Keywords, Export, Settings, Login
- **Components**: `frontend/src/components/` — Button, PinPreview, ZoneEditor, ZoneOverlay, WebsiteWorkflowSettingsPanel
- **Styling**: Tailwind with "brutalist" design system (bold shadows, accent color `#E11D48`), Poppins font

### Static Files
Built frontend served from `backend/static/` by FastAPI. Always `npm run build` before starting the backend.

## Environment Variables

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Password for auth (if blank, auth is disabled) |
| `APP_SESSION_SECRET` | Session signing secret |
| `OPENAI_API_KEY` | Optional — enables AI title/description generation |
| `OPENAI_MODEL` | OpenAI model for AI generation |
| `PUBLIC_BASE_URL` | Base URL for exported Pinterest media URLs |

## Key Conventions

- **Migrations**: Manual column-add in `database.py`, not Alembic
- **Error handling**: HTTPExceptions with appropriate status codes
- **SVG Templates**: Parsed with `parse_svg_template()`, zones stored as JSON manifest
- **Generation polling**: Active job polled via `getGenerationJob()`, progress dispatched via `CustomEvent`
- **CSS**: `.shadow-brutal` class for card shadows, `@layer base` for fonts/resets
- **API calls**: Always use `apiClient` from `src/services/api.ts`, never call `axios` directly

## Key Files

| File | Purpose |
|---|---|
| `backend/main.py` | FastAPI entry point, CORS, static files, route mounting |
| `backend/database.py` | SQLite setup, table creation, migration helpers |
| `backend/models.py` | SQLAlchemy models |
| `backend/schemas.py` | Pydantic schemas |
| `backend/routers/pins.py` | Pin generation job management |
| `backend/services/pin_renderer.py` | Orchestrates Node.js canvas renderer |
| `backend/services/template_detection.py` | OCR-based template zone detection |
| `frontend/src/services/api.ts` | Centralized API client + TypeScript interfaces |
| `frontend/src/pages/Generate.tsx` | Pin generation workflow UI |
| `frontend/src/components/ZoneOverlay.tsx` | SVG zone editor overlay |