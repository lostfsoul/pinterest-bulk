"""
AI prompt presets router for managing customizable AI generation prompts.
"""
import os
from datetime import datetime
from typing import Dict, List, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import AIPromptPreset, AISettings
from schemas import (
    AIPromptPresetCreate,
    AIPromptPresetResponse,
    AIPromptPresetUpdate,
    AISettingsResponse,
    AISettingsUpdate,
)
from services.ai_generation import AVAILABLE_PLACEHOLDERS, LANGUAGE_OPTIONS

router = APIRouter()

MODEL_ALLOWLIST = [
    {"id": "gpt-4o-mini", "provider": "openai", "label": "GPT-4o Mini"},
    {"id": "gpt-4o", "provider": "openai", "label": "GPT-4o"},
    {"id": "gpt-4.1-mini", "provider": "openai", "label": "GPT-4.1 Mini"},
    {"id": "gpt-4.1", "provider": "openai", "label": "GPT-4.1"},
    {"id": "claude-3-5-haiku-latest", "provider": "anthropic", "label": "Claude 3.5 Haiku"},
    {"id": "claude-3-7-sonnet-latest", "provider": "anthropic", "label": "Claude 3.7 Sonnet"},
]


def _provider_has_key(provider: str) -> bool:
    if provider == "openai":
        return bool(os.getenv("OPENAI_API_KEY"))
    if provider == "anthropic":
        return bool(os.getenv("ANTHROPIC_API_KEY"))
    return False


def _is_model_allowed(model: str) -> bool:
    return any(item["id"] == model for item in MODEL_ALLOWLIST)


def _validate_model_availability(model: str) -> None:
    match = next((item for item in MODEL_ALLOWLIST if item["id"] == model), None)
    if not match:
        raise HTTPException(status_code=400, detail=f"Model '{model}' is not in allowlist")
    provider = match["provider"]
    if not _provider_has_key(provider):
        raise HTTPException(status_code=400, detail=f"{provider} provider is not configured on server")


# =============================================================================
# AI Settings (must come before /{preset_id} to avoid route conflicts)
# =============================================================================

