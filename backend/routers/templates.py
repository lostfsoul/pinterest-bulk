"""
Template management router for SVG uploads.
"""
import os
import shutil
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Template, TemplateZone
from schemas import TemplateResponse, TemplateWithZones, TemplateZoneResponse
from services.template_parser import parse_svg_template

router = APIRouter()

# Storage directories
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage" / "templates"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

OVERLAYS_DIR = Path(__file__).parent.parent.parent / "storage" / "overlays"
OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("", response_model=List[TemplateWithZones])
def list_templates(db: Session = Depends(get_db)):
    """List all templates with zones."""
    return db.query(Template).order_by(Template.created_at.desc()).all()


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
        width=parsed["width"],
        height=parsed["height"],
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    # Create image zones (detected from clipPath)
    for i, zone in enumerate(parsed["zones"]):
        zone_obj = TemplateZone(
            template_id=template.id,
            zone_type="image",
            x=int(round(zone["x"])),
            y=int(round(zone["y"])),
            width=int(round(zone["width"])),
            height=int(round(zone["height"])),
            props={"zone_index": i},
        )
        db.add(zone_obj)

    # Create text zone
    text_zone = TemplateZone(
        template_id=template.id,
        zone_type="text",
        x=0,
        y=parsed["text_zone_y"],
        width=parsed["width"],
        height=parsed["text_zone_height"],
        props={
            "border_color": parsed["text_zone_border_color"],
            "border_width": parsed["text_zone_border_width"],
            "text_color": parsed["text_zone_text_color"],
        },
    )
    db.add(text_zone)

    db.commit()
    db.refresh(template)

    return template


@router.get("/{template_id}", response_model=TemplateWithZones)
def get_template(template_id: int, db: Session = Depends(get_db)):
    """Get template with zones."""
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
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
