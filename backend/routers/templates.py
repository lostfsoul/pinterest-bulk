"""
Template management router for SVG uploads.
"""
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Template, TemplateZone, CustomFont
from schemas import TemplateResponse, TemplateWithZones, TemplateZoneResponse
from services.template_parser import parse_svg_template

router = APIRouter()

# Storage directories
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage" / "templates"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path(__file__).parent.parent.parent / "storage" / "fonts"
FONT_DIR.mkdir(parents=True, exist_ok=True)

OVERLAYS_DIR = Path(__file__).parent.parent.parent / "storage" / "overlays"
OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)

TARGET_TEMPLATE_WIDTH = 750
TARGET_TEMPLATE_HEIGHT = 1575


def _scaled_template_zone_data(parsed: dict) -> tuple[float, float]:
    scale_x = TARGET_TEMPLATE_WIDTH / parsed["width"] if parsed["width"] else 1.0
    scale_y = TARGET_TEMPLATE_HEIGHT / parsed["height"] if parsed["height"] else 1.0
    return scale_x, scale_y


def _replace_template_zones(template: Template, parsed: dict, db: Session) -> None:
    scale_x, scale_y = _scaled_template_zone_data(parsed)
    text_zone = next((zone for zone in template.zones if zone.zone_type == "text"), None)
    text_props = dict(text_zone.props or {}) if text_zone else {}

    for zone in list(template.zones):
        db.delete(zone)
    db.flush()

    for index, zone in enumerate(parsed["zones"]):
        db.add(
            TemplateZone(
                template_id=template.id,
                zone_type="image",
                x=int(round(zone["x"] * scale_x)),
                y=int(round(zone["y"] * scale_y)),
                width=int(round(zone["width"] * scale_x)),
                height=int(round(zone["height"] * scale_y)),
                props={"zone_index": index},
            )
        )

    db.add(
        TemplateZone(
            template_id=template.id,
            zone_type="text",
            x=int(round(parsed["text_zone_x"] * scale_x)),
            y=int(round(parsed["text_zone_y"] * scale_y)),
            width=int(round(parsed["text_zone_width"] * scale_x)),
            height=int(round(parsed["text_zone_height"] * scale_y)),
            props={
                "border_color": parsed["text_zone_border_color"],
                "border_width": parsed["text_zone_border_width"],
                "text_color": text_props.get("text_color") or parsed["text_zone_text_color"],
                "text_align": text_props.get("text_align") or parsed.get("text_zone_align") or "left",
                "font_family": text_props.get("font_family") or '"Bebas Neue", Impact, sans-serif',
                "text_effect": text_props.get("text_effect") or "none",
                "text_effect_color": text_props.get("text_effect_color") or "#000000",
                "text_effect_offset_x": text_props.get("text_effect_offset_x", 2),
                "text_effect_offset_y": text_props.get("text_effect_offset_y", 2),
                "text_effect_blur": text_props.get("text_effect_blur", 0),
                "custom_font_file": text_props.get("custom_font_file"),
            },
        )
    )


def _refresh_template_zones_if_stale(template: Template, db: Session) -> bool:
    template_path = STORAGE_DIR / template.filename
    if not template_path.exists():
        return False

    parsed = parse_svg_template(template_path.read_text(encoding="utf-8"))
    stored_image_zones = [zone for zone in template.zones if zone.zone_type == "image"]
    if len(stored_image_zones) == len(parsed["zones"]):
        return False

    _replace_template_zones(template, parsed, db)
    db.commit()
    db.refresh(template)
    return True


