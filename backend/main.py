"""
Main FastAPI application.
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import engine, get_db, init_db, SessionLocal
from models import ScheduleSettings

# Static files directory
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    init_db()

    # Ensure default schedule settings exist
    db = SessionLocal()
    try:
        if not db.query(ScheduleSettings).first():
            settings = ScheduleSettings()
            db.add(settings)
            db.commit()
    finally:
        db.close()

    yield


app = FastAPI(
    title="Pinterest CSV Tool",
    description="Local-only Pinterest CSV generation tool",
    version="1.0.0",
    lifespan=lifespan,
)

# =============================================================================
# API Routes
# =============================================================================

from routers import (
    websites,
    keywords,
    templates,
    images,
    pins,
    schedule,
    export,
    analytics,
)

app.include_router(websites.router, prefix="/api/websites", tags=["websites"])
app.include_router(keywords.router, prefix="/api/keywords", tags=["keywords"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(images.router, prefix="/api/images", tags=["images"])
app.include_router(pins.router, prefix="/api/pins", tags=["pins"])
app.include_router(schedule.router, prefix="/api/schedule", tags=["schedule"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])


# =============================================================================
# Health Check
# =============================================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


# =============================================================================
# Static File Serving (for built React frontend and generated pins)
# =============================================================================

# Mount assets directory if it exists
assets_dir = STATIC_DIR / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

# Mount generated pins directory
# Use parent storage directory (not backend-specific storage)
generated_pins_dir = Path(__file__).parent.parent / "storage" / "generated_pins"
generated_pins_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/pins", StaticFiles(directory=str(generated_pins_dir)), name="pins")


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve the React SPA."""
    # Don't intercept API routes
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    index_file = STATIC_DIR / "index.html"

    if not index_file.exists():
        raise HTTPException(
            status_code=503,
            detail="Frontend not built. Run: cd frontend && npm run build && cp -r dist/* ../backend/static/"
        )

    return FileResponse(str(index_file))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
