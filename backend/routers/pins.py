"""
Pin draft generation and management router.
"""
import asyncio
import re
from datetime import datetime, timedelta
from typing import Callable, List, Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db, SessionLocal
from models import (
    Page,
    PageImage,
    SEOKeyword,
    PinDraft,
    Template,
    AIPromptPreset,
    AISettings,
    Website,
    GenerationJob,
    WebsiteTrendKeyword,
)
from schemas import (
    GenerationPreviewRequest,
    GenerationPreviewResponse,
    GenerationJobResponse,
    PinDraftDetailResponse,
    PinDraftResponse,
    PinDraftUpdate,
    PinGenerateRequest,
    PinRenderSettings,
)
from routers.images import scrape_page_into_db
from services.palette import normalize_hex_color, resolve_palette_settings
from services.trend_ranking import rank_pages_for_trends

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


class PinRegeneratePreviewRequest(BaseModel):
    """Request for building a candidate replacement for a single pin."""
    template_id: int | None = None
    selected_image_url: str | None = None
    regenerate_ai_content: bool = True
    ai_settings: dict | None = None


class PinRegenerateApplyRequest(BaseModel):
    """Request for applying a candidate replacement to a pin."""
    template_id: int | None = None
    selected_image_url: str | None = None
    title: str | None = None
    description: str | None = None
    board_name: str | None = None
    render_settings: Optional[PinRenderSettings] = None


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


