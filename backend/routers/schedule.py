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

    db.commit()
    db.refresh(settings)

    return settings
