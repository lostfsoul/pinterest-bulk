"""
Pin draft generation and management router.
"""
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, SessionLocal
from models import Page, PageImage, PageKeyword, PinDraft, Template, ActivityLog
from schemas import (
    PinDraftResponse,
    PinDraftUpdate,
    PinGenerateRequest,
    PinRenderSettings,
)

router = APIRouter()


# =============================================================================
# Additional Schemas
# =============================================================================

class PinRenderRequest(BaseModel):
    """Request for rendering a single pin."""
    settings: Optional[PinRenderSettings] = None


class PinRegenerateRequest(BaseModel):
    """Request for regenerating all pins for a template."""
    template_id: int
    settings: Optional[PinRenderSettings] = None


# =============================================================================
# Background Tasks
# =============================================================================

def render_pin_background(pin_id: int):
    """Background task to render a pin image."""
    import asyncio
    from services.pin_renderer import generate_pin_media_url

    db = SessionLocal()
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        db.close()
        return

    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        settings = merge_pin_settings(pin, None)
        url = loop.run_until_complete(generate_pin_media_url(pin, db, settings))
        pin.status = "ready" if url else "draft"
        db.commit()
    except Exception as e:
        print(f"Error rendering pin {pin_id}: {e}")
        db.rollback()
        pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
        if pin:
            pin.status = "draft"
            db.commit()
    finally:
        loop.close()
        db.close()


def log_activity(db: Session, action: str, entity_type: str, entity_id: int, details: dict = None):
    """Log an activity for traceability."""
    log = ActivityLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
    )
    db.add(log)


def build_render_settings(template: Template, request_settings: Optional[PinRenderSettings]) -> dict:
    """Build render settings from template defaults and request overrides."""
    text_zone = next((zone for zone in template.zones if zone.zone_type == "text"), None)
    text_zone_props = text_zone.props if text_zone and text_zone.props else {}
    settings = {
        "text_zone_y": text_zone.y if text_zone else int(round(template.height * 0.44)),
        "text_zone_height": text_zone.height if text_zone else int(round(template.height * 0.12)),
        "text_zone_pad_left": 0,
        "text_zone_pad_right": 0,
        "font_family": '"Bebas Neue", Impact, sans-serif',
        "text_color": text_zone_props.get("text_color") or "#000000",
    }
    if request_settings:
        settings.update(request_settings.model_dump(exclude_none=True))
    return settings


def persist_render_settings(pin: PinDraft, settings: dict) -> None:
    """Persist render settings on the pin record."""
    pin.text_zone_y = settings.get("text_zone_y")
    pin.text_zone_height = settings.get("text_zone_height")
    pin.text_zone_pad_left = settings.get("text_zone_pad_left")
    pin.text_zone_pad_right = settings.get("text_zone_pad_right")
    pin.font_family = settings.get("font_family")
    pin.text_color = settings.get("text_color")


def merge_pin_settings(pin: PinDraft, request_settings: Optional[PinRenderSettings]) -> dict:
    """Merge stored pin settings with request overrides."""
    settings = {
        "text_zone_y": pin.text_zone_y,
        "text_zone_height": pin.text_zone_height,
        "text_zone_pad_left": pin.text_zone_pad_left,
        "text_zone_pad_right": pin.text_zone_pad_right,
        "font_family": pin.font_family,
        "text_color": pin.text_color,
    }
    if request_settings:
        settings.update(request_settings.model_dump(exclude_none=True))
    return settings


def generate_pin_description(page: Page, keywords: List[str]) -> str:
    """Generate a pin description from page and keywords."""
    parts = []

    if page.title:
        parts.append(page.title)

    if keywords:
        parts.append(f"Keywords: {', '.join(keywords[:5])}")

    if page.url:
        parts.append(f"Read more at the link below.")

    return "\n\n".join(parts) if parts else ""


