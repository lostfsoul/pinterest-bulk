"""
Scheduling settings router.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import ScheduleSettings
from schemas import ScheduleSettingsResponse, ScheduleSettingsUpdate

router = APIRouter()


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
    elif settings.min_days_reuse < 31:
        settings.min_days_reuse = 31
        db.commit()
        db.refresh(settings)

    if settings.max_floating_minutes < 0:
        settings.max_floating_minutes = 0
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
    settings.random_minutes = update.random_minutes
    settings.warmup_month = update.warmup_month
    settings.floating_days = update.floating_days
    settings.max_floating_minutes = update.max_floating_minutes

    db.commit()
    db.refresh(settings)

    return settings
