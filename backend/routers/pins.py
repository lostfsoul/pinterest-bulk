"""
Pin draft generation and management router.
"""
import asyncio
import re
from datetime import datetime, timedelta
from typing import Callable, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, SessionLocal
from models import Page, PageImage, PageKeyword, PinDraft, Template, AIPromptPreset, AISettings, Website, Board, GenerationJob
from schemas import (
    GenerationPreviewRequest,
    GenerationPreviewResponse,
    GenerationJobResponse,
    PinDraftResponse,
    PinDraftUpdate,
    PinGenerateRequest,
    PinRenderSettings,
)
from routers.images import scrape_page_into_db
from services.palette import normalize_hex_color, resolve_palette_settings

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


class PinDeleteRequest(BaseModel):
    """Request for deleting pin drafts."""
    pin_ids: list[int] | None = None
    selected_only: bool = False


class PinAIGenerationOverrides(BaseModel):
    """Override AI presets for a specific generation."""
    title_preset_id: int | None = None
    description_preset_id: int | None = None
    board_preset_id: int | None = None


class PinGenerateRequestExtended(PinGenerateRequest):
    """Extended request for pin generation with AI overrides."""
    ai_overrides: PinAIGenerationOverrides | None = None


ProgressCallback = Callable[[dict], None]


# =============================================================================
# Job Helpers
# =============================================================================

def _update_generation_job(
    db: Session,
    job: GenerationJob,
    **updates,
) -> None:
    for key, value in updates.items():
        setattr(job, key, value)
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)


def _emit_progress(callback: ProgressCallback | None, **payload) -> None:
    if callback:
        callback(payload)


def _build_generation_context(
    db: Session,
    request: PinGenerateRequest,
):
    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    render_settings = build_render_settings(template, request.render_settings)

    ai_settings = db.query(AISettings).first()
    title_preset = None
    description_preset = None
    board_preset = None

    if ai_settings and ai_settings.use_ai_by_default:
        title_preset = get_preset_for_target(db, "title", settings=ai_settings)
        description_preset = get_preset_for_target(db, "description", settings=ai_settings)
        board_preset = get_preset_for_target(db, "board", settings=ai_settings)
    default_language = (ai_settings.default_language if ai_settings else None) or "English"
    requested_language = (request.language or "").strip() or None

    if request.page_ids:
        pages = (
            db.query(Page)
            .filter(Page.id.in_(request.page_ids), Page.is_enabled == True)
            .all()
        )
    elif request.website_id:
        pages = (
            db.query(Page)
            .filter(Page.website_id == request.website_id, Page.is_enabled == True)
            .all()
        )
    else:
        pages = db.query(Page).filter(Page.is_enabled == True).all()

    if not pages:
        raise HTTPException(status_code=400, detail="No pages found")

    pages = filter_pages_by_active_selection_keywords(pages)
    if not pages:
        raise HTTPException(status_code=400, detail="No pages matched active selection keywords")

    page_website_names: dict[int, str] = {}
    website_generation_settings: dict[int, dict] = {}
    website_ids = set(p.website_id for p in pages)
    if website_ids:
        websites = db.query(Website).filter(Website.id.in_(website_ids)).all()
        page_website_names = {w.id: w.name for w in websites}
        website_generation_settings = {w.id: (w.generation_settings or {}) for w in websites}

    website_boards: dict[int, list[Board]] = {}
    if website_ids:
        all_boards = db.query(Board).filter(Board.website_id.in_(website_ids)).all()
        selected_page_ids = {page.id for page in pages}
        for board in all_boards:
            website_boards.setdefault(board.website_id, []).append(board)
        for website_id, site_boards in list(website_boards.items()):
            website_boards[website_id] = filter_boards_for_page_pool(site_boards, selected_page_ids)

    return {
        "template": template,
        "render_settings": render_settings,
        "title_preset": title_preset,
        "description_preset": description_preset,
        "board_preset": board_preset,
        "default_language": default_language,
        "requested_language": requested_language,
        "pages": pages,
        "page_website_names": page_website_names,
        "website_generation_settings": website_generation_settings,
        "website_boards": website_boards,
    }


