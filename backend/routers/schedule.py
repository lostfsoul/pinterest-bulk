"""
Scheduling settings router.
"""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ScheduleSettings
from schemas import ScheduleSettingsResponse, ScheduleSettingsUpdate

router = APIRouter()


def _normalize_timezone(value: str | None) -> str:
    timezone = (value or "").strip() or "UTC"
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid timezone: {timezone}") from exc
    return timezone


@router.get("", response_model=ScheduleSettingsResponse)
def get_schedule_settings(db: Session = Depends(get_db)):
    """Get current schedule settings."""
    settings = db.query(ScheduleSettings).first()
    if not settings:
        # Create default settings
        settings = ScheduleSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    elif settings.min_days_reuse < 0:
        settings.min_days_reuse = 0
        db.commit()
        db.refresh(settings)

    if settings.max_floating_minutes < 0:
        settings.max_floating_minutes = 0
        db.commit()
        db.refresh(settings)

    timezone_value = (settings.timezone or "").strip()
    if not timezone_value:
        settings.timezone = "UTC"
        db.commit()
        db.refresh(settings)
    else:
        try:
            ZoneInfo(timezone_value)
        except ZoneInfoNotFoundError:
            settings.timezone = "UTC"
            db.commit()
            db.refresh(settings)

    return settings


@router.post("", response_model=ScheduleSettingsResponse)
def update_schedule_settings(
    update: ScheduleSettingsUpdate,
    db: Session = Depends(get_db),
):
    """Update schedule settings."""
    settings = db.query(ScheduleSettings).first()
    if not settings:
        settings = ScheduleSettings()
        db.add(settings)

    settings.pins_per_day = update.pins_per_day
    settings.start_hour = update.start_hour
    settings.end_hour = update.end_hour
    settings.min_days_reuse = update.min_days_reuse
    settings.timezone = _normalize_timezone(update.timezone)
    settings.random_minutes = update.random_minutes
    settings.warmup_month = update.warmup_month
    settings.floating_days = update.floating_days
    settings.max_floating_minutes = update.max_floating_minutes

    db.commit()
    db.refresh(settings)

    return settings
