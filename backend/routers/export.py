"""
CSV export router.
"""
import csv
import os
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import PinDraft, ExportLog, ScheduleSettings, ActivityLog
from schemas import ExportRequest, ExportResponse

router = APIRouter()

# Export directory
EXPORT_DIR = Path(__file__).parent.parent.parent / "storage" / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def calculate_publish_dates(
    pins: List[PinDraft],
    settings: ScheduleSettings,
) -> List[tuple[PinDraft, datetime]]:
    """Calculate publish dates for pins based on schedule settings."""
    result = []
    current_date = datetime.now().replace(minute=0, second=0, microsecond=0)
    current_date = current_date.replace(hour=settings.start_hour)

    pins_by_url = {}
    for pin in pins:
        url = pin.link or ""
        if url not in pins_by_url:
            pins_by_url[url] = []
        pins_by_url[url].append(pin)

    url_last_used = {}

    # Sort pins to distribute URLs
    sorted_pins = sorted(pins, key=lambda p: p.link or "")

    for pin in sorted_pins:
        # Find next available slot
        while True:
            # Check if we've exceeded end hour
            if current_date.hour >= settings.end_hour:
                # Move to next day
                current_date = current_date + timedelta(days=1)
                current_date = current_date.replace(hour=settings.start_hour)

            # Check if URL was used recently
            url = pin.link or ""
            last_used = url_last_used.get(url)
            if last_used and (current_date - last_used).days < settings.min_days_reuse:
                # Skip to next available day
                current_date = current_date + timedelta(days=1)
                current_date = current_date.replace(hour=settings.start_hour)
                continue

            break

        # Add random minutes if enabled
        publish_date = current_date
        if settings.random_minutes:
            publish_date = publish_date.replace(
                minute=random.randint(0, 59)
            )

        result.append((pin, publish_date))
        url_last_used[url] = publish_date

        # Move to next slot
        current_date = current_date + timedelta(hours=24 // settings.pins_per_day)
        if settings.random_minutes:
            current_date = current_date.replace(minute=0)

    return result


@router.post("", response_model=ExportResponse)
def export_csv(
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
            # Format publish date
            date_str = publish_date.strftime("%Y-%m-%d %H:%M")

            writer.writerow([
                pin.title or '',
                pin.media_url or '',
                pin.board_name or '',
                pin.description or '',
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
