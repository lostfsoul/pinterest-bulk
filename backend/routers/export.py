"""
CSV export router.
"""
import csv
import asyncio
import os
import random
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import PinDraft, ExportLog, Page, ScheduleSettings, Template, Website
from schemas import ExportRequest, ExportResponse
from services.pin_renderer import RENDER_LAYOUT_VERSION, generate_pin_media_url, resolve_render_engine
from services.workflow_service import build_daily_slots_for_day, resolve_website_schedule_config

router = APIRouter()

# Export directory
EXPORT_DIR = Path(__file__).parent.parent.parent / "storage" / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_PINS_DIR = Path(__file__).parent.parent.parent / "storage" / "generated_pins"

MAX_PINTEREST_TITLE_LENGTH = 100
MAX_PINTEREST_DESCRIPTION_LENGTH = 500


def resolve_timezone(value: str | None) -> ZoneInfo:
    timezone = (value or "").strip() or "UTC"
    try:
        return ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def build_daily_slots(
    day_start: datetime,
    settings: ScheduleSettings,
    pins_per_day: int | None = None,
) -> list[datetime]:
    """Build publish slots for a single day."""
    window_start = day_start.replace(
        hour=settings.start_hour,
        minute=0,
        second=0,
        microsecond=0,
    )
    window_end = day_start.replace(
        hour=settings.end_hour,
        minute=0,
        second=0,
        microsecond=0,
    )
    if window_end <= window_start:
        window_end = window_start + timedelta(hours=1)

    slots_count = max(1, pins_per_day if pins_per_day is not None else settings.pins_per_day)
    window_seconds = max(60, int((window_end - window_start).total_seconds()))
    slots: list[datetime] = []

    for i in range(slots_count):
        interval_seconds = window_seconds / slots_count
        bucket_start_seconds = int(i * interval_seconds)
        bucket_end_seconds = int((i + 1) * interval_seconds)
        if bucket_end_seconds <= bucket_start_seconds:
            bucket_end_seconds = bucket_start_seconds + 1

        base_seconds = int((i + 0.5) * interval_seconds)
        if settings.random_minutes:
            max_offset_seconds = int(max(0, settings.max_floating_minutes) * 60)
            half_interval = max(0, int(interval_seconds / 2))
            allowed_offset = min(max_offset_seconds, half_interval)
            offset_seconds = random.randint(-allowed_offset, allowed_offset) if allowed_offset > 0 else 0
            slot_seconds = base_seconds + offset_seconds
        else:
            slot_seconds = base_seconds

        slot_seconds = max(bucket_start_seconds, min(bucket_end_seconds - 1, slot_seconds))

        slot = window_start + timedelta(seconds=slot_seconds)
        if slot >= window_end:
            slot = window_end - timedelta(seconds=1)

        slots.append(slot.replace(microsecond=0))

    return sorted(slots)


def resolve_pins_per_day_for_index(day_index: int, settings: ScheduleSettings) -> int:
    """Resolve daily pin volume after applying warmup and floating-day logic."""
    base_count = max(1, settings.pins_per_day)

    if settings.warmup_month:
        warmup_progress = min(1.0, (day_index + 1) / 30)
        base_count = max(1, round(settings.pins_per_day * warmup_progress))

    if settings.floating_days:
        base_count = max(1, base_count + random.randint(-2, 2))

    return base_count


def calculate_publish_dates(
    pins: List[PinDraft],
    settings: ScheduleSettings,
    website: Website | None = None,
    website_config: dict | None = None,
) -> List[tuple[PinDraft, datetime]]:
    """Calculate publish dates for pins based on schedule settings."""
    result: list[tuple[PinDraft, datetime]] = []
    url_last_used: dict[str, datetime] = {}
    sorted_pins = sorted(pins, key=lambda p: p.link or "")
    min_days_reuse = max(0, settings.min_days_reuse)
    timezone = resolve_timezone(settings.timezone)

    day_pointer = datetime.now(tz=timezone).replace(hour=0, minute=0, second=0, microsecond=0)
    day_index = 0
    if website and website_config:
        day_slots = build_daily_slots_for_day(
            website=website,
            config=website_config,
            day_start=day_pointer,
            day_index=day_index,
        )
    else:
        day_slots = build_daily_slots(
            day_pointer,
            settings,
            pins_per_day=resolve_pins_per_day_for_index(day_index, settings),
        )
    slot_index = 0

    for pin in sorted_pins:
        url = pin.link or ""

        while True:
            if slot_index >= len(day_slots):
                day_pointer = day_pointer + timedelta(days=1)
                day_index += 1
                if website and website_config:
                    day_slots = build_daily_slots_for_day(
                        website=website,
                        config=website_config,
                        day_start=day_pointer,
                        day_index=day_index,
                    )
                else:
                    day_slots = build_daily_slots(
                        day_pointer,
                        settings,
                        pins_per_day=resolve_pins_per_day_for_index(day_index, settings),
                    )
                slot_index = 0
                continue

            candidate = day_slots[slot_index]
            slot_index += 1

            last_used = url_last_used.get(url)
            if last_used and (candidate.date() - last_used.date()).days < min_days_reuse:
                continue

            result.append((pin, candidate))
            url_last_used[url] = candidate
            break

    return result


