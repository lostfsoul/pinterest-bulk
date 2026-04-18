"""
Workflow scheduling router.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import GenerationJob, Website
from routers.pins import run_generation_job
from services.workflow_service import (
    build_generation_payload,
    create_generation_job,
    expire_stale_generation_jobs,
    get_workflow_status,
    get_pin_count_preview,
    get_time_window_preview,
    has_active_generation_job,
    resolve_website_schedule_config,
)

router = APIRouter()


@router.get("/status")
def workflow_status(website_id: int = Query(..., ge=1), db: Session = Depends(get_db)) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return get_workflow_status(db, website)


@router.post("/generate-next")
def workflow_generate_next(
    background_tasks: BackgroundTasks,
    website_id: int = Query(..., ge=1),
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    expired_count = expire_stale_generation_jobs(db, website_id)
    if force:
        # Manual override: mark currently active jobs as failed so a new job can start now.
        active_rows = (
            db.query(GenerationJob)
            .filter(
                GenerationJob.website_id == website_id,
                GenerationJob.status.in_(["queued", "running"]),
            )
            .all()
        )
        if active_rows:
            now = datetime.utcnow()
            for active in active_rows:
                active.status = "failed"
                active.phase = "error"
                active.completed_at = now
                active.message = "Generation job cancelled by manual force restart."
                active.error_detail = "Cancelled by manual force restart."
                active.updated_at = now
            db.commit()

    if has_active_generation_job(db, website_id):
        raise HTTPException(status_code=409, detail="A generation job is already running for this website.")

    try:
        payload = build_generation_payload(db, website)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    job = create_generation_job(db, website_id, payload, reason="manual_workflow")
    background_tasks.add_task(run_generation_job, job.id)
    return {
        "job_id": job.id,
        "status": job.status,
        "expired_stale_jobs": expired_count,
        "message": job.message or "Generation queued.",
    }


@router.get("/pin-count-preview")
def workflow_pin_count_preview(
    website_id: int = Query(..., ge=1),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    daily_pin_count: int | None = Query(default=None, ge=1, le=100),
    floating_days: bool | None = Query(default=None),
    warmup_month: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    config = resolve_website_schedule_config(db, website)
    if daily_pin_count is not None:
        config["pins_per_day"] = daily_pin_count
    if floating_days is not None:
        config["floating_days"] = floating_days
    if warmup_month is not None:
        config["warmup_month"] = warmup_month
    days = get_pin_count_preview(website=website, config=config, year=year, month=month)
    return {
        "website_id": website_id,
        "year": year,
        "month": month,
        "base_daily_pin_count": int(config.get("pins_per_day", 5)),
        "days": days,
    }


@router.get("/time-window-preview")
def workflow_time_window_preview(
    website_id: int = Query(..., ge=1),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    start_hour: int | None = Query(default=None, ge=0, le=23),
    end_hour: int | None = Query(default=None, ge=0, le=23),
    floating_start_end_hours: bool | None = Query(default=None),
    start_window_flex_minutes: int | None = Query(default=None, ge=0, le=240),
    end_window_flex_minutes: int | None = Query(default=None, ge=0, le=240),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    config = resolve_website_schedule_config(db, website)
    if start_hour is not None:
        config["start_hour"] = start_hour
    if end_hour is not None:
        config["end_hour"] = end_hour
    if floating_start_end_hours is not None:
        config["floating_start_end_hours"] = floating_start_end_hours
    if start_window_flex_minutes is not None:
        config["start_window_flex_minutes"] = start_window_flex_minutes
    if end_window_flex_minutes is not None:
        config["end_window_flex_minutes"] = end_window_flex_minutes
    days = get_time_window_preview(website=website, config=config, year=year, month=month)
    return {
        "website_id": website_id,
        "year": year,
        "month": month,
        "start_hour": int(config.get("start_hour", 8)),
        "end_hour": int(config.get("end_hour", 20)),
        "floating_start_end_hours": bool(config.get("floating_start_end_hours", False)),
        "start_window_flex_minutes": int(config.get("start_window_flex_minutes", 60)),
        "end_window_flex_minutes": int(config.get("end_window_flex_minutes", 120)),
        "days": days,
    }