def get_or_create_settings(db: Session) -> AISettings:
    """Get existing settings or create default."""
    settings = db.query(AISettings).first()
    if not settings:
        settings = AISettings(
            default_language="English",
            use_ai_by_default=True,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("/settings", response_model=AISettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    """Get AI settings."""
    return get_or_create_settings(db)


@router.put("/settings", response_model=AISettingsResponse)
def update_settings(update: AISettingsUpdate, db: Session = Depends(get_db)):
    """Update AI settings."""
    settings = get_or_create_settings(db)

    if update.default_title_preset_id is not None:
        settings.default_title_preset_id = update.default_title_preset_id
        # Also update is_default flags on presets
        _clear_default_for_target(db, "title", update.default_title_preset_id)
        _set_preset_as_default(db, "title", update.default_title_preset_id)
    if update.default_description_preset_id is not None:
        settings.default_description_preset_id = update.default_description_preset_id
        _clear_default_for_target(db, "description", update.default_description_preset_id)
        _set_preset_as_default(db, "description", update.default_description_preset_id)
    if update.default_board_preset_id is not None:
        settings.default_board_preset_id = update.default_board_preset_id
        _clear_default_for_target(db, "board", update.default_board_preset_id)
        _set_preset_as_default(db, "board", update.default_board_preset_id)
    if update.default_language is not None:
        settings.default_language = update.default_language
    if update.use_ai_by_default is not None:
        settings.use_ai_by_default = update.use_ai_by_default

    db.commit()
    db.refresh(settings)
    return settings


# =============================================================================
# Placeholders
# =============================================================================

@router.get("/placeholders")
def list_placeholders():
    """List available placeholders for prompt templates."""
    return {
        "placeholders": AVAILABLE_PLACEHOLDERS,
        "languages": LANGUAGE_OPTIONS,
    }


@router.get("/models")
def list_models():
    """List allowed AI models and provider availability."""
    return {
        "models": [
            {
                **item,
                "available": _provider_has_key(item["provider"]),
            }
            for item in MODEL_ALLOWLIST
        ]
    }


# =============================================================================
# AI Presets CRUD (/{preset_id} routes must come after specific routes)
# =============================================================================

@router.get("", response_model=list[AIPromptPresetResponse])
def list_presets(db: Session = Depends(get_db)):
    """List all AI prompt presets."""
    return db.query(AIPromptPreset).order_by(AIPromptPreset.created_at.desc()).all()


@router.post("", response_model=AIPromptPresetResponse)
def create_preset(preset: AIPromptPresetCreate, db: Session = Depends(get_db)):
    """Create a new AI prompt preset."""
    _validate_model_availability(preset.model)
    db_preset = AIPromptPreset(
        name=preset.name,
        target_field=preset.target_field,
        prompt_template=preset.prompt_template,
        model=preset.model,
        temperature=preset.temperature,
        max_tokens=preset.max_tokens,
        language=preset.language,
        is_default=preset.is_default,
    )
    db.add(db_preset)

    # If this preset is set as default, unset other defaults for same target
    # and update AISettings
    if preset.is_default:
        _clear_default_for_target(db, preset.target_field, db_preset.id)
        _update_settings_default(db, preset.target_field, db_preset.id)

    db.commit()
    db.refresh(db_preset)
    return db_preset


@router.get("/{preset_id}", response_model=AIPromptPresetResponse)
def get_preset(preset_id: int, db: Session = Depends(get_db)):
    """Get a specific preset."""
    preset = db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset


@router.put("/{preset_id}", response_model=AIPromptPresetResponse)
def update_preset(
    preset_id: int,
    update: AIPromptPresetUpdate,
    db: Session = Depends(get_db),
):
    """Update a preset."""
    preset = db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    if update.name is not None:
        preset.name = update.name
    if update.target_field is not None:
        preset.target_field = update.target_field
    if update.prompt_template is not None:
        preset.prompt_template = update.prompt_template
    if update.model is not None:
        _validate_model_availability(update.model)
        preset.model = update.model
    if update.temperature is not None:
        preset.temperature = update.temperature
    if update.max_tokens is not None:
        preset.max_tokens = update.max_tokens
    if update.language is not None:
        preset.language = update.language
    if update.is_default is not None:
        preset.is_default = update.is_default
        if update.is_default:
            _clear_default_for_target(db, preset.target_field, preset_id)

    preset.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    """Delete a preset."""
    preset = db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    db.delete(preset)
    db.commit()
    return None


@router.post("/{preset_id}/set-default", response_model=AIPromptPresetResponse)
def set_default_preset(preset_id: int, db: Session = Depends(get_db)):
    """Set a preset as the default for its target field."""
    preset = db.query(AIPromptPreset).filter(AIPromptPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    _clear_default_for_target(db, preset.target_field, preset_id)
    preset.is_default = True
    preset.updated_at = datetime.utcnow()
    _update_settings_default(db, preset.target_field, preset_id)
    db.commit()
    db.refresh(preset)
    return preset


def _clear_default_for_target(db: Session, target_field: str, exclude_id: int):
    """Clear is_default flag for all other presets with the same target field."""
    db.query(AIPromptPreset).filter(
        AIPromptPreset.target_field == target_field,
        AIPromptPreset.id != exclude_id,
    ).update({"is_default": False})


def _set_preset_as_default(db: Session, target_field: str, preset_id: int):
    """Set a specific preset as the default for its target field."""
    db.query(AIPromptPreset).filter(
        AIPromptPreset.id == preset_id,
        AIPromptPreset.target_field == target_field,
    ).update({"is_default": True})


def _update_settings_default(db: Session, target_field: str, preset_id: int):
    """Update AISettings to reference the new default preset."""
    settings = db.query(AISettings).first()
    if not settings:
        settings = AISettings(
            default_language="English",
            use_ai_by_default=True,
        )
        db.add(settings)

    if target_field == "title":
        settings.default_title_preset_id = preset_id
    elif target_field == "description":
        settings.default_description_preset_id = preset_id
    elif target_field == "board":
        settings.default_board_preset_id = preset_id
