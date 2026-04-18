"""Playground API router."""

from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from services.playground_service import (
    build_preview_metadata,
    generate_ai_preview_content,
    get_settings,
    list_font_sets,
    list_pages,
    list_templates,
    save_settings,
    scrape_page_images,
)

router = APIRouter()


@router.get("/pages")
def get_playground_pages(website_id: int = Query(...), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return list_pages(db, website_id)


@router.get("/templates")
def get_playground_templates(db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    return {"templates": list_templates(db)}


@router.get("/fonts")
def get_playground_fonts(db: Session = Depends(get_db)) -> list[dict[str, str]]:
    return list_font_sets(db)


@router.get("/settings")
def get_playground_settings(website_id: int = Query(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_settings(db, website_id)


@router.post("/settings")
def post_playground_settings(
    website_id: int = Query(...),
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return save_settings(db, website_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/preview")
def get_playground_preview(
    website_id: int = Query(...),
    page_url: str = Query(...),
    template_id: int = Query(...),
    font_set_id: str | None = Query(None),
    font_color: str | None = Query(None),
    ai_settings: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        ai_settings_payload: dict[str, Any] | None = None
        if ai_settings:
            try:
                parsed = json.loads(ai_settings)
                if isinstance(parsed, dict):
                    ai_settings_payload = parsed
            except json.JSONDecodeError:
                ai_settings_payload = None
        return build_preview_metadata(
            db=db,
            website_id=website_id,
            page_url=page_url,
            template_id=template_id,
            font_set_id=font_set_id,
            font_color=font_color,
            ai_settings_override=ai_settings_payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/scrape-images")
async def get_playground_scrape_images(url: str = Query(...)) -> dict[str, Any]:
    if not str(url or "").strip():
        raise HTTPException(status_code=400, detail="url is required")
    try:
        return await scrape_page_images(url)
    except httpx.HTTPError as exc:  # type: ignore[name-defined]
        raise HTTPException(status_code=502, detail=f"Failed to scrape page: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected scrape error: {exc}") from exc


@router.post("/generate-content")
def post_playground_generate_content(
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    website_id = int(payload.get("website_id") or 0)
    page_url = str(payload.get("page_url") or "").strip()
    if website_id <= 0 or not page_url:
        raise HTTPException(status_code=400, detail="website_id and page_url are required")
    ai_settings = payload.get("ai_settings") if isinstance(payload.get("ai_settings"), dict) else None
    try:
        return generate_ai_preview_content(
            db=db,
            website_id=website_id,
            page_url=page_url,
            ai_settings_override=ai_settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