@router.post("/generate", response_model=List[PinDraftResponse])
def generate_pins(
    request: PinGenerateRequest,
    db: Session = Depends(get_db),
):
    """Generate pin drafts from pages.

    Creates one pin per non-excluded image per page.
    """
    # Verify template exists
    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    render_settings = build_render_settings(template, request.render_settings)

    # Get pages to generate pins for
    if request.page_ids:
        pages = db.query(Page).filter(Page.id.in_(request.page_ids)).all()
    else:
        pages = db.query(Page).filter(Page.is_enabled == True).all()

    if not pages:
        raise HTTPException(status_code=400, detail="No pages found")

    pins_created = 0
    all_new_pins = []

    for page in pages:
        # Get keywords
        keywords = [k.keyword for k in page.keywords]

        # Get ALL non-excluded images for this page
        images = (
            db.query(PageImage)
            .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
            .all()
        )

        # Get existing pins for this page
        existing_pins = (
            db.query(PinDraft)
            .filter(PinDraft.page_id == page.id)
            .all()
        )

        # Create a map of existing pins by selected_image_url for easy lookup
        existing_pins_by_url = {pin.selected_image_url: pin for pin in existing_pins if pin.selected_image_url}

        # Create/update a pin for each image
        for image in images:
            # Check if a pin already exists for this image
            existing_pin = existing_pins_by_url.get(image.url)

            if existing_pin:
                # Update existing pin
                existing_pin.template_id = template.id
                existing_pin.selected_image_url = image.url
                existing_pin.title = page.title or ""
                existing_pin.description = generate_pin_description(page, keywords)
                existing_pin.board_name = request.board_name
                existing_pin.link = page.url
                existing_pin.media_url = None  # Will be generated when rendered
                existing_pin.keywords = ", ".join(keywords)
                existing_pin.status = "draft"
                existing_pin.is_selected = True
                persist_render_settings(existing_pin, render_settings)
                existing_pin.updated_at = datetime.utcnow()
                pins_created += 1
                all_new_pins.append(existing_pin)
            else:
                # Create new pin draft
                pin = PinDraft(
                    page_id=page.id,
                    template_id=template.id,
                    selected_image_url=image.url,
                    title=page.title or "",
                    description=generate_pin_description(page, keywords),
                    board_name=request.board_name,
                    link=page.url,
                    media_url=None,  # Will be generated when rendered
                    keywords=", ".join(keywords),
                    status="draft",
                    is_selected=True,
                )
                persist_render_settings(pin, render_settings)
                db.add(pin)
                pins_created += 1
                all_new_pins.append(pin)

        # Delete existing pins that no longer have corresponding images
        existing_image_urls = {img.url for img in images}
        for existing_pin in existing_pins:
            if existing_pin.selected_image_url not in existing_image_urls:
                db.delete(existing_pin)

    db.commit()

    # Log activity
    log_activity(
        db,
        "pins_generated",
        "template",
        template.id,
        {"pins_created": pins_created, "board_name": request.board_name}
    )
    db.commit()

    # Return all pin drafts for these pages
    return (
        db.query(PinDraft)
        .filter(PinDraft.page_id.in_([p.id for p in pages]))
        .order_by(PinDraft.created_at.desc())
        .all()
    )


@router.get("", response_model=List[PinDraftResponse])
def list_pins(
    status: str = None,
    is_selected: bool = None,
    db: Session = Depends(get_db),
):
    """List pin drafts with optional filters."""
    query = db.query(PinDraft)

    if status:
        query = query.filter(PinDraft.status == status)
    if is_selected is not None:
        query = query.filter(PinDraft.is_selected == is_selected)

    return query.order_by(PinDraft.created_at.desc()).all()