def _split_keyword_csv(value: str | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in (value or "").split(","):
        keyword = item.strip()
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(keyword)
    return result


def _load_seo_keywords_by_url(db: Session, urls: list[str]) -> dict[str, list[str]]:
    if not urls:
        return {}
    rows = db.query(SEOKeyword).filter(SEOKeyword.url.in_(urls)).all()
    return {row.url: _split_keyword_csv(row.keywords) for row in rows}


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

    base_query = db.query(Page).filter(Page.is_enabled == True)
    if request.page_ids:
        pages = base_query.filter(Page.id.in_(request.page_ids)).all()
        order = {page_id: idx for idx, page_id in enumerate(request.page_ids)}
        pages.sort(key=lambda page: order.get(page.id, len(order)))
    elif request.website_id:
        pages = base_query.filter(Page.website_id == request.website_id).all()
    else:
        pages = base_query.all()

    if not pages:
        raise HTTPException(status_code=400, detail="No pages found")

    seo_keywords_by_url = _load_seo_keywords_by_url(db, [page.url for page in pages])

    page_website_names: dict[int, str] = {}
    website_generation_settings: dict[int, dict] = {}
    website_trend_keywords: dict[int, list[WebsiteTrendKeyword]] = {}
    website_ids = set(p.website_id for p in pages)
    if website_ids:
        websites = db.query(Website).filter(Website.id.in_(website_ids)).all()
        page_website_names = {w.id: w.name for w in websites}
        website_generation_settings = {w.id: (w.generation_settings or {}) for w in websites}
        trend_rows = (
            db.query(WebsiteTrendKeyword)
            .filter(WebsiteTrendKeyword.website_id.in_(website_ids))
            .all()
        )
        for row in trend_rows:
            website_trend_keywords.setdefault(row.website_id, []).append(row)

    pages, ranking_meta = rank_pages_for_trends(
        pages,
        trend_keywords_by_website=website_trend_keywords,
        generation_settings_by_website=website_generation_settings,
        top_n_override=request.top_n,
        similarity_threshold_override=request.similarity_threshold,
        diversity_enabled_override=request.diversity_enabled,
        diversity_penalty_override=request.diversity_penalty,
        semantic_enabled_override=request.semantic_enabled,
        seo_keywords_by_url=seo_keywords_by_url,
    )

    if not pages:
        raise HTTPException(status_code=400, detail="No pages available after trend ranking")

    return {
        "template": template,
        "render_settings": render_settings,
        "title_preset": title_preset,
        "description_preset": description_preset,
        "board_preset": board_preset,
        "default_language": default_language,
        "requested_language": requested_language,
        "pages": pages,
        "seo_keywords_by_url": seo_keywords_by_url,
        "page_website_names": page_website_names,
        "website_generation_settings": website_generation_settings,
        "ranking_meta": ranking_meta,
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
    seo_keywords_by_url: dict[str, list[str]] = context["seo_keywords_by_url"]
    page_website_names: dict[int, str] = context["page_website_names"]
    website_generation_settings: dict[int, dict] = context["website_generation_settings"]
    ranking_meta: dict = context.get("ranking_meta", {})

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
        ranking_applied=bool(ranking_meta.get("ranking_applied")),
        ranking_reason=ranking_meta.get("reason"),
    )

    for index, page in enumerate(pages, start=1):
        keywords = manual_keywords if use_manual_keywords else select_keywords_for_generation(
            seo_keywords_by_url.get(page.url, [])
        )
        website_name = page_website_names.get(page.website_id, "")
        site_settings = website_generation_settings.get(page.website_id, {})
        image_settings = {}
        content_settings = {}
        if isinstance(site_settings, dict):
            if isinstance(site_settings.get("image"), dict):
                image_settings = site_settings.get("image", {})
            elif isinstance(site_settings.get("image_settings"), dict):
                image_settings = site_settings.get("image_settings", {})

            if isinstance(site_settings.get("content"), dict):
                content_settings = site_settings.get("content", {})
            elif isinstance(site_settings.get("content_settings"), dict):
                content_settings = site_settings.get("content_settings", {})
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
        effective_image_settings = _resolve_effective_image_settings(site_settings, request.image_settings or None)
        if auto_scrape_missing and not images and bool(effective_image_settings.get("fetch_from_page", True)):
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

        images = apply_generation_image_filters(images, {"image_settings": effective_image_settings})
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
        pin_titles = _resolve_title_mode_variants(
            page=page,
            keywords=keywords,
            image_count=title_count,
            ai_settings=_playground_ai_settings_from_website_settings(site_settings),
            language=page_language,
            website_name=website_name,
            fallback_titles=pin_titles,
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
        board_candidates = extract_board_candidates(site_settings)
        default_board = board_candidates[0] if board_candidates else request.board_name
        pin_board = generate_board_name_ai(
            page,
            keywords,
            preset=board_preset,
            language=page_language,
            default_board=default_board,
            website_name=website_name,
            board_list=board_candidates,
        )
        pin_board = assign_board_name(
            page=page,
            board_candidates=board_candidates,
            keywords=keywords,
            ai_suggestion=pin_board,
            fallback=default_board,
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
                settings = merge_pin_settings(pin, request.render_settings)
                settings = fill_missing_settings_from_template(pin, db, settings)
                settings = resolve_page_render_settings(pin.page, settings, pin.selected_image_url)
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
        "font_family": text_zone_props.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif',
        "text_color": text_zone_props.get("text_color") or "#000000",
        "text_effect": text_zone_props.get("text_effect") or "none",
        "text_effect_color": text_zone_props.get("text_effect_color") or "#000000",
        "text_effect_offset_x": int(text_zone_props.get("text_effect_offset_x", 2) or 2),
        "text_effect_offset_y": int(text_zone_props.get("text_effect_offset_y", 2) or 2),
        "text_effect_blur": int(text_zone_props.get("text_effect_blur", 0) or 0),
        "title_scale": float(text_zone_props.get("title_scale", 1) or 1),
        "title_padding_x": int(text_zone_props.get("title_padding_x", 15) or 15),
        "line_height_multiplier": float(text_zone_props.get("line_height_multiplier", 1) or 1),
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
        "title_scale": None,
        "title_padding_x": None,
        "line_height_multiplier": None,
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
        settings["font_family"] = props.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'
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
    if settings.get("title_scale") is None:
        settings["title_scale"] = float(props.get("title_scale", 1) or 1)
    if settings.get("title_padding_x") is None:
        settings["title_padding_x"] = int(props.get("title_padding_x", 15) or 15)
    if settings.get("line_height_multiplier") is None:
        settings["line_height_multiplier"] = float(props.get("line_height_multiplier", 1) or 1)
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
    try:
        resolved["title_scale"] = max(0.7, min(1.6, float(resolved.get("title_scale", 1) or 1)))
    except (TypeError, ValueError):
        resolved["title_scale"] = 1.0
    try:
        resolved["title_padding_x"] = max(8, min(36, int(float(resolved.get("title_padding_x", 15) or 15))))
    except (TypeError, ValueError):
        resolved["title_padding_x"] = 15
    try:
        resolved["line_height_multiplier"] = max(0.8, min(1.35, float(resolved.get("line_height_multiplier", 1) or 1)))
    except (TypeError, ValueError):
        resolved["line_height_multiplier"] = 1.0
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


def select_keywords_for_generation(page_keywords: list[str]) -> list[str]:
    """Return de-duplicated SEO keywords for a page."""
    keywords: list[str] = []
    seen: set[str] = set()

    for item in page_keywords:
        keyword = (item or "").strip()
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        keywords.append(keyword)
    return keywords


def _playground_ai_settings_from_website_settings(site_settings: dict | None) -> dict:
    if not isinstance(site_settings, dict):
        return {}
    playground = site_settings.get("playground")
    if not isinstance(playground, dict):
        return {}
    ai_settings = playground.get("ai_settings")
    if isinstance(ai_settings, dict):
        return ai_settings
    return {}


def _resolve_title_mode_variants(
    *,
    page: Page,
    keywords: list[str],
    image_count: int,
    ai_settings: dict | None,
    language: str,
    website_name: str,
    fallback_titles: list[str],
    title_max: int,
) -> list[str]:
    settings = ai_settings if isinstance(ai_settings, dict) else {}
    mode = str(
        settings.get("templateTitleMode")
        or settings.get("template_title_mode")
        or "prompt"
    ).strip().lower()
    page_title = sanitize_generated_text(page.title or "") or sanitize_generated_text(page.url or "") or "Untitled"

    if mode == "original":
        return [clip_text(page_title, title_max) for _ in range(max(1, image_count))]

    prompt_template = str(
        settings.get("templateTitlePrompt")
        or settings.get("template_title_prompt")
        or ""
    ).strip()
    if mode == "prompt" and prompt_template:
        from services.ai_generation import DEFAULT_OPENAI_MODEL, generate_title_variants

        generated = generate_title_variants(
            page_title=page.title,
            keywords=keywords,
            count=max(1, image_count),
            preset={
                "prompt_template": prompt_template,
                "model": DEFAULT_OPENAI_MODEL,
                "temperature": 0.4,
                "max_tokens": 220,
                "language": language,
                "tone": "seo-friendly",
                "cta_style": "soft",
                "max_chars": title_max,
                "target_field": "title",
            },
            website_name=website_name,
            url=page.url,
            section=page.section or "",
        )
        if generated:
            clipped = [clip_text(item, title_max) for item in generated if str(item or "").strip()]
            if clipped:
                while len(clipped) < max(1, image_count):
                    clipped.append(clipped[len(clipped) % len(clipped)])
                return clipped[: max(1, image_count)]

    return fallback_titles


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
    board_list: list[str] | None = None,
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
            board_list=board_list or [],
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


def _resolve_effective_image_settings(
    site_settings: dict | None,
    request_image_settings: dict | None = None,
) -> dict:
    source = {}
    settings = site_settings or {}
    if isinstance(settings.get("image"), dict):
        source = dict(settings.get("image", {}))
    elif isinstance(settings.get("image_settings"), dict):
        source = dict(settings.get("image_settings", {}))

    if isinstance(request_image_settings, dict):
        source.update(request_image_settings)

    def _bool_any(*keys: str, default: bool = False) -> bool:
        for key in keys:
            if key in source:
                return bool(source.get(key))
        return default

    def _int_any(*keys: str, default: int = 0) -> int:
        for key in keys:
            if key in source:
                try:
                    return int(source.get(key))
                except (TypeError, ValueError):
                    return default
        return default

    raw_orientations = (
        source.get("allowed_orientations")
        or source.get("allowedOrientations")
        or source.get("orientations")
    )
    if isinstance(raw_orientations, list):
        allowed_orientations = [
            str(item).strip().lower()
            for item in raw_orientations
            if str(item).strip().lower() in {"portrait", "square", "landscape"}
        ]
    else:
        allowed_orientations = []

    return {
        "fetch_from_page": _bool_any("fetch_from_page", "fetchFromPage", default=True),
        "ignore_small_width": _bool_any("ignore_small_width", "ignoreSmallWidth", default=False),
        "min_width": max(1, _int_any("min_width", "minWidth", default=200)),
        "ignore_small_height": _bool_any("ignore_small_height", "ignoreSmallHeight", default=False),
        "min_height": max(1, _int_any("min_height", "minHeight", default=200)),
        "allowed_orientations": allowed_orientations,
        "limit_images_per_page": _bool_any("limit_images_per_page", "limitImagesPerPage", default=False),
    }


def apply_generation_image_filters(images: list[PageImage], site_settings: dict | None) -> list[PageImage]:
    """Apply image filters from website generation settings at backend level."""
    if not images:
        return images
    image_settings = _resolve_effective_image_settings(site_settings)

    filtered = images

    if bool(image_settings.get("ignore_small_width", False)):
        min_width = int(image_settings.get("min_width", 200) or 200)
        filtered = [img for img in filtered if img.width is None or img.width >= min_width]

    if bool(image_settings.get("ignore_small_height", False)):
        min_height = int(image_settings.get("min_height", 200) or 200)
        filtered = [img for img in filtered if img.height is None or img.height >= min_height]

    orientations = image_settings.get("allowed_orientations")
    if isinstance(orientations, list):
        allowed = {str(item).strip().lower() for item in orientations if str(item).strip()}
        allowed &= {"portrait", "square", "landscape"}
        if allowed:
            filtered = [img for img in filtered if _infer_orientation(img) in allowed]

    if bool(image_settings.get("limit_images_per_page", False)):
        filtered = filtered[:3]

    return filtered


def _tokenize_for_board(value: str | None) -> set[str]:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return {token for token in text.split() if len(token) > 2}


def normalize_board_candidates(values: list[str]) -> list[str]:
    """Normalize candidate board names while preserving order."""
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        candidate = sanitize_generated_text(raw)
        if not candidate:
            continue
        key = candidate.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(candidate)
    return normalized


def extract_board_candidates(site_settings: dict | None) -> list[str]:
    """Read board candidates from website generation settings."""
    if not isinstance(site_settings, dict):
        return []

    ai_settings = {}
    if isinstance(site_settings.get("ai"), dict):
        ai_settings = site_settings.get("ai", {})
    elif isinstance(site_settings.get("ai_settings"), dict):
        ai_settings = site_settings.get("ai_settings", {})

    candidates_raw = ai_settings.get("board_candidates")
    if not isinstance(candidates_raw, list):
        return []
    return normalize_board_candidates([str(item) for item in candidates_raw])


def _board_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def assign_board_name(
    page: Page,
    board_candidates: list[str],
    keywords: list[str],
    ai_suggestion: str,
    fallback: str,
) -> str:
    """Resolve final board name from allowed candidates and AI hint."""
    if not board_candidates:
        return sanitize_generated_text(fallback)

    normalized_candidates = normalize_board_candidates(board_candidates)
    if not normalized_candidates:
        return sanitize_generated_text(fallback)

    fallback_name = sanitize_generated_text(fallback) or normalized_candidates[0]
    suggestion = sanitize_generated_text(ai_suggestion)
    candidate_by_key = {_board_key(name): name for name in normalized_candidates}

    if suggestion:
        exact = candidate_by_key.get(_board_key(suggestion))
        if exact:
            return exact

    page_tokens = _tokenize_for_board(page.title) | _tokenize_for_board(page.section) | _tokenize_for_board(page.url)
    for keyword in keywords:
        page_tokens |= _tokenize_for_board(keyword)

    suggestion_tokens = _tokenize_for_board(suggestion)
    best_name = normalized_candidates[0]
    best_score = -1
    for candidate in normalized_candidates:
        candidate_tokens = _tokenize_for_board(candidate)
        score = len(candidate_tokens & page_tokens) * 10
        if suggestion_tokens:
            score += len(candidate_tokens & suggestion_tokens) * 5
        if score > best_score:
            best_score = score
            best_name = candidate

    if best_score <= 0:
        fallback_exact = candidate_by_key.get(_board_key(fallback_name))
        if fallback_exact:
            return fallback_exact

    return best_name


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
    if request.page_ids:
        order = {page_id: idx for idx, page_id in enumerate(request.page_ids)}
        pages.sort(key=lambda page: order.get(page.id, len(order)))
    if not pages:
        return GenerationPreviewResponse(
            pages_count=0,
            estimated_pins=0,
            mode=request.mode,
            sample=[],
        )

    seo_keywords_by_url = _load_seo_keywords_by_url(db, [page.url for page in pages])

    text_variations = int((request.variation_options or {}).get("text_variations", 1) or 1)
    text_variations = max(1, text_variations)
    template_image_slots = max(1, len([zone for zone in template.zones if zone.zone_type == "image"]))

    website_generation_settings: dict[int, dict] = {}
    website_trend_keywords: dict[int, list[WebsiteTrendKeyword]] = {}
    website_ids = set(page.website_id for page in pages)
    if website_ids:
        websites = db.query(Website).filter(Website.id.in_(website_ids)).all()
        website_generation_settings = {w.id: (w.generation_settings or {}) for w in websites}
        trend_rows = (
            db.query(WebsiteTrendKeyword)
            .filter(WebsiteTrendKeyword.website_id.in_(website_ids))
            .all()
        )
        for row in trend_rows:
            website_trend_keywords.setdefault(row.website_id, []).append(row)

    pages, ranking_meta = rank_pages_for_trends(
        pages,
        trend_keywords_by_website=website_trend_keywords,
        generation_settings_by_website=website_generation_settings,
        top_n_override=request.top_n,
        similarity_threshold_override=request.similarity_threshold,
        diversity_enabled_override=request.diversity_enabled,
        diversity_penalty_override=request.diversity_penalty,
        semantic_enabled_override=request.semantic_enabled,
        seo_keywords_by_url=seo_keywords_by_url,
    )

    if not pages:
        return GenerationPreviewResponse(
            pages_count=0,
            estimated_pins=0,
            mode=request.mode,
            sample=[],
        )

    estimated = 0
    sample: list[dict] = []
    score_by_page_id = {
        int(item.get("page_id")): item
        for item in ranking_meta.get("page_scores", [])
        if isinstance(item, dict) and item.get("page_id") is not None
    }
    for page in pages:
        images = (
            db.query(PageImage)
            .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
            .all()
        )
        site_settings = website_generation_settings.get(page.website_id, {})
        effective_image_settings = _resolve_effective_image_settings(site_settings, request.image_settings or None)
        images = apply_generation_image_filters(images, {"image_settings": effective_image_settings})
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
                    "relevance_score": score_by_page_id.get(page.id, {}).get("score"),
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
    website_id: int | None = None,
    db: Session = Depends(get_db),
):
    """List pin drafts with optional filters."""
    query = db.query(PinDraft)

    if website_id is not None:
        website = db.query(Website).filter(Website.id == website_id).first()
        conditions = [Page.website_id == website_id]

        if website and website.url:
            parsed = urlparse(website.url.strip())
            if parsed.scheme and parsed.netloc:
                domain_base = f"{parsed.scheme}://{parsed.netloc}"
                conditions.append(PinDraft.link.like(f"{domain_base}%"))
            else:
                raw_base = website.url.strip().rstrip("/")
                if raw_base:
                    conditions.append(PinDraft.link.like(f"{raw_base}%"))

        query = query.outerjoin(Page, PinDraft.page_id == Page.id).filter(or_(*conditions))
    if status:
        query = query.filter(PinDraft.status == status)
    if is_selected is not None:
        query = query.filter(PinDraft.is_selected == is_selected)

    return query.order_by(
        PinDraft.publish_date.is_(None).asc(),
        PinDraft.publish_date.asc(),
        PinDraft.created_at.desc(),
    ).all()


@router.get("/{pin_id}", response_model=PinDraftResponse)
def get_pin(pin_id: int, db: Session = Depends(get_db)):
    """Get a specific pin draft."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")
    return pin


@router.get("/{pin_id}/detail", response_model=PinDraftDetailResponse)
def get_pin_detail(pin_id: int, db: Session = Depends(get_db)):
    """Get detailed metadata for a specific pin draft."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")

    page = db.query(Page).filter(Page.id == pin.page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found for this pin")

    images = (
        db.query(PageImage)
        .filter(PageImage.page_id == pin.page_id)
        .order_by(
            PageImage.category.asc(),
            PageImage.is_excluded.asc(),
            PageImage.created_at.desc(),
        )
        .all()
    )

    return {
        "pin": pin,
        "page": page,
        "images": images,
    }


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

    if update.template_id is not None:
        if update.template_id <= 0:
            raise HTTPException(status_code=400, detail="template_id must be positive")
        template_exists = db.query(Template.id).filter(Template.id == update.template_id).first()
        if not template_exists:
            raise HTTPException(status_code=404, detail="Template not found")
        pin.template_id = update.template_id
    if update.selected_image_url is not None:
        pin.selected_image_url = update.selected_image_url
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


@router.post("/{pin_id}/regenerate-preview")
def regenerate_pin_preview(
    pin_id: int,
    request: PinRegeneratePreviewRequest,
    db: Session = Depends(get_db),
):
    """Build a candidate replacement for a single pin without persisting changes."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")
    page = db.query(Page).filter(Page.id == pin.page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found for this pin")
    website = db.query(Website).filter(Website.id == page.website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    candidate_template_id = request.template_id or pin.template_id
    if not candidate_template_id:
        raise HTTPException(status_code=400, detail="No template available for this pin")
    template = db.query(Template).filter(Template.id == candidate_template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    images = (
        db.query(PageImage)
        .filter(PageImage.page_id == pin.page_id, PageImage.is_excluded == False)  # noqa: E712
        .order_by(PageImage.category.asc(), PageImage.created_at.desc())
        .all()
    )
    available_urls = [img.url for img in images]
    selected_image_url = request.selected_image_url or pin.selected_image_url or (available_urls[0] if available_urls else None)

    title = pin.title or (page.title or "")
    description = pin.description or ""
    board_name = pin.board_name or "General"
    if request.regenerate_ai_content:
        try:
            from services.playground_service import generate_ai_preview_content

            generated = generate_ai_preview_content(
                db=db,
                website_id=website.id,
                page_url=page.url,
                ai_settings_override=request.ai_settings if isinstance(request.ai_settings, dict) else None,
            )
            title = generated.get("title") or title
            description = generated.get("description") or description
        except Exception:
            pass

    return {
        "pin_id": pin.id,
        "template_id": template.id,
        "template_name": template.name,
        "template_path": template.filename,
        "selected_image_url": selected_image_url,
        "available_images": available_urls,
        "candidate": {
            "title": sanitize_generated_text(title),
            "description": sanitize_generated_text(description),
            "board_name": sanitize_generated_text(board_name),
        },
    }


@router.post("/{pin_id}/regenerate-apply", response_model=PinDraftResponse)
def regenerate_pin_apply(
    pin_id: int,
    request: PinRegenerateApplyRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Apply a candidate replacement to a single pin and re-render it."""
    pin = db.query(PinDraft).filter(PinDraft.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin draft not found")

    if request.template_id is not None:
        if request.template_id <= 0:
            raise HTTPException(status_code=400, detail="template_id must be positive")
        template = db.query(Template).filter(Template.id == request.template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        pin.template_id = request.template_id
    if request.selected_image_url is not None:
        pin.selected_image_url = request.selected_image_url
    if request.title is not None:
        pin.title = sanitize_generated_text(request.title)
    if request.description is not None:
        pin.description = sanitize_generated_text(request.description)
    if request.board_name is not None:
        pin.board_name = sanitize_generated_text(request.board_name)

    settings = merge_pin_settings(pin, request.render_settings)
    settings = fill_missing_settings_from_template(pin, db, settings)
    settings = resolve_page_render_settings(pin.page, settings, pin.selected_image_url)
    persist_render_settings(pin, settings)

    pin.media_url = None
    pin.status = "draft"
    pin.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pin)

    background_tasks.add_task(render_pin_background, pin.id)
    return pin