def _generate_pin_drafts(
    db: Session,
    request: PinGenerateRequest,
    *,
    auto_scrape_missing: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> list[PinDraft]:
    context = _build_generation_context(db, request)
    template: Template = context["template"]
    render_settings: dict = context["render_settings"]
    title_preset = context["title_preset"]
    description_preset = context["description_preset"]
    board_preset = context["board_preset"]
    default_language = context["default_language"]
    requested_language = context["requested_language"]
    pages: list[Page] = context["pages"]
    page_website_names: dict[int, str] = context["page_website_names"]
    website_generation_settings: dict[int, dict] = context["website_generation_settings"]
    website_boards: dict[int, list[Board]] = context["website_boards"]

    pins_created = 0
    all_new_pins: list[PinDraft] = []
    skipped = {
        "no_images": 0,
        "gap": 0,
        "lifetime_limit": 0,
        "monthly_limit": 0,
    }

    text_variations = int((request.variation_options or {}).get("text_variations", 1) or 1)
    text_variations = max(1, text_variations)
    template_image_slots = max(1, len([zone for zone in template.zones if zone.zone_type == "image"]))
    manual_keywords = parse_manual_keywords(request.manual_keywords)
    use_manual_keywords = request.keyword_mode == "manual" and len(manual_keywords) > 0
    global_rules = None
    scraped_pages = 0
    failed_pages = 0

    _emit_progress(
        progress_callback,
        phase="drafting",
        message="Building pin drafts",
        total_pages=len(pages),
        processed_pages=0,
        scraped_pages=0,
        failed_pages=0,
        total_pins=0,
    )

    for index, page in enumerate(pages, start=1):
        keywords = manual_keywords if use_manual_keywords else select_keywords_for_generation(page.keywords)
        website_name = page_website_names.get(page.website_id, "")
        site_settings = website_generation_settings.get(page.website_id, {})
        image_settings = site_settings.get("image", {}) if isinstance(site_settings, dict) else {}
        content_settings = site_settings.get("content_settings", {}) if isinstance(site_settings, dict) else {}
        desired_gap_days = int(content_settings.get("desired_gap_days", 0) or 0)
        lifetime_limit_enabled = bool(content_settings.get("lifetime_limit_enabled", False))
        lifetime_limit_count = int(content_settings.get("lifetime_limit_count", 0) or 0)
        monthly_limit_enabled = bool(content_settings.get("monthly_limit_enabled", False))
        monthly_limit_count = int(content_settings.get("monthly_limit_count", 0) or 0)
        no_link_pins = bool(content_settings.get("no_link_pins", False))
        page_language = requested_language or default_language

        images = (
            db.query(PageImage)
            .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
            .all()
        )
        if auto_scrape_missing and not images and bool(image_settings.get("fetch_from_page", True)):
            if global_rules is None:
                from models import GlobalExcludedImage
                global_rules = db.query(GlobalExcludedImage).all()
            loop = asyncio.new_event_loop()
            try:
                asyncio.set_event_loop(loop)
                loop.run_until_complete(scrape_page_into_db(page, db, global_rules))
                scraped_pages += 1
            except Exception:
                db.rollback()
                failed_pages += 1
            finally:
                loop.close()
            images = (
                db.query(PageImage)
                .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
                .all()
            )
            _emit_progress(
                progress_callback,
                phase="scraping",
                message=f"Scraped images for page {index} of {len(pages)}",
                total_pages=len(pages),
                processed_pages=index - 1,
                scraped_pages=scraped_pages,
                failed_pages=failed_pages,
            )

        images = apply_generation_image_filters(images, site_settings)
        existing_for_constraints = (
            db.query(PinDraft)
            .filter(PinDraft.page_id == page.id)
            .order_by(PinDraft.created_at.desc())
            .all()
        )
        if desired_gap_days > 0 and existing_for_constraints:
            last_created = existing_for_constraints[0].created_at
            if (datetime.utcnow() - last_created).days < desired_gap_days:
                skipped["gap"] += 1
                _emit_progress(progress_callback, processed_pages=index)
                continue
        if lifetime_limit_enabled and lifetime_limit_count > 0 and len(existing_for_constraints) >= lifetime_limit_count:
            skipped["lifetime_limit"] += 1
            _emit_progress(progress_callback, processed_pages=index)
            continue
        if monthly_limit_enabled and monthly_limit_count > 0:
            month_ago = datetime.utcnow() - timedelta(days=30)
            in_month = [pin for pin in existing_for_constraints if pin.created_at >= month_ago]
            if len(in_month) >= monthly_limit_count:
                skipped["monthly_limit"] += 1
                _emit_progress(progress_callback, processed_pages=index)
                continue
        local_options = dict(request.variation_options or {})
        local_options.setdefault("max_images_per_page", template_image_slots)
        selected_images = choose_images_for_mode(images, request.mode, local_options)
        if not selected_images:
            skipped["no_images"] += 1
            failed_pages += 1
            _emit_progress(progress_callback, processed_pages=index, failed_pages=failed_pages)
            continue
        title_count = 1 if request.mode == "conservative" else max(len(selected_images), text_variations)
        pin_titles = generate_pin_titles(
            page, keywords, title_count, request.use_ai_titles,
            preset=title_preset,
            language=page_language,
            website_name=website_name,
            tone=request.tone,
            cta_style=request.cta_style,
            title_max=request.title_max,
        )
        pin_description = generate_description_ai(
            page,
            keywords,
            preset=description_preset,
            language=page_language,
            website_name=website_name,
            tone=request.tone,
            cta_style=request.cta_style,
            description_max=request.description_max,
            generate_descriptions=request.generate_descriptions,
        )
        pin_board = generate_board_name_ai(
            page,
            keywords,
            preset=board_preset,
            language=page_language,
            default_board=request.board_name,
            website_name=website_name,
        )
        pin_board = assign_board_name(
            page=page,
            boards=website_boards.get(page.website_id, []),
            keywords=keywords,
            fallback=pin_board or request.board_name,
        )

        existing_pins = (
            db.query(PinDraft)
            .filter(PinDraft.page_id == page.id)
            .order_by(PinDraft.created_at.asc())
            .all()
        )

        primary_image = selected_images[0]
        pin_title = pin_titles[0] if pin_titles else sanitize_generated_text(page.title or "")
        pin_to_keep = existing_pins[0] if existing_pins else None
        page_render_settings = resolve_page_render_settings(page, render_settings, primary_image.url)

        if pin_to_keep:
            pin_to_keep.template_id = template.id
            pin_to_keep.selected_image_url = primary_image.url
            pin_to_keep.title = pin_title
            pin_to_keep.description = pin_description
            pin_to_keep.board_name = pin_board
            pin_to_keep.link = None if no_link_pins else page.url
            pin_to_keep.media_url = None
            pin_to_keep.keywords = ", ".join(keywords)
            pin_to_keep.status = "draft"
            pin_to_keep.is_selected = True
            persist_render_settings(pin_to_keep, page_render_settings)
            pin_to_keep.updated_at = datetime.utcnow()
            pins_created += 1
            all_new_pins.append(pin_to_keep)
            for stale_pin in existing_pins[1:]:
                db.delete(stale_pin)
        else:
            pin = PinDraft(
                page_id=page.id,
                template_id=template.id,
                selected_image_url=primary_image.url,
                title=pin_title,
                description=pin_description,
                board_name=pin_board,
                link=None if no_link_pins else page.url,
                media_url=None,
                keywords=", ".join(keywords),
                status="draft",
                is_selected=True,
            )
            persist_render_settings(pin, page_render_settings)
            db.add(pin)
            pins_created += 1
            all_new_pins.append(pin)

        _emit_progress(
            progress_callback,
            phase="drafting",
            message=f"Processed {index} of {len(pages)} pages",
            total_pages=len(pages),
            processed_pages=index,
            scraped_pages=scraped_pages,
            failed_pages=failed_pages,
            total_pins=pins_created,
            skipped=skipped.copy(),
        )

    db.commit()

    if pins_created == 0:
        reason_parts = []
        if skipped["no_images"]:
            reason_parts.append(f"{skipped['no_images']} page(s) have no available images")
        if skipped["gap"]:
            reason_parts.append(f"{skipped['gap']} page(s) blocked by desired gap days")
        if skipped["lifetime_limit"]:
            reason_parts.append(f"{skipped['lifetime_limit']} page(s) blocked by lifetime limit")
        if skipped["monthly_limit"]:
            reason_parts.append(f"{skipped['monthly_limit']} page(s) blocked by monthly limit")
        detail = "No pins were generated."
        if reason_parts:
            detail = f"{detail} " + "; ".join(reason_parts) + "."
        raise HTTPException(status_code=400, detail=detail)

    return (
        db.query(PinDraft)
        .filter(PinDraft.page_id.in_([p.id for p in pages]))
        .order_by(PinDraft.created_at.desc())
        .all()
    )


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
        settings = fill_missing_settings_from_template(pin, db, merge_pin_settings(pin, None))
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


def run_generation_job(job_id: int) -> None:
    """Run generation job in the background."""
    from services.pin_renderer import generate_pin_media_url

    db = SessionLocal()
    job = db.query(GenerationJob).filter(GenerationJob.id == job_id).first()
    if not job:
        db.close()
        return

    try:
        payload = job.request_payload or {}
        request = PinGenerateRequest.model_validate(payload)
        _update_generation_job(
            db,
            job,
            status="running",
            phase="preparing",
            message="Preparing generation job",
            error_detail=None,
        )

        scraped_pages = 0
        failed_pages = 0

        def progress(payload: dict) -> None:
            nonlocal scraped_pages, failed_pages
            scraped_pages = max(scraped_pages, int(payload.get("scraped_pages", scraped_pages) or 0))
            failed_pages = max(failed_pages, int(payload.get("failed_pages", failed_pages) or 0))
            updates = {
                "phase": payload.get("phase", job.phase),
                "message": payload.get("message", job.message),
                "total_pages": int(payload.get("total_pages", job.total_pages) or 0),
                "processed_pages": int(payload.get("processed_pages", job.processed_pages) or 0),
                "scraped_pages": scraped_pages,
                "failed_pages": failed_pages,
                "total_pins": int(payload.get("total_pins", job.total_pins) or 0),
            }
            _update_generation_job(db, job, **updates)

        pins = _generate_pin_drafts(
            db,
            request,
            auto_scrape_missing=True,
            progress_callback=progress,
        )

        pin_ids = [pin.id for pin in pins]
        _update_generation_job(
            db,
            job,
            phase="rendering",
            message=f"Rendering {len(pin_ids)} generated pins",
            total_pins=len(pin_ids),
            rendered_pins=0,
        )

        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            rendered = 0
            for idx, pin_id in enumerate(pin_ids, start=1):
                pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
                if not pin:
                    continue
                settings = fill_missing_settings_from_template(pin, db, merge_pin_settings(pin, None))
                url = loop.run_until_complete(generate_pin_media_url(pin, db, settings))
                pin.status = "ready" if url else "draft"
                db.commit()
                rendered += 1
                _update_generation_job(
                    db,
                    job,
                    phase="rendering",
                    message=f"Rendered {idx} of {len(pin_ids)} pins",
                    rendered_pins=rendered,
                    total_pins=len(pin_ids),
                )
        finally:
            loop.close()

        _update_generation_job(
            db,
            job,
            status="completed",
            phase="complete",
            message=f"Completed generation for {len(pin_ids)} pins",
            total_pins=len(pin_ids),
            rendered_pins=len(pin_ids),
            completed_at=datetime.utcnow(),
        )
    except HTTPException as error:
        _update_generation_job(
            db,
            job,
            status="failed",
            phase="error",
            message=error.detail,
            error_detail=error.detail,
            completed_at=datetime.utcnow(),
        )
    except Exception as error:
        db.rollback()
        _update_generation_job(
            db,
            job,
            status="failed",
            phase="error",
            message="Generation job failed",
            error_detail=str(error),
            completed_at=datetime.utcnow(),
        )
    finally:
        db.close()


def build_render_settings(template: Template, request_settings: Optional[PinRenderSettings]) -> dict:
    """Build render settings from template defaults and request overrides."""
    text_zone = next((zone for zone in template.zones if zone.zone_type == "text"), None)
    text_zone_props = text_zone.props if text_zone and text_zone.props else {}
    settings = {
        "text_zone_y": text_zone.y if text_zone else int(round(template.height * 0.44)),
        "text_zone_height": text_zone.height if text_zone else int(round(template.height * 0.12)),
        "text_zone_pad_left": max(0, text_zone.x) if text_zone else 0,
        "text_zone_pad_right": max(0, template.width - (text_zone.x + text_zone.width)) if text_zone else 0,
        "text_align": text_zone_props.get("text_align") or "left",
        "palette_mode": text_zone_props.get("palette_mode"),
        "text_zone_bg_color": text_zone_props.get("text_zone_bg_color") or "#ffffff",
        "brand_palette_background_color": text_zone_props.get("brand_palette_background_color") or "#ffffff",
        "brand_palette_text_color": text_zone_props.get("brand_palette_text_color") or "#000000",
        "brand_palette_effect_color": text_zone_props.get("brand_palette_effect_color") or "#000000",
        "manual_palette_background_color": text_zone_props.get("manual_palette_background_color") or "#ffffff",
        "manual_palette_text_color": text_zone_props.get("manual_palette_text_color") or "#000000",
        "manual_palette_effect_color": text_zone_props.get("manual_palette_effect_color") or "#000000",
        "font_family": text_zone_props.get("font_family") or '"Bebas Neue", Impact, sans-serif',
        "text_color": text_zone_props.get("text_color") or "#000000",
        "text_effect": text_zone_props.get("text_effect") or "none",
        "text_effect_color": text_zone_props.get("text_effect_color") or "#000000",
        "text_effect_offset_x": int(text_zone_props.get("text_effect_offset_x", 2) or 2),
        "text_effect_offset_y": int(text_zone_props.get("text_effect_offset_y", 2) or 2),
        "text_effect_blur": int(text_zone_props.get("text_effect_blur", 0) or 0),
        "custom_font_file": text_zone_props.get("custom_font_file"),
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
    pin.text_align = settings.get("text_align")
    pin.font_family = settings.get("font_family")
    pin.custom_font_file = settings.get("custom_font_file")
    pin.text_zone_bg_color = settings.get("text_zone_bg_color")
    pin.text_color = settings.get("text_color")
    pin.text_effect = settings.get("text_effect")
    pin.text_effect_color = settings.get("text_effect_color")
    pin.text_effect_offset_x = settings.get("text_effect_offset_x")
    pin.text_effect_offset_y = settings.get("text_effect_offset_y")
    pin.text_effect_blur = settings.get("text_effect_blur")


def merge_pin_settings(pin: PinDraft, request_settings: Optional[PinRenderSettings]) -> dict:
    """Merge stored pin settings with request overrides."""
    settings = {
        "text_zone_y": pin.text_zone_y,
        "text_zone_height": pin.text_zone_height,
        "text_zone_pad_left": pin.text_zone_pad_left,
        "text_zone_pad_right": pin.text_zone_pad_right,
        "text_align": pin.text_align,
        "palette_mode": request_settings.palette_mode if request_settings else None,
        "font_family": pin.font_family,
        "custom_font_file": pin.custom_font_file,
        "text_zone_bg_color": pin.text_zone_bg_color,
        "text_color": pin.text_color,
        "text_effect": pin.text_effect,
        "text_effect_color": pin.text_effect_color,
        "text_effect_offset_x": pin.text_effect_offset_x,
        "text_effect_offset_y": pin.text_effect_offset_y,
        "text_effect_blur": pin.text_effect_blur,
        "brand_palette_background_color": request_settings.brand_palette_background_color if request_settings else None,
        "brand_palette_text_color": request_settings.brand_palette_text_color if request_settings else None,
        "brand_palette_effect_color": request_settings.brand_palette_effect_color if request_settings else None,
        "manual_palette_background_color": request_settings.manual_palette_background_color if request_settings else None,
        "manual_palette_text_color": request_settings.manual_palette_text_color if request_settings else None,
        "manual_palette_effect_color": request_settings.manual_palette_effect_color if request_settings else None,
    }
    if request_settings:
        settings.update(request_settings.model_dump(exclude_none=True))
    return settings


def fill_missing_settings_from_template(pin: PinDraft, db: Session, settings: dict) -> dict:
    """Backfill missing render settings from template defaults."""
    if not pin.template_id:
        return settings
    template = db.query(Template).filter(Template.id == pin.template_id).first()
    if not template:
        return settings
    text_zone = next((zone for zone in template.zones if zone.zone_type == "text"), None)
    props = text_zone.props if text_zone and text_zone.props else {}
    if not settings.get("text_align"):
        settings["text_align"] = props.get("text_align") or "left"
    if not settings.get("font_family"):
        settings["font_family"] = props.get("font_family") or '"Bebas Neue", Impact, sans-serif'
    if not settings.get("custom_font_file"):
        settings["custom_font_file"] = props.get("custom_font_file")
    if not settings.get("text_zone_bg_color"):
        settings["text_zone_bg_color"] = props.get("text_zone_bg_color") or "#ffffff"
    if not settings.get("text_color"):
        settings["text_color"] = props.get("text_color") or "#000000"
    if not settings.get("text_effect"):
        settings["text_effect"] = props.get("text_effect") or "none"
    if not settings.get("text_effect_color"):
        settings["text_effect_color"] = props.get("text_effect_color") or "#000000"
    if settings.get("text_effect_offset_x") is None:
        settings["text_effect_offset_x"] = int(props.get("text_effect_offset_x", 2) or 2)
    if settings.get("text_effect_offset_y") is None:
        settings["text_effect_offset_y"] = int(props.get("text_effect_offset_y", 2) or 2)
    if settings.get("text_effect_blur") is None:
        settings["text_effect_blur"] = int(props.get("text_effect_blur", 0) or 0)
    if settings.get("text_zone_y") is None and text_zone:
        settings["text_zone_y"] = text_zone.y
    if settings.get("text_zone_height") is None and text_zone:
        settings["text_zone_height"] = text_zone.height
    if settings.get("text_zone_pad_left") is None:
        settings["text_zone_pad_left"] = max(0, text_zone.x) if text_zone else 0
    if settings.get("text_zone_pad_right") is None:
        settings["text_zone_pad_right"] = max(0, template.width - (text_zone.x + text_zone.width)) if text_zone else 0
    return settings


def resolve_page_render_settings(
    page: Page,
    base_settings: dict,
    selected_image_url: str | None,
) -> dict:
    """Resolve palette-driven settings into concrete colors for a single page."""
    resolved = resolve_palette_settings(
        base_settings,
        image_url=selected_image_url,
        referer=page.url,
    )
    resolved["text_zone_bg_color"] = normalize_hex_color(resolved.get("text_zone_bg_color"), "#ffffff")
    resolved["text_color"] = normalize_hex_color(resolved.get("text_color"), "#000000")
    resolved["text_effect_color"] = normalize_hex_color(resolved.get("text_effect_color"), "#000000")
    return resolved


def sanitize_generated_text(value: str | None) -> str:
    """Normalize generated text to plain printable ASCII and collapse whitespace."""
    if not value:
        return ""

    cleaned = value.replace("\uFFFD", " ")
    cleaned = cleaned.replace("\r", " ").replace("\n", " ")
    cleaned = re.sub(r"[\x00-\x1F\x7F-\x9F]", " ", cleaned)
    cleaned = re.sub(r"[^\x20-\x7E]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_manual_keywords(value: str | None) -> list[str]:
    """Split comma-separated manual keywords."""
    if not value:
        return []
    keywords: list[str] = []
    seen: set[str] = set()
    for raw in value.split(","):
        keyword = raw.strip()
        if not keyword:
            continue
        lowered = keyword.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        keywords.append(keyword)
    return keywords


def clip_text(value: str, max_chars: int) -> str:
    """Trim text to max chars while preserving whole words when possible."""
    normalized = sanitize_generated_text(value)
    if max_chars <= 0 or len(normalized) <= max_chars:
        return normalized
    clipped = normalized[:max_chars].rstrip()
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0].rstrip()
    return clipped or normalized[:max_chars].rstrip()


def apply_cta(description: str, cta_style: str) -> str:
    """Append CTA phrase if requested."""
    if not description:
        return description
    cta = (cta_style or "soft").strip().lower()
    if cta == "none":
        return description
    suffix = " Try it today." if cta == "strong" else " Learn more."
    if description.endswith(("!", ".", "?")):
        return description + suffix
    return description + "." + suffix


def generate_pin_description(page: Page, keywords: List[str]) -> str:
    """Generate a pin description from page and keywords."""
    parts = []

    if page.title:
        parts.append(page.title)

    if keywords:
        parts.append(f"Keywords: {', '.join(keywords[:5])}")

    if page.url:
        parts.append(f"Read more at the link below.")

    return sanitize_generated_text("\n\n".join(parts) if parts else "")


def _derive_active_season_from_month(active_month: str) -> str | None:
    """Derive meteorological season for Northern Hemisphere from month name."""
    season_by_month = {
        "december": "winter",
        "january": "winter",
        "february": "winter",
        "march": "spring",
        "april": "spring",
        "may": "spring",
        "june": "summer",
        "july": "summer",
        "august": "summer",
        "september": "autumn",
        "october": "autumn",
        "november": "autumn",
    }
    return season_by_month.get(active_month)


def _normalize_text_for_match(value: str | None) -> str:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_url_slug(url: str | None) -> str:
    if not url:
        return ""
    slug = url.rstrip("/").split("/")[-1]
    return _normalize_text_for_match(slug)


def select_keywords_for_generation(page_keywords: List[PageKeyword]) -> List[str]:
    """Prioritize active month, then active season, then always, then fallback."""
    active_month = datetime.utcnow().strftime("%B").lower()
    active_season = _derive_active_season_from_month(active_month)
    month_keywords: list[str] = []
    season_keywords: list[str] = []
    always_keywords: list[str] = []
    fallback_keywords: list[str] = []

    for item in page_keywords:
        keyword = (item.keyword or "").strip()
        if not keyword:
            continue
        if (item.keyword_role or "seo").strip().lower() != "seo":
            continue

        period_type = (item.period_type or "always").strip().lower()
        period_value = (item.period_value or "").strip().lower()
        if period_type == "month" and period_value == active_month:
            month_keywords.append(keyword)
        elif period_type == "season" and active_season and period_value == active_season:
            season_keywords.append(keyword)
        elif period_type == "always":
            always_keywords.append(keyword)
        else:
            fallback_keywords.append(keyword)

    if month_keywords:
        ordered = month_keywords + [k for k in season_keywords if k not in month_keywords]
        ordered += [k for k in always_keywords if k not in ordered]
        return ordered
    if season_keywords:
        ordered = season_keywords + [k for k in always_keywords if k not in season_keywords]
        return ordered
    if always_keywords:
        return always_keywords
    return fallback_keywords


def page_matches_selection_keywords(page: Page, page_keywords: List[PageKeyword]) -> bool:
    """Return whether page is eligible based on active-period selection keywords."""
    selection_rows = [
        row for row in page_keywords
        if (row.keyword_role or "seo").strip().lower() == "selection"
    ]
    if not selection_rows:
        return False

    active_month = datetime.utcnow().strftime("%B").lower()
    active_season = _derive_active_season_from_month(active_month)

    active_keywords: list[str] = []
    for row in selection_rows:
        keyword = (row.keyword or "").strip()
        if not keyword:
            continue
        period_type = (row.period_type or "always").strip().lower()
        period_value = (row.period_value or "").strip().lower()
        if period_type == "always":
            active_keywords.append(keyword)
        elif period_type == "month" and period_value == active_month:
            active_keywords.append(keyword)
        elif period_type == "season" and active_season and period_value == active_season:
            active_keywords.append(keyword)

    if not active_keywords:
        return False

    haystack = " ".join([
        _normalize_text_for_match(page.title),
        _extract_url_slug(page.url),
        _normalize_text_for_match(page.section),
    ]).strip()
    if not haystack:
        return False

    for keyword in active_keywords:
        normalized_keyword = _normalize_text_for_match(keyword)
        if normalized_keyword and normalized_keyword in haystack:
            return True
    return False


def filter_pages_by_active_selection_keywords(pages: List[Page]) -> List[Page]:
    """Filter pages by active selection keywords when the candidate pool uses them.

    If the pool has no selection keywords configured at all, keep the original pages.
    This preserves normal generation for sites that don't use selection keywords yet,
    while making keyword-driven runs strict once selection rows exist.
    """
    has_any_selection_keywords = any(
        (item.keyword_role or "seo").strip().lower() == "selection"
        for page in pages
        for item in page.keywords
    )
    if not has_any_selection_keywords:
        return pages
    return [page for page in pages if page_matches_selection_keywords(page, page.keywords)]


def filter_boards_for_page_pool(boards: List[Board], page_ids: set[int]) -> List[Board]:
    """Keep only boards scoped to the current candidate page pool."""
    filtered: list[Board] = []
    for board in boards:
        source_page_ids = board.source_page_ids or []
        normalized_ids = {
            int(page_id)
            for page_id in source_page_ids
            if isinstance(page_id, int) or (isinstance(page_id, str) and str(page_id).isdigit())
        }
        if normalized_ids and (normalized_ids & page_ids):
            filtered.append(board)
    return filtered


def generate_pin_titles(
    page: Page,
    keywords: List[str],
    image_count: int,
    use_ai_titles: bool,
    preset: Optional[AIPromptPreset] = None,
    language: str = "English",
    website_name: str = "",
    tone: str = "seo-friendly",
    cta_style: str = "soft",
    title_max: int = 100,
) -> list[str]:
    """Generate one title per image for the page."""
    from services.ai_generation import generate_title_variants

    if use_ai_titles and preset:
        titles = generate_title_variants(
            page_title=page.title,
            keywords=keywords,
            count=image_count,
            preset={
                "prompt_template": preset.prompt_template,
                "model": preset.model,
                "temperature": preset.temperature,
                "max_tokens": preset.max_tokens,
                "language": language,
                "tone": tone,
                "cta_style": cta_style,
                "max_chars": title_max,
                "target_field": "title",
            },
            website_name=website_name,
            url=page.url,
            section=page.section or "",
        )
        if titles:
            return [clip_text(title, title_max) for title in titles]

    # Fallback to original behavior
    from services.seo_titles import (
        build_fallback_pin_title_variants,
        generate_ai_pin_title_variants,
    )

    if use_ai_titles:
        titles = generate_ai_pin_title_variants(page.title, keywords, image_count)
        if titles:
            return [clip_text(title, title_max) for title in titles]

    return [clip_text(title, title_max) for title in build_fallback_pin_title_variants(page.title, keywords, image_count)]


def get_preset_for_target(
    db: Session,
    target_field: str,
    preset_id: Optional[int] = None,
    settings: Optional[AISettings] = None,
) -> Optional[AIPromptPreset]:
    """Get a preset for a target field, using override or default."""
    if preset_id:
        return db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()

    if settings:
        if target_field == "title":
            preset_id = settings.default_title_preset_id
        elif target_field == "description":
            preset_id = settings.default_description_preset_id
        elif target_field == "board":
            preset_id = settings.default_board_preset_id

    if preset_id:
        return db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()

    return None


def generate_description_ai(
    page: Page,
    keywords: List[str],
    preset: Optional[AIPromptPreset] = None,
    language: str = "English",
    website_name: str = "",
    tone: str = "seo-friendly",
    cta_style: str = "soft",
    description_max: int = 500,
    generate_descriptions: bool = True,
) -> str:
    """Generate description using AI preset or fallback."""
    if not generate_descriptions:
        return ""

    from services.ai_generation import generate_description

    if preset:
        result = generate_description(
            page_title=page.title,
            keywords=keywords,
            preset={
                "prompt_template": preset.prompt_template,
                "model": preset.model,
                "temperature": preset.temperature,
                "max_tokens": preset.max_tokens,
                "language": language,
                "tone": tone,
                "cta_style": cta_style,
                "max_chars": description_max,
                "target_field": "description",
            },
            website_name=website_name,
            url=page.url,
            section=page.section or "",
            description="",
        )
        if result:
            return clip_text(apply_cta(sanitize_generated_text(result), cta_style), description_max)

    return clip_text(apply_cta(generate_pin_description(page, keywords), cta_style), description_max)


def generate_board_name_ai(
    page: Page,
    keywords: List[str],
    preset: Optional[AIPromptPreset] = None,
    language: str = "English",
    default_board: str = "General",
    website_name: str = "",
) -> str:
    """Generate board name using AI preset or fallback."""
    from services.ai_generation import generate_board_name

    if preset:
        result = generate_board_name(
            page_title=page.title,
            keywords=keywords,
            preset={
                "prompt_template": preset.prompt_template,
                "model": preset.model,
                "temperature": preset.temperature,
                "max_tokens": preset.max_tokens,
                "language": language,
            },
            website_name=website_name,
            url=page.url,
            section=page.section or "",
            description="",
        )
        if result:
            return sanitize_generated_text(result)

    return sanitize_generated_text(default_board)


def choose_images_for_mode(
    images: list[PageImage],
    mode: str,
    variation_options: dict | None = None,
) -> list[PageImage]:
    """Pick candidate images according to generation mode."""
    if not images:
        return []

    sorted_images = sorted(
        images,
        key=lambda img: (
            0 if img.category == "featured" else 1 if img.category == "article" else 2,
            -(img.width or 0) * (img.height or 0),
        ),
    )
    opts = variation_options or {}
    max_images = int(opts.get("max_images_per_page", 1 if mode == "conservative" else 3) or 1)
    max_images = max(1, min(max_images, len(sorted_images)))
    if mode == "conservative":
        return sorted_images[:max_images]
    return sorted_images[:max_images]


def _infer_orientation(image: PageImage) -> str:
    width = image.width or 0
    height = image.height or 0
    if width <= 0 or height <= 0:
        return "portrait"
    ratio = width / height
    if ratio > 1.1:
        return "landscape"
    if ratio < 0.9:
        return "portrait"
    return "square"


def apply_generation_image_filters(images: list[PageImage], site_settings: dict | None) -> list[PageImage]:
    """Apply image filters from website generation settings at backend level."""
    if not images:
        return images
    settings = site_settings or {}
    image_settings = {}
    if isinstance(settings.get("image"), dict):
        image_settings = settings.get("image", {})
    elif isinstance(settings.get("image_settings"), dict):
        image_settings = settings.get("image_settings", {})

    filtered = images

    if bool(image_settings.get("ignore_small_width", False)):
        min_width = int(image_settings.get("min_width", 200) or 200)
        filtered = [img for img in filtered if img.width is None or img.width >= min_width]

    if bool(image_settings.get("ignore_small_height", False)):
        min_height = int(image_settings.get("min_height", 200) or 200)
        filtered = [img for img in filtered if img.height is None or img.height >= min_height]

    orientations = image_settings.get("orientations") or image_settings.get("allowed_orientations")
    if isinstance(orientations, list):
        allowed = {str(item).strip().lower() for item in orientations if str(item).strip()}
        allowed &= {"portrait", "square", "landscape"}
        if allowed:
            filtered = [img for img in filtered if _infer_orientation(img) in allowed]

    return filtered


def _tokenize_for_board(value: str | None) -> set[str]:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return {token for token in text.split() if len(token) > 2}


def assign_board_name(
    page: Page,
    boards: list[Board],
    keywords: list[str],
    fallback: str,
) -> str:
    """Rule-based board assignment using section/title/url/keywords overlap."""
    if not boards:
        return sanitize_generated_text(fallback)

    page_tokens = set()
    page_tokens |= _tokenize_for_board(page.title)
    page_tokens |= _tokenize_for_board(page.section)
    page_tokens |= _tokenize_for_board(page.url)
    for keyword in keywords:
        page_tokens |= _tokenize_for_board(keyword)

    best: tuple[Board | None, int] = (None, -1)
    for board in boards:
        board_tokens = _tokenize_for_board(board.name) | _tokenize_for_board(board.keywords)
        overlap = len(page_tokens & board_tokens)
        score = overlap * 10 + board.priority
        if score > best[1]:
            best = (board, score)

    chosen = best[0] or boards[0]
    return sanitize_generated_text(chosen.name)


@router.post("/preview", response_model=GenerationPreviewResponse)
def preview_generation(
    request: GenerationPreviewRequest,
    db: Session = Depends(get_db),
):
    """Preview estimated generation output without creating pins."""
    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    query = db.query(Page).filter(Page.is_enabled == True)
    if request.page_ids:
        query = query.filter(Page.id.in_(request.page_ids))
    elif request.website_id:
        query = query.filter(Page.website_id == request.website_id)

    pages = query.all()
    pages = filter_pages_by_active_selection_keywords(pages)
    if not pages:
        return GenerationPreviewResponse(
            pages_count=0,
            estimated_pins=0,
            mode=request.mode,
            sample=[],
        )

    text_variations = int((request.variation_options or {}).get("text_variations", 1) or 1)
    text_variations = max(1, text_variations)
    template_image_slots = max(1, len([zone for zone in template.zones if zone.zone_type == "image"]))

    website_generation_settings: dict[int, dict] = {}
    website_ids = set(page.website_id for page in pages)
    if website_ids:
        websites = db.query(Website).filter(Website.id.in_(website_ids)).all()
        website_generation_settings = {w.id: (w.generation_settings or {}) for w in websites}

    estimated = 0
    sample: list[dict] = []
    for page in pages:
        images = (
            db.query(PageImage)
            .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
            .all()
        )
        site_settings = website_generation_settings.get(page.website_id, {})
        images = apply_generation_image_filters(images, site_settings)
        local_options = dict(request.variation_options or {})
        local_options.setdefault("max_images_per_page", template_image_slots)
        selected_images = choose_images_for_mode(images, request.mode, local_options)
        image_count = 1 if selected_images else 0
        variations = 1
        estimated += image_count * variations
        if len(sample) < 8:
            sample.append(
                {
                    "page_id": page.id,
                    "title": page.title,
                    "url": page.url,
                    "images_used": image_count,
                    "pins_projected": image_count * variations,
                }
            )

    return GenerationPreviewResponse(
        pages_count=len(pages),
        estimated_pins=estimated,
        mode=request.mode,
        sample=sample,
    )


@router.post("/generate", response_model=List[PinDraftResponse])
def generate_pins(
    request: PinGenerateRequest,
    db: Session = Depends(get_db),
):
    """Generate pin drafts from pages.

    Creates one pin per non-excluded image per page.
    """
    return _generate_pin_drafts(db, request, auto_scrape_missing=False)


@router.post("/generate-job", response_model=GenerationJobResponse, status_code=status.HTTP_202_ACCEPTED)
def generate_pins_job(
    request: PinGenerateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Start background pin generation job with progress tracking."""
    job = GenerationJob(
        website_id=request.website_id,
        template_id=request.template_id,
        status="queued",
        phase="queued",
        message="Queued generation job",
        request_payload=request.model_dump(exclude_none=True),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_generation_job, job.id)
    return job


@router.get("/generate-jobs/{job_id}", response_model=GenerationJobResponse)
def get_generation_job(job_id: int, db: Session = Depends(get_db)):
    """Get generation job status."""
    job = db.query(GenerationJob).filter(GenerationJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return job


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
        pin.title = sanitize_generated_text(update.title)
    if update.description is not None:
        pin.description = sanitize_generated_text(update.description)
    if update.board_name is not None:
        pin.board_name = sanitize_generated_text(update.board_name)
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
    if update.text_align is not None:
        pin.text_align = update.text_align
    if update.font_family is not None:
        pin.font_family = update.font_family
    if update.custom_font_file is not None:
        pin.custom_font_file = update.custom_font_file
    if update.text_color is not None:
        pin.text_color = update.text_color
    if update.text_effect is not None:
        pin.text_effect = update.text_effect
    if update.text_effect_color is not None:
        pin.text_effect_color = update.text_effect_color
    if update.text_effect_offset_x is not None:
        pin.text_effect_offset_x = update.text_effect_offset_x
    if update.text_effect_offset_y is not None:
        pin.text_effect_offset_y = update.text_effect_offset_y
    if update.text_effect_blur is not None:
        pin.text_effect_blur = update.text_effect_blur
    if update.status is not None:
        pin.status = update.status
    if update.is_selected is not None:
        pin.is_selected = update.is_selected

    pin.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pin)

    return pin


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_all_pins(
    request: PinDeleteRequest | None = None,
    db: Session = Depends(get_db),
):
    """Delete pin drafts.

    - No body: delete all pins.
    - `pin_ids`: delete only those pins.
    - `selected_only=true`: delete selected pins.
    """
    query = db.query(PinDraft)
    if request:
        if request.pin_ids:
            query = query.filter(PinDraft.id.in_(request.pin_ids))
        elif request.selected_only:
            query = query.filter(PinDraft.is_selected == True)

    query.delete(synchronize_session=False)

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
    settings = fill_missing_settings_from_template(pin, db, settings)
    settings = resolve_page_render_settings(pin.page, settings, pin.selected_image_url)
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
        base_settings = merge_pin_settings(pin, request.settings) if request.settings else template_settings
        resolved_settings = resolve_page_render_settings(pin.page, base_settings, pin.selected_image_url)
        persist_render_settings(
            pin,
            resolved_settings,
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
