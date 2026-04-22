"""Template management router (detection-first SVG pipeline)."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from database import get_db
from models import CustomFont, Template, TemplateZone
from schemas import (
    TemplateDetectionFinalizeRequest,
    TemplateDetectionStartRequest,
    TemplateManifestUpdate,
    TemplateResponse,
    TemplateWithZones,
    TemplateZoneResponse,
)
from services.template_detection import (
    build_manifest_v2,
    migrate_manifest_to_v2,
    normalize_manifest_v2,
    parse_ocr_results,
    parse_svg_structure,
    project_manifest_v2_to_legacy_zones,
    render_candidate_crops,
)
from services.template_parser import parse_svg_template

router = APIRouter()
logger = logging.getLogger(__name__)

# Storage directories
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage" / "templates"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path(__file__).parent.parent.parent / "storage" / "fonts"
FONT_DIR.mkdir(parents=True, exist_ok=True)
OVERLAYS_DIR = Path(__file__).parent.parent.parent / "storage" / "overlays"
OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)


def _read_template_svg(template: Template) -> str:
    path = STORAGE_DIR / template.filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")
    return path.read_text(encoding="utf-8")


def _write_template_svg(template: Template, svg_content: str) -> None:
    path = STORAGE_DIR / template.filename
    path.write_text(svg_content, encoding="utf-8")


def _write_overlay_svg(template: Template, svg_content: str) -> None:
    overlay_filename = template.overlay_svg or f"{Path(template.filename).stem}_overlay.svg"
    overlay_path = OVERLAYS_DIR / overlay_filename
    stripped_svg = svg_content
    try:
        parsed = parse_svg_template(svg_content)
        stripped_svg = str(parsed.get("stripped_svg") or svg_content)
    except Exception as exc:
        logger.warning("Overlay parse fallback for template %s: %s", template.id, exc)
    overlay_path.write_text(stripped_svg, encoding="utf-8")
    template.overlay_svg = overlay_filename


def _replace_template_zones_from_manifest(template: Template, manifest: dict[str, Any], db: Session) -> None:
    projected = project_manifest_v2_to_legacy_zones(manifest)
    image_zones = projected.get("image_zones") if isinstance(projected.get("image_zones"), list) else []
    text_zone = projected.get("text_zone") if isinstance(projected.get("text_zone"), dict) else {}

    for zone in list(template.zones):
        db.delete(zone)
    db.flush()

    for index, zone in enumerate(image_zones):
        if not isinstance(zone, dict):
            continue
        db.add(
            TemplateZone(
                template_id=template.id,
                zone_type="image",
                x=int(zone.get("x") or 0),
                y=int(zone.get("y") or 0),
                width=max(1, int(zone.get("width") or 1)),
                height=max(1, int(zone.get("height") or 1)),
                props={"zone_index": int(zone.get("zone_index") or index)},
            )
        )

    if text_zone:
        props = text_zone.get("props") if isinstance(text_zone.get("props"), dict) else {}
        db.add(
            TemplateZone(
                template_id=template.id,
                zone_type="text",
                x=int(text_zone.get("x") or 0),
                y=int(text_zone.get("y") or 0),
                width=max(1, int(text_zone.get("width") or template.width or 1)),
                height=max(1, int(text_zone.get("height") or max(1, int(template.height * 0.12)) or 1)),
                props=props,
            )
        )


def _zones_need_refresh(template: Template, manifest: dict[str, Any]) -> bool:
    projected = project_manifest_v2_to_legacy_zones(manifest)
    image_zones = projected.get("image_zones") if isinstance(projected.get("image_zones"), list) else []
    text_zone = projected.get("text_zone") if isinstance(projected.get("text_zone"), dict) else {}

    stored_images = [zone for zone in template.zones if zone.zone_type == "image"]
    stored_text = next((zone for zone in template.zones if zone.zone_type == "text"), None)

    if len(stored_images) != len(image_zones):
        return True
    if bool(stored_text) != bool(text_zone):
        return True

    if stored_text and text_zone:
        if (
            stored_text.x != int(text_zone.get("x") or 0)
            or stored_text.y != int(text_zone.get("y") or 0)
            or stored_text.width != max(1, int(text_zone.get("width") or 1))
            or stored_text.height != max(1, int(text_zone.get("height") or 1))
        ):
            return True

        expected_secondary = []
        props = text_zone.get("props") if isinstance(text_zone.get("props"), dict) else {}
        if isinstance(props.get("secondary_text_slots"), list):
            expected_secondary = props.get("secondary_text_slots")
        current_secondary = []
        if isinstance(stored_text.props, dict) and isinstance(stored_text.props.get("secondary_text_slots"), list):
            current_secondary = stored_text.props.get("secondary_text_slots")
        if len(current_secondary) != len(expected_secondary):
            return True

    return False


def _sync_template_manifest(template: Template, db: Session, *, force: bool = False) -> Template:
    svg_content = _read_template_svg(template)
    try:
        structure = parse_svg_structure(svg_content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid SVG for template {template.id}: {exc}") from exc
    normalized = normalize_manifest_v2(migrate_manifest_to_v2(template.template_manifest, structure))

    changed = force or template.template_manifest != normalized
    if changed:
        template.template_manifest = normalized

    if force or _zones_need_refresh(template, normalized):
        _replace_template_zones_from_manifest(template, normalized, db)
        changed = True

    canvas = normalized.get("canvas") if isinstance(normalized.get("canvas"), dict) else {}
    width = int(canvas.get("target_width") or canvas.get("source_width") or template.width or 750)
    height = int(canvas.get("target_height") or canvas.get("source_height") or template.height or 1575)
    if template.width != width or template.height != height:
        template.width = width
        template.height = height
        changed = True

    if force:
        _write_overlay_svg(template, svg_content)

    if changed:
        db.commit()
        db.refresh(template)

    return template


def _build_detected_manifest(template: Template, ocr_results_payload: list[dict[str, Any]] | None) -> dict[str, Any]:
    svg_content = _read_template_svg(template)
    structure = parse_svg_structure(svg_content)
    existing = normalize_manifest_v2(migrate_manifest_to_v2(template.template_manifest, structure))
    ocr_results = parse_ocr_results(ocr_results_payload)
    detected = build_manifest_v2(structure, ocr_results=ocr_results, previous_manifest=existing)
    return normalize_manifest_v2(detected)


@router.get("", response_model=list[TemplateWithZones])
def list_templates(db: Session = Depends(get_db)):
    """List all templates with synchronized detection manifests."""
    templates = db.query(Template).order_by(Template.created_at.desc()).all()
    changed = False
    for template in templates:
        try:
            before = template.template_manifest
            _sync_template_manifest(template, db)
            changed = changed or before != template.template_manifest
        except HTTPException:
            continue
        except Exception as exc:
            logger.warning("Template sync skipped for %s: %s", template.id, exc)
    if changed:
        templates = db.query(Template).order_by(Template.created_at.desc()).all()
    return templates


@router.post("/upload", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def upload_template(
    request: Request,
    name: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    """Upload a new SVG template and run initial detection."""
    logger.info("Template upload request from %s", request.client.host if request.client else "unknown")

    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    if not file or not file.filename:
        raise HTTPException(status_code=422, detail="No file uploaded")
    if not file.filename.lower().endswith(".svg"):
        raise HTTPException(status_code=400, detail="File must be an SVG")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        svg_content = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="File must be valid UTF-8 text") from exc

    try:
        structure = parse_svg_structure(svg_content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse SVG structure: {exc}") from exc

    file_id = str(uuid.uuid4())
    filename = f"{file_id}.svg"
    (STORAGE_DIR / filename).write_text(svg_content, encoding="utf-8")

    manifest = normalize_manifest_v2(build_manifest_v2(structure, ocr_results=None, previous_manifest=None))
    canvas = manifest.get("canvas") if isinstance(manifest.get("canvas"), dict) else {}

    template = Template(
        name=name,
        filename=filename,
        width=int(canvas.get("target_width") or canvas.get("source_width") or 750),
        height=int(canvas.get("target_height") or canvas.get("source_height") or 1575),
        template_manifest=manifest,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    _write_overlay_svg(template, svg_content)
    _replace_template_zones_from_manifest(template, manifest, db)
    db.commit()
    db.refresh(template)

    return template


@router.get("/{template_id}", response_model=TemplateWithZones)
def get_template(template_id: int, db: Session = Depends(get_db)):
    """Get a single template with synced manifest/zones."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return _sync_template_manifest(template, db)


