"""
Analytics and activity log router.
"""
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import APIRouter, Depends
from typing import List

from database import get_db
from models import (
    Website, Page, PageKeyword, Template, TemplateZone,
    PageImage, PinDraft, ExportLog, ActivityLog, ImportLog
)
from schemas import (
    AnalyticsSummary,
    ActivityLogResponse,
    ImportLogResponse,
    ExportLogResponse,
)

router = APIRouter()


@router.get("/summary", response_model=AnalyticsSummary)
def get_analytics_summary(db: Session = Depends(get_db)):
    """Get summary statistics for the dashboard."""
    # Website stats
    websites = db.query(Website).count()

    # Page stats
    pages = db.query(Page).count()
    enabled_pages = db.query(Page).filter(Page.is_enabled == True).count()

    # Keyword stats
    keywords = db.query(PageKeyword).count()
    pages_with_keywords = (
        db.query(PageKeyword.page_id)
        .distinct()
        .count()
    )

    # Template stats
    templates = db.query(Template).count()

    # Image stats
    images_total = db.query(PageImage).count()
    images_excluded = db.query(PageImage).filter(PageImage.is_excluded == True).count()
    images_available = images_total - images_excluded

    # Pin stats by status
    pins_total = db.query(PinDraft).count()
    pins_draft = db.query(PinDraft).filter(PinDraft.status == "draft").count()
    pins_ready = db.query(PinDraft).filter(PinDraft.status == "ready").count()
    pins_exported = db.query(PinDraft).filter(PinDraft.status == "exported").count()
    pins_skipped = db.query(PinDraft).filter(PinDraft.status == "skipped").count()

    # Export stats
    exports_count = db.query(ExportLog).count()
    exports_pins_total = sum([log.pins_count for log in db.query(ExportLog).all()])

    return AnalyticsSummary(
        websites=websites,
        pages=pages,
        enabled_pages=enabled_pages,
        keywords=keywords,
        pages_with_keywords=pages_with_keywords,
        templates=templates,
        images_total=images_total,
        images_excluded=images_excluded,
        images_available=images_available,
        pins_total=pins_total,
        pins_draft=pins_draft,
        pins_ready=pins_ready,
        pins_exported=pins_exported,
        pins_skipped=pins_skipped,
        exports_count=exports_count,
        exports_pins_total=exports_pins_total,
    )


@router.get("/activity", response_model=List[ActivityLogResponse])
def get_activity_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Get recent activity logs."""
    logs = (
        db.query(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return logs


@router.get("/history/import", response_model=List[ImportLogResponse])
def get_import_history(
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Get import history."""
    logs = (
        db.query(ImportLog)
        .order_by(ImportLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return logs


@router.get("/history/export", response_model=List[ExportLogResponse])
def get_export_history(
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Get export history."""
    logs = (
        db.query(ExportLog)
        .order_by(ExportLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return logs
