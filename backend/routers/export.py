"""
CSV export router.
"""
import csv
import os
import random
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List
from urllib.parse import urljoin
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import PinDraft, ExportLog, ScheduleSettings, ActivityLog
from schemas import ExportRequest, ExportResponse

router = APIRouter()

# Export directory
EXPORT_DIR = Path(__file__).parent.parent.parent / "storage" / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

MAX_PINTEREST_TITLE_LENGTH = 100
MAX_PINTEREST_DESCRIPTION_LENGTH = 500


def build_daily_slots(day_start: datetime, settings: ScheduleSettings) -> list[datetime]:
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

    slots_count = max(1, settings.pins_per_day)
    window_seconds = max(60, int((window_end - window_start).total_seconds()))
    slots: list[datetime] = []

    for i in range(slots_count):
        bucket_start_seconds = int(i * window_seconds / slots_count)
        bucket_end_seconds = int((i + 1) * window_seconds / slots_count)
        if bucket_end_seconds <= bucket_start_seconds:
            bucket_end_seconds = bucket_start_seconds + 1

        if settings.random_minutes:
            slot_seconds = random.randint(bucket_start_seconds, bucket_end_seconds - 1)
        else:
            slot_seconds = bucket_start_seconds

        slot = window_start + timedelta(seconds=slot_seconds)
        if slot >= window_end:
            slot = window_end - timedelta(seconds=1)

        slots.append(slot.replace(microsecond=0))

    return sorted(slots)


def calculate_publish_dates(
    pins: List[PinDraft],
    settings: ScheduleSettings,
) -> List[tuple[PinDraft, datetime]]:
    """Calculate publish dates for pins based on schedule settings."""
    result: list[tuple[PinDraft, datetime]] = []
    url_last_used: dict[str, datetime] = {}
    sorted_pins = sorted(pins, key=lambda p: p.link or "")
    min_days_reuse = max(31, settings.min_days_reuse)

    day_pointer = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    day_slots = build_daily_slots(day_pointer, settings)
    slot_index = 0

    for pin in sorted_pins:
        url = pin.link or ""

        while True:
            if slot_index >= len(day_slots):
                day_pointer = day_pointer + timedelta(days=1)
                day_slots = build_daily_slots(day_pointer, settings)
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

    if request.pin_ids:
        query = query.filter(PinDraft.id.in_(request.pin_ids))
    elif request.selected_only:
        query = query.filter(PinDraft.is_selected == True)

    pins = query.all()

    if not pins:
        raise HTTPException(status_code=400, detail="No pins to export")

    # Filter out pins that haven't been rendered (no media_url)
    rendered_pins = [pin for pin in pins if pin.media_url and pin.media_url.startswith('/static/')]

    if not rendered_pins:
        raise HTTPException(
            status_code=400,
            detail="No rendered pins to export. Please generate and render pins first."
        )

    # Get schedule settings
    settings = db.query(ScheduleSettings).first()

    # Calculate publish dates
    pins_with_dates = calculate_publish_dates(rendered_pins, settings)

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
            pin.publish_date = publish_date

    db.commit()

    # Log export
    export_log = ExportLog(
        pins_count=len(rendered_pins),
        file_path=str(filepath),
    )
    db.add(export_log)

    # Log activity
    activity = ActivityLog(
        action="exported",
        entity_type="export",
        entity_id=0,
        details={"pins_count": len(rendered_pins), "filename": filename, "skipped_unrendered": len(pins) - len(rendered_pins)},
    )
    db.add(activity)
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
