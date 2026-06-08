"""Password-protected destructive maintenance operations."""

from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AISettings,
    AIPromptPreset,
    CustomFont,
    ExportLog,
    GenerationJob,
    GlobalExcludedImage,
    ImportLog,
    Page,
    PageImage,
    PinDraft,
    ScheduleSettings,
    SEOKeyword,
    Template,
    TemplateZone,
    Website,
    WebsiteTrendKeyword,
)


router = APIRouter()
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_DIR = PROJECT_ROOT / "storage" / "templates"
OVERLAY_DIR = PROJECT_ROOT / "storage" / "overlays"
FONT_DIR = PROJECT_ROOT / "storage" / "fonts"
GENERATED_PIN_DIR = PROJECT_ROOT / "storage" / "generated_pins"
EXPORT_DIR = PROJECT_ROOT / "storage" / "exports"


class SuperAdminPasswordRequest(BaseModel):
    password: str


class SuperAdminActionResponse(BaseModel):
    message: str
    deleted_records: int = 0
    deleted_files: int = 0


def _configured_password() -> str:
    return os.getenv("SUPER_ADMIN_PASSWORD", "pswrd4admin").strip()


def _verify_password(password: str) -> None:
    configured = _configured_password()
    if not configured or not hmac.compare_digest(password, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid super admin password",
        )


def _block_during_generation(db: Session) -> None:
    active = (
        db.query(GenerationJob.id)
        .filter(GenerationJob.status.in_(["queued", "running"]))
        .first()
    )
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wait for the active generation job to finish before clearing data.",
        )


def _delete_directory_files(directory: Path) -> int:
    if not directory.exists():
        return 0
    deleted = 0
    for path in directory.rglob("*"):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        try:
            path.unlink()
            deleted += 1
        except OSError:
            continue
    return deleted


@router.post("/verify", response_model=SuperAdminActionResponse, include_in_schema=False)
def verify_super_admin(payload: SuperAdminPasswordRequest) -> SuperAdminActionResponse:
    _verify_password(payload.password)
    return SuperAdminActionResponse(message="Super admin access granted.")


@router.post("/delete-svgs", response_model=SuperAdminActionResponse, include_in_schema=False)
def delete_all_svgs(
    payload: SuperAdminPasswordRequest,
    db: Session = Depends(get_db),
) -> SuperAdminActionResponse:
    _verify_password(payload.password)
    _block_during_generation(db)

    templates = db.query(Template).all()
    template_count = len(templates)
    for website in db.query(Website).all():
        settings = dict(website.generation_settings or {})
        playground = dict(settings.get("playground") or {})
        playground["selected_templates"] = []
        playground["default_template_id"] = None
        settings["playground"] = playground
        website.generation_settings = settings
    db.query(PinDraft).update({PinDraft.template_id: None}, synchronize_session=False)
    db.query(GenerationJob).update({GenerationJob.template_id: None}, synchronize_session=False)
    db.query(TemplateZone).delete(synchronize_session=False)
    db.query(Template).delete(synchronize_session=False)
    db.commit()

    deleted_files = (
        _delete_directory_files(TEMPLATE_DIR)
        + _delete_directory_files(OVERLAY_DIR)
    )
    return SuperAdminActionResponse(
        message="All SVG templates and overlays were deleted.",
        deleted_records=template_count,
        deleted_files=deleted_files,
    )


@router.post("/clear-database", response_model=SuperAdminActionResponse, include_in_schema=False)
def clear_database(
    payload: SuperAdminPasswordRequest,
    db: Session = Depends(get_db),
) -> SuperAdminActionResponse:
    _verify_password(payload.password)
    _block_during_generation(db)

    models_in_delete_order = [
        AISettings,
        GenerationJob,
        PinDraft,
        TemplateZone,
        PageImage,
        WebsiteTrendKeyword,
        ImportLog,
        ExportLog,
        SEOKeyword,
        GlobalExcludedImage,
        Page,
        Website,
        Template,
        CustomFont,
        AIPromptPreset,
        ScheduleSettings,
    ]
    deleted_records = 0
    try:
        for model in models_in_delete_order:
            deleted_records += db.query(model).delete(synchronize_session=False)
        db.add(ScheduleSettings())
        db.add(AISettings())
        db.commit()
    except Exception:
        db.rollback()
        raise

    deleted_files = sum(
        _delete_directory_files(directory)
        for directory in (
            TEMPLATE_DIR,
            OVERLAY_DIR,
            FONT_DIR,
            GENERATED_PIN_DIR,
            EXPORT_DIR,
        )
    )
    return SuperAdminActionResponse(
        message="Database and generated application files were cleared.",
        deleted_records=deleted_records,
        deleted_files=deleted_files,
    )