@router.get("", response_model=List[TemplateWithZones])
def list_templates(db: Session = Depends(get_db)):
    """List all templates with zones."""
    templates = db.query(Template).order_by(Template.created_at.desc()).all()
    changed = False
    for template in templates:
        changed = _refresh_template_zones_if_stale(template, db) or changed
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
    """Upload an SVG template.

    The template parser will automatically detect:
    - Image zones from clipPath elements
    - Text zone position and dimensions
    - Canvas dimensions from viewBox
    - Static text elements (brand, footer)
    """
    import logging
    import json

    logging.info(f"Template upload request received")
    logging.info(f"Name: {name}")
    logging.info(f"File: {file.filename if file else None}")

    # Check name parameter
    if not name:
        logging.error("No name provided")
        raise HTTPException(status_code=422, detail="Template name is required")

    # Check file parameter
    if not file:
        logging.error("No file provided")
        raise HTTPException(status_code=422, detail="No file uploaded")

    # Check file extension
    filename = file.filename if file.filename else ''
    if not filename.lower().endswith('.svg'):
        raise HTTPException(status_code=400, detail="File must be an SVG")

    # Read SVG content
    try:
        content = await file.read()
    except Exception as e:
        logging.error(f"Failed to read file: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    logging.info(f"Read {len(content)} bytes from file")

    # Try to decode
    try:
        svg_text = content.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be valid UTF-8 text")

    # Parse SVG using new clipPath-based parser
    try:
        parsed = parse_svg_template(svg_text)
        logging.info(f"Parsed SVG: {parsed['width']}x{parsed['height']}, zones: {len(parsed['zones'])}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid SVG: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing SVG: {str(e)}")

    # Save original SVG file
    file_id = str(uuid.uuid4())
    filename = f"{file_id}.svg"
    file_path = STORAGE_DIR / filename

    with open(file_path, 'wb') as f:
        f.write(content)

    # Save stripped overlay SVG
    overlay_filename = f"{file_id}_overlay.svg"
    overlay_path = OVERLAYS_DIR / overlay_filename
    with open(overlay_path, 'w', encoding='utf-8') as f:
        f.write(parsed['stripped_svg'])

    # Create template record
    template = Template(
        name=name,
        filename=filename,
        overlay_svg=overlay_filename,
        width=TARGET_TEMPLATE_WIDTH,
        height=TARGET_TEMPLATE_HEIGHT,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    _replace_template_zones(template, parsed, db)

    db.commit()
    db.refresh(template)

    return template


@router.get("/{template_id}", response_model=TemplateWithZones)
def get_template(template_id: int, db: Session = Depends(get_db)):
    """Get template with zones."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    _refresh_template_zones_if_stale(template, db)
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
    """Add a zone to a template."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if zone_type not in ['text', 'image']:
        raise HTTPException(status_code=400, detail="zone_type must be 'text' or 'image'")

    # Parse props JSON if provided
    import json
    parsed_props = json.loads(props) if props else None

    zone = TemplateZone(
        template_id=template_id,
        zone_type=zone_type,
        x=x,
        y=y,
        width=width,
        height=height,
        props=parsed_props,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)

    return zone


@router.delete("/{template_id}/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(template_id: int, zone_id: int, db: Session = Depends(get_db)):
    """Delete a zone from a template."""
    zone = db.query(TemplateZone).filter(
        TemplateZone.id == zone_id,
        TemplateZone.template_id == template_id
    ).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    db.delete(zone)
    db.commit()
    return None


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
    """Update a zone position/size/props."""
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
        zone.width = width
    if height is not None:
        zone.height = height
    if props is not None:
        import json

        zone.props = json.loads(props) if props else None

    db.commit()
    db.refresh(zone)
    return zone


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Delete a template."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Delete file
    file_path = STORAGE_DIR / template.filename
    if file_path.exists():
        file_path.unlink()

    db.delete(template)
    db.commit()
    return None


@router.get("/{template_id}/file")
async def get_template_file(template_id: int, db: Session = Depends(get_db)):
    """Get the actual SVG file."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    file_path = STORAGE_DIR / template.filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="image/svg+xml",
        filename=f"{template.name}.svg"
    )


@router.get("/{template_id}/overlay")
async def get_template_overlay(template_id: int, db: Session = Depends(get_db)):
    """Get the overlay SVG for rendering (without placeholder images)."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template_path = STORAGE_DIR / template.filename
    if not template_path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")

    with open(template_path, 'r', encoding='utf-8') as source_file:
        svg_text = source_file.read()

    parsed = parse_svg_template(svg_text)

    if template.overlay_svg:
        overlay_path = OVERLAYS_DIR / template.overlay_svg
        with open(overlay_path, 'w', encoding='utf-8') as overlay_file:
            overlay_file.write(parsed["stripped_svg"])

    from fastapi.responses import Response
    return Response(
        content=parsed["stripped_svg"],
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
            original_stem = Path(original).stem.strip()
            # Ignore UUID-like placeholders.
            if original_stem and not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", original_stem.lower()):
                return original_stem.replace("-", " ").replace("_", " ")

        # Fallback for names like "<uuid>__font-name.otf".
        file_stem = Path(record.filename or "").stem.strip()
        if "__" in file_stem:
            maybe_slug = file_stem.split("__", 1)[1].strip()
            if maybe_slug:
                return maybe_slug.replace("-", " ").replace("_", " ")

        if file_stem and not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", file_stem.lower()):
            return file_stem.replace("-", " ").replace("_", " ")

        return "Custom Font"

    records = db.query(CustomFont).order_by(CustomFont.created_at.desc()).all()
    items = []
    for record in records:
        path = FONT_DIR / record.filename
        if not path.exists():
            continue
        family = _readable_family(record)
        items.append({"filename": record.filename, "family": family})
    return {"fonts": items}


@router.post("/fonts/upload")
async def upload_font(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a custom font file for template text rendering."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".ttf", ".otf", ".woff", ".woff2"}:
        raise HTTPException(status_code=400, detail="Supported formats: ttf, otf, woff, woff2")

    original_stem = Path(file.filename).stem.strip()
    pretty_family = original_stem.replace("-", " ").replace("_", " ") or "Custom Font"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", original_stem).strip("-").lower() or "custom-font"
    file_id = str(uuid.uuid4())
    safe_name = f"{file_id}__{slug}{suffix}"
    dest = FONT_DIR / safe_name
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty font file")

    with open(dest, "wb") as out:
        out.write(content)
    db_font = CustomFont(
        filename=safe_name,
        original_name=file.filename,
        family=pretty_family,
    )
    db.add(db_font)
    db.commit()

    return {
        "filename": safe_name,
        "family": pretty_family,
    }


@router.get("/fonts/{filename}")
def get_font_file(filename: str):
    """Serve an uploaded custom font file."""
    safe_name = Path(filename).name
    font_path = FONT_DIR / safe_name
    if not font_path.exists():
        raise HTTPException(status_code=404, detail="Font not found")
    return FileResponse(font_path)