@router.post("/{template_id}/detect/start")
def detect_template_start(
    template_id: int,
    payload: TemplateDetectionStartRequest,
    db: Session = Depends(get_db),
):
    """Start detection: parse structure and return OCR crop candidates."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    svg_content = _read_template_svg(template)
    try:
        structure = parse_svg_structure(svg_content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    candidate_crops = render_candidate_crops(svg_content, structure, max_regions=payload.max_regions)
    return {
        "template_id": template.id,
        "structure": structure,
        "candidate_crops": candidate_crops,
    }


@router.post("/{template_id}/detect/finalize", response_model=TemplateWithZones)
def detect_template_finalize(
    template_id: int,
    payload: TemplateDetectionFinalizeRequest,
    db: Session = Depends(get_db),
):
    """Finalize detection using OCR rows and persist manifest v2."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    try:
        manifest = _build_detected_manifest(
            template,
            [row.model_dump() for row in payload.ocr_results],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    template.template_manifest = manifest
    _replace_template_zones_from_manifest(template, manifest, db)
    db.commit()
    db.refresh(template)
    return template


@router.put("/{template_id}/manifest", response_model=TemplateWithZones)
def update_template_manifest(
    template_id: int,
    payload: TemplateManifestUpdate,
    db: Session = Depends(get_db),
):
    """Atomically persist SVG + canonical detection manifest."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    svg_text = str(payload.svg_content or "").strip()
    if not svg_text:
        raise HTTPException(status_code=400, detail="svg_content is required")

    try:
        structure = parse_svg_structure(svg_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        base = migrate_manifest_to_v2(payload.template_manifest, structure)
        manifest = normalize_manifest_v2(base)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid template_manifest: {exc}") from exc

    _write_template_svg(template, svg_text)
    _write_overlay_svg(template, svg_text)

    canvas = manifest.get("canvas") if isinstance(manifest.get("canvas"), dict) else {}
    template.width = int(canvas.get("target_width") or canvas.get("source_width") or 750)
    template.height = int(canvas.get("target_height") or canvas.get("source_height") or 1575)
    template.template_manifest = manifest

    _replace_template_zones_from_manifest(template, manifest, db)
    db.commit()
    db.refresh(template)
    return template


@router.post("/{template_id}/zones", response_model=TemplateZoneResponse, status_code=status.HTTP_201_CREATED)
def add_zone(
    template_id: int,
    zone_type: str = Form(...),
    x: int = Form(...),
    y: int = Form(...),
    width: int = Form(...),
    height: int = Form(...),
    props: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Compatibility endpoint for manual zone insertion (legacy)."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if zone_type not in {"text", "image"}:
        raise HTTPException(status_code=400, detail="zone_type must be 'text' or 'image'")

    import json

    parsed_props = json.loads(props) if props else None
    zone = TemplateZone(
        template_id=template_id,
        zone_type=zone_type,
        x=x,
        y=y,
        width=max(1, width),
        height=max(1, height),
        props=parsed_props,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.patch("/{template_id}/zones/{zone_id}", response_model=TemplateZoneResponse)
def update_zone(
    template_id: int,
    zone_id: int,
    x: int | None = Form(None),
    y: int | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
    props: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Compatibility endpoint for manual zone edits (legacy)."""
    zone = db.query(TemplateZone).filter(
        TemplateZone.id == zone_id,
        TemplateZone.template_id == template_id,
    ).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    if x is not None:
        zone.x = x
    if y is not None:
        zone.y = y
    if width is not None:
        zone.width = max(1, width)
    if height is not None:
        zone.height = max(1, height)
    if props is not None:
        import json

        zone.props = json.loads(props) if props else None

    db.commit()
    db.refresh(zone)
    return zone


@router.delete("/{template_id}/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(template_id: int, zone_id: int, db: Session = Depends(get_db)):
    """Compatibility endpoint for removing a legacy zone."""
    zone = db.query(TemplateZone).filter(
        TemplateZone.id == zone_id,
        TemplateZone.template_id == template_id,
    ).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    db.delete(zone)
    db.commit()
    return None


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Delete template row and stored files."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template_path = STORAGE_DIR / template.filename
    if template_path.exists():
        template_path.unlink()

    if template.overlay_svg:
        overlay_path = OVERLAYS_DIR / template.overlay_svg
        if overlay_path.exists():
            overlay_path.unlink()

    db.delete(template)
    db.commit()
    return None


@router.get("/{template_id}/file")
async def get_template_file(template_id: int, db: Session = Depends(get_db)):
    """Return the raw SVG template file."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    file_path = STORAGE_DIR / template.filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="image/svg+xml",
        filename=f"{template.name}.svg",
    )


@router.get("/{template_id}/overlay")
async def get_template_overlay(template_id: int, db: Session = Depends(get_db)):
    """Return stripped overlay SVG used at render time."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    svg_text = _read_template_svg(template)
    parsed = parse_svg_template(svg_text)
    stripped = str(parsed.get("stripped_svg") or svg_text)

    if template.overlay_svg:
        (OVERLAYS_DIR / template.overlay_svg).write_text(stripped, encoding="utf-8")

    return Response(
        content=stripped,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'inline; filename="{template.name}_overlay.svg"'},
    )


@router.get("/fonts/list")
def list_fonts(db: Session = Depends(get_db)):
    """List uploaded custom fonts."""

    def _readable_family(record: CustomFont) -> str:
        family = (record.family or "").strip()
        if family and family.lower() != "custom font":
            return family

        original = (record.original_name or "").strip()
        if original:
            stem = Path(original).stem.strip()
            if stem and not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", stem.lower()):
                return stem.replace("-", " ").replace("_", " ")

        file_stem = Path(record.filename or "").stem.strip()
        if "__" in file_stem:
            maybe_slug = file_stem.split("__", 1)[1].strip()
            if maybe_slug:
                return maybe_slug.replace("-", " ").replace("_", " ")

        if file_stem and not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", file_stem.lower()):
            return file_stem.replace("-", " ").replace("_", " ")

        return "Custom Font"

    records = db.query(CustomFont).order_by(CustomFont.created_at.desc()).all()
    fonts = []
    for record in records:
        if not (FONT_DIR / record.filename).exists():
            continue
        fonts.append({"filename": record.filename, "family": _readable_family(record)})
    return {"fonts": fonts}


@router.post("/fonts/upload")
async def upload_font(
    file: UploadFile = File(...),
    family: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload custom font used by template text zones."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".ttf", ".otf", ".woff", ".woff2"}:
        raise HTTPException(status_code=400, detail="Supported formats: ttf, otf, woff, woff2")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty font file")

    original_stem = Path(file.filename).stem.strip()
    pretty_family = (family or "").strip() or original_stem.replace("-", " ").replace("_", " ") or "Custom Font"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", original_stem).strip("-").lower() or "custom-font"
    safe_name = f"{uuid.uuid4()}__{slug}{suffix}"
    dest = FONT_DIR / safe_name
    dest.write_bytes(content)

    db_font = CustomFont(
        filename=safe_name,
        original_name=file.filename,
        family=pretty_family,
    )
    db.add(db_font)
    db.commit()

    return {"filename": safe_name, "family": pretty_family}


@router.get("/fonts/{filename:path}")
def get_font_file(filename: str):
    """Serve an uploaded font file by filename."""
    candidate = Path(filename)
    if candidate.is_absolute():
        raise HTTPException(status_code=400, detail="Invalid font path")

    normalized = Path(str(candidate).replace("\\", "/"))
    font_path = (FONT_DIR / normalized).resolve()
    font_root = FONT_DIR.resolve()
    if font_root not in font_path.parents and font_path != font_root:
        raise HTTPException(status_code=400, detail="Invalid font path")
    if not font_path.exists() or not font_path.is_file():
        # Backward compatibility: allow requesting just filename for builtin fonts.
        fallback = (FONT_DIR / "builtin" / Path(normalized.name)).resolve()
        if font_root not in fallback.parents and fallback != font_root:
            raise HTTPException(status_code=400, detail="Invalid font path")
        if not fallback.exists() or not fallback.is_file():
            raise HTTPException(status_code=404, detail="Font not found")
        font_path = fallback

    if not font_path.exists():
        raise HTTPException(status_code=404, detail="Font not found")
    return FileResponse(font_path)
