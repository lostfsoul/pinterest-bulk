"""Analytics router."""
from typing import List

from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from database import get_db
from models import (
    Website, Page, PageKeyword, Template,
    PageImage, PinDraft, ExportLog
)
from schemas import (
    AnalyticsSummary,
    ExportLogResponse,
)

router = APIRouter()


@router.get("/websites-overview")
def get_websites_overview(db: Session = Depends(get_db)):
    """Website-centric overview used by dashboard cards."""
    websites = db.query(Website).order_by(Website.created_at.desc()).all()
    result = []

    for site in websites:
        page_ids = [page.id for page in site.pages]
        enabled_pages = sum(1 for page in site.pages if page.is_enabled)
        scraped_pages = sum(
            1
            for page in site.pages
            if page.is_enabled and (page.scraped_at is not None or len(page.images) > 0)
        )

        scheduled_pins = 0
        scheduled_until = None
        total_pins = 0
        generated_pages = 0
        if page_ids:
            pins = db.query(PinDraft).filter(PinDraft.page_id.in_(page_ids)).all()
            total_pins = len(pins)
            generated_pages = len({pin.page_id for pin in pins})
            scheduled = [pin for pin in pins if pin.publish_date is not None]
            scheduled_pins = len(scheduled)
            if scheduled:
                scheduled_until = max(pin.publish_date for pin in scheduled)

        status = "indexed"
        if enabled_pages == 0:
            status = "paused"
        elif scheduled_pins > 0:
            status = "scheduled"
        elif total_pins > 0:
            status = "generated"

        result.append(
            {
                "id": site.id,
                "name": site.name,
                "url": site.url,
                "enabled_pages": enabled_pages,
                "scraped_pages": scraped_pages,
                "generated_pages": generated_pages,
                "scheduled_pins": scheduled_pins,
                "scheduled_until": scheduled_until,
                "total_pins": total_pins,
                "status": status,
            }
        )

    return result


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