def get_public_base_url(request: Request) -> str:
    """Resolve the public base URL used for exported media URLs."""
    configured_base = os.getenv("PUBLIC_BASE_URL") or os.getenv("APP_BASE_URL")
    base_url = configured_base or str(request.base_url)
    return base_url.rstrip("/") + "/"


def build_public_media_url(media_url: str, request: Request) -> str:
    """Convert stored local media paths into public absolute URLs."""
    if media_url.startswith("http://") or media_url.startswith("https://"):
        return media_url
    return urljoin(get_public_base_url(request), media_url.lstrip("/"))


def format_publish_date(publish_date: datetime) -> str:
    """Format publish date in an ISO-like structure Pinterest accepts."""
    return publish_date.strftime("%Y-%m-%dT%H:%M:%S")


def normalize_board_name(board_name: str) -> str:
    """Normalize board names for export using '-' as the separator."""
    normalized = re.sub(r"\s*(/|\\\\|\||>|,)\s*", "-", board_name.strip())
    normalized = re.sub(r"\s+", "-", normalized)
    normalized = re.sub(r"\s*-\s*", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def _media_file_path(media_url: str | None) -> Path | None:
    if not media_url or not media_url.startswith("/static/pins/"):
        return None
    filename = media_url.rsplit("/", 1)[-1].split("?", 1)[0].strip()
    if not filename:
        return None
    return GENERATED_PINS_DIR / filename


def _media_file_exists(media_url: str | None) -> bool:
    path = _media_file_path(media_url)
    return bool(path and path.exists() and path.stat().st_size > 0)


def _media_renderer_version(media_url: str | None) -> int | None:
    if not media_url:
        return None
    try:
        query = parse_qs(urlparse(media_url).query)
        raw = (query.get("rv") or [None])[0]
        return int(raw) if raw is not None else None
    except Exception:
        return None


def _media_renderer_engine(media_url: str | None) -> str | None:
    if not media_url:
        return None
    try:
        query = parse_qs(urlparse(media_url).query)
        raw = (query.get("re") or [None])[0]
        if raw is None:
            return None
        return str(raw).strip().lower() or None
    except Exception:
        return None


def _media_file_is_current(pin: PinDraft) -> bool:
    path = _media_file_path(pin.media_url)
    if not path or not path.exists() or path.stat().st_size <= 0:
        return False
    if _media_renderer_version(pin.media_url) != RENDER_LAYOUT_VERSION:
        return False
    if _media_renderer_engine(pin.media_url) != resolve_render_engine():
        return False
    if not pin.updated_at:
        return True
    return path.stat().st_mtime >= pin.updated_at.timestamp()


def _resolve_render_settings(pin: PinDraft, db: Session) -> dict:
    settings = {
        "text_zone_y": pin.text_zone_y,
        "text_zone_height": pin.text_zone_height,
        "text_zone_pad_left": pin.text_zone_pad_left,
        "text_zone_pad_right": pin.text_zone_pad_right,
        "text_align": pin.text_align,
        "font_family": pin.font_family,
        "custom_font_file": pin.custom_font_file,
        "text_zone_bg_color": pin.text_zone_bg_color,
        "text_color": pin.text_color,
        "text_effect": pin.text_effect,
        "text_effect_color": pin.text_effect_color,
        "text_effect_offset_x": pin.text_effect_offset_x,
        "text_effect_offset_y": pin.text_effect_offset_y,
        "text_effect_blur": pin.text_effect_blur,
    }
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
    if settings.get("text_zone_y") is None and text_zone:
        settings["text_zone_y"] = text_zone.y
    if settings.get("text_zone_height") is None and text_zone:
        settings["text_zone_height"] = text_zone.height
    if settings.get("text_zone_pad_left") is None:
        settings["text_zone_pad_left"] = max(0, text_zone.x) if text_zone else 0
    if settings.get("text_zone_pad_right") is None:
        settings["text_zone_pad_right"] = max(0, template.width - (text_zone.x + text_zone.width)) if text_zone else 0
    return settings


def _dedupe_by_page_latest(pins: list[PinDraft]) -> list[PinDraft]:
    by_page: dict[int, PinDraft] = {}
    for pin in pins:
        current = by_page.get(pin.page_id)
        if current is None:
            by_page[pin.page_id] = pin
            continue
        current_sort = current.updated_at or current.created_at
        pin_sort = pin.updated_at or pin.created_at
        if pin_sort >= current_sort:
            by_page[pin.page_id] = pin
    return list(by_page.values())


@router.post("", response_model=ExportResponse)
def export_csv(
    http_request: Request,
    request: ExportRequest,
    db: Session = Depends(get_db),
):
    """Export pins to CSV file.

    Only exports pins that have been rendered (media_url is not None).
    """
    # Get pins to export
    query = db.query(PinDraft)

    if request.website_id is None:
        raise HTTPException(status_code=400, detail="website_id is required for export scheduling.")

    target_website: Website | None = None
    target_website_config: dict | None = None
    target_website = db.query(Website).filter(Website.id == request.website_id).first()
    if not target_website:
        raise HTTPException(status_code=404, detail="Website not found")
    query = query.join(Page, Page.id == PinDraft.page_id).filter(Page.website_id == request.website_id)

    if request.pin_ids:
        query = query.filter(PinDraft.id.in_(request.pin_ids))
    elif request.selected_only:
        query = query.filter(PinDraft.is_selected == True)

    pins = query.order_by(PinDraft.updated_at.desc(), PinDraft.created_at.desc()).all()

    if not pins:
        raise HTTPException(status_code=400, detail="No pins to export")

    # CSV-mode guardrail: default to one latest pin per source page unless explicit pin IDs are provided.
    if not request.pin_ids:
        pins = _dedupe_by_page_latest(pins)

    # Ensure media exists for export candidates; rerender with template defaults when needed.
    for pin in pins:
        if _media_file_is_current(pin):
            continue
        settings = _resolve_render_settings(pin, db)
        try:
            url = asyncio.run(generate_pin_media_url(pin, db, settings))
            if not url:
                pin.media_url = None
        except Exception:
            pin.media_url = None
    db.commit()

    # Filter out pins that are still not rendered/available.
    rendered_pins = [pin for pin in pins if _media_file_exists(pin.media_url)]

    if not rendered_pins:
        raise HTTPException(
            status_code=400,
            detail="No rendered pins to export. Please generate and render pins first."
        )

    # Get schedule settings
    settings = db.query(ScheduleSettings).first()
    if not settings:
        settings = ScheduleSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)

    target_website_config = resolve_website_schedule_config(db, target_website)
    timezone = target_website_config.get("timezone")
    if isinstance(timezone, str) and timezone.strip():
        settings.timezone = timezone.strip()

    # Calculate publish dates
    pins_with_dates = calculate_publish_dates(
        rendered_pins,
        settings,
        website=target_website,
        website_config=target_website_config,
    )

    # Create filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"pinterest_export_{timestamp}.csv"
    filepath = EXPORT_DIR / filename

    # Write CSV
    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'Title',
            'Media URL',
            'Pinterest board',
            'Description',
            'Link',
            'Publish date',
            'Keywords',
        ])

        for pin, publish_date in pins_with_dates:
            public_media_url = build_public_media_url(pin.media_url or "", http_request)
            date_str = format_publish_date(publish_date)
            title = (pin.title or "")[:MAX_PINTEREST_TITLE_LENGTH]
            description = (pin.description or "")[:MAX_PINTEREST_DESCRIPTION_LENGTH]
            board_name = normalize_board_name(pin.board_name or "")

            writer.writerow([
                title,
                public_media_url,
                board_name,
                description,
                pin.link or '',
                date_str,
                pin.keywords or '',
            ])

            # Update pin status
            pin.status = "exported"
            pin.publish_date = publish_date.replace(tzinfo=None)

    db.commit()

    # Log export
    export_log = ExportLog(
        pins_count=len(rendered_pins),
        file_path=str(filepath),
    )
    db.add(export_log)

    db.commit()

    return ExportResponse(
        pins_count=len(rendered_pins),
        file_path=str(filepath),
        download_url=f"/api/export/download/{filename}",
    )


@router.get("/download/{filename}")
async def download_export(filename: str):
    """Download an exported CSV file."""
    filepath = EXPORT_DIR / filename

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        filepath,
        media_type="text/csv",
        filename=filename,
    )


@router.get("/history")
def get_export_history(db: Session = Depends(get_db)):
    """Get export history."""
    logs = (
        db.query(ExportLog)
        .order_by(ExportLog.created_at.desc())
        .limit(20)
        .all()
    )

    return [
        {
            "id": log.id,
            "pins_count": log.pins_count,
            "filename": Path(log.file_path).name,
            "created_at": log.created_at,
        }
        for log in logs
    ]