@router.get("/{pin_id}", response_model=PinDraftResponse)
def get_pin(pin_id: int, db: Session = Depends(get_db)):
    """Get a specific pin draft."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")
    return pin


@router.patch("/{pin_id}", response_model=PinDraftResponse)
def update_pin(
    pin_id: int,
    update: PinDraftUpdate,
    db: Session = Depends(get_db),
):
    """Update a pin draft."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")

    if update.title is not None:
        pin.title = update.title
    if update.description is not None:
        pin.description = update.description
    if update.board_name is not None:
        pin.board_name = update.board_name
    if update.keywords is not None:
        pin.keywords = update.keywords
    if update.text_zone_y is not None:
        pin.text_zone_y = update.text_zone_y
    if update.text_zone_height is not None:
        pin.text_zone_height = update.text_zone_height
    if update.text_zone_pad_left is not None:
        pin.text_zone_pad_left = update.text_zone_pad_left
    if update.text_zone_pad_right is not None:
        pin.text_zone_pad_right = update.text_zone_pad_right
    if update.font_family is not None:
        pin.font_family = update.font_family
    if update.text_color is not None:
        pin.text_color = update.text_color
    if update.status is not None:
        pin.status = update.status
    if update.is_selected is not None:
        pin.is_selected = update.is_selected

    pin.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pin)

    log_activity(
        db,
        "pin_updated",
        "pin",
        pin.id,
        {"status": pin.status, "is_selected": pin.is_selected}
    )
    db.commit()

    return pin


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_all_pins(db: Session = Depends(get_db)):
    """Delete all pin drafts."""
    count = db.query(PinDraft).count()
    db.query(PinDraft).delete()

    log_activity(
        db,
        "pins_cleared",
        "pin",
        None,
        {"pins_deleted": count}
    )
    db.commit()

    return None


@router.get("/stats/summary")
def get_pins_summary(db: Session = Depends(get_db)):
    """Get summary statistics for pins."""
    total = db.query(PinDraft).count()

    status_counts = {}
    for status_value in ["draft", "ready", "exported", "skipped"]:
        count = db.query(PinDraft).filter(PinDraft.status == status_value).count()
        status_counts[status_value] = count

    return {
        "total": total,
        "by_status": status_counts,
        "selected": db.query(PinDraft).filter(PinDraft.is_selected == True).count(),
    }


@router.post("/{pin_id}/render", response_model=PinDraftResponse)
def render_pin(
    pin_id: int,
    request: PinRenderRequest = None,
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    """Render a single pin to generate the actual image.

    This creates a PNG file using Canvas rendering and updates the media_url.
    """
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")

    if not pin.template_id:
        raise HTTPException(status_code=400, detail="Pin has no template assigned")

    settings = merge_pin_settings(pin, request.settings if request else None)
    persist_render_settings(pin, settings)
    pin.updated_at = datetime.utcnow()
    db.commit()

    # Queue background rendering unless explicit settings were supplied (sync render)
    if request and request.settings is not None:
        import asyncio
        from services.pin_renderer import generate_pin_media_url

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            url = loop.run_until_complete(generate_pin_media_url(pin, db, settings))
            pin.status = "ready" if url else "draft"
            db.commit()
        finally:
            loop.close()
    elif background_tasks:
        background_tasks.add_task(render_pin_background, pin_id)
    else:
        render_pin_background(pin_id)

    db.refresh(pin)
    return pin


@router.post("/regenerate", status_code=status.HTTP_202_ACCEPTED)
def regenerate_pins(
    request: PinRegenerateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Regenerate all pins for a template with new settings.

    This endpoint returns immediately and processes rendering in the background.
    """
    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    pins = (
        db.query(PinDraft)
        .filter(PinDraft.template_id == request.template_id)
        .all()
    )

    if not pins:
        raise HTTPException(status_code=404, detail="No pins found for this template")

    template_settings = build_render_settings(template, request.settings)
    for pin in pins:
        persist_render_settings(
            pin,
            merge_pin_settings(pin, request.settings) if request.settings else template_settings,
        )
        pin.updated_at = datetime.utcnow()
    db.commit()

    # Queue all pins for background rendering
    for pin in pins:
        background_tasks.add_task(render_pin_background, pin.id)

    return {
        "message": f"Regenerating {len(pins)} pins",
        "pin_count": len(pins),
        "template_id": request.template_id,
    }
