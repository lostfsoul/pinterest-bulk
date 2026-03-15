"""
Pin renderer service for Canvas-based pin generation.

Uses Node.js with canvas package for server-side rendering.
"""
import subprocess
import json
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List
import tempfile
import os
import shutil
from io import BytesIO
from sqlalchemy.orm import Session
import logging

from models import Page, PinDraft, Template
from services.template_parser import parse_svg_template

logger = logging.getLogger(__name__)


# Path to Node.js renderer script
RENDERER_DIR = Path(__file__).parent.parent.parent / "storage" / "generated_pins"
RENDERER_DIR.mkdir(parents=True, exist_ok=True)

NODE_RENDERER_PATH = Path(__file__).parent.parent / "node_renderer" / "render.js"


def normalize_image_bytes(image_bytes: bytes, source_url: str, content_type: str) -> tuple[bytes, str]:
    """Convert downloaded images to PNG when the renderer can't reliably decode them."""
    try:
        from PIL import Image

        with Image.open(BytesIO(image_bytes)) as pil_image:
            normalized = BytesIO()
            if pil_image.mode not in ("RGB", "RGBA"):
                pil_image = pil_image.convert("RGBA")
            pil_image.save(normalized, format="PNG")
            return normalized.getvalue(), "image/png"
    except Exception as pillow_error:
        logger.warning("Pillow normalization skipped for %s: %s", source_url, pillow_error)

    for binary in ("magick", "convert"):
        binary_path = shutil.which(binary)
        if not binary_path:
            continue
        try:
            result = subprocess.run(
                [binary_path, "webp:-", "png:-"],
                input=image_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
            if result.stdout:
                return result.stdout, "image/png"
        except Exception as convert_error:
            logger.warning(
                "ImageMagick normalization skipped for %s with %s: %s",
                source_url,
                binary,
                convert_error,
            )

    return image_bytes, content_type


async def render_pin_to_file(
    page: Page,
    template: Template,
    template_data: Dict[str, Any],
    output_path: Path,
    settings: Optional[Dict[str, Any]] = None,
    selected_image_url: Optional[str] = None,
) -> bool:
    """Render a single pin to a PNG file using Node.js canvas.

    Args:
        page: Page containing title and images
        template: Template to use
        template_data: Parsed template data
        output_path: Where to save the PNG file
        settings: Optional rendering settings (font, colors, etc.)
        selected_image_url: Optional specific image URL to use for this pin

    Returns:
        True if successful, False otherwise
    """
    # Import PageImage here to avoid circular imports
    from models import PageImage
    from database import SessionLocal
    import requests
    import base64
    from io import BytesIO

    # Get page images
    db = SessionLocal()
    try:
        if selected_image_url:
            # Use the selected image as the primary image
            image_urls = [selected_image_url]
            # Try to get a second image for variety (different from selected)
            additional_images = (
                db.query(PageImage)
                .filter(PageImage.page_id == page.id, PageImage.is_excluded == False, PageImage.url != selected_image_url)
                .limit(1)
                .all()
            )
            image_urls.extend([img.url for img in additional_images])
        else:
            # No specific image selected, use first 2 images from page
            images = (
                db.query(PageImage)
                .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
                .limit(2)
                .all()
            )
            image_urls = [img.url for img in images]
    finally:
        db.close()

    # Download images and convert to base64 (for canvas rendering).
    # Normalize to PNG first because node-canvas is less reliable with formats
    # like WebP/AVIF that browsers preview correctly.
    image_data_urls = []
    for url in image_urls[:2]:  # Max 2 images
        if not url:
            continue
        try:
            logger.info(f"Downloading image: {url}")
            response = requests.get(
                url,
                timeout=15,
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; PinterestCSVTool/1.0)',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    'Referer': page.url or '',
                },
            )
            if response.status_code == 200:
                content_type = response.headers.get('content-type', 'image/jpeg')
                encoded_bytes = response.content
                encoded_type = content_type

                if (
                    "webp" in content_type.lower()
                    or url.lower().endswith(".webp")
                    or "avif" in content_type.lower()
                    or url.lower().endswith(".avif")
                ):
                    encoded_bytes, encoded_type = normalize_image_bytes(
                        response.content,
                        url,
                        content_type,
                    )

                img_base64 = base64.b64encode(encoded_bytes).decode('utf-8')
                data_url = f'data:{encoded_type};base64,{img_base64}'
                image_data_urls.append(data_url)
                logger.info(
                    "Successfully downloaded and encoded image (%s bytes, %s -> %s)",
                    len(response.content),
                    content_type,
                    encoded_type,
                )
            else:
                logger.warning(f"Failed to download image: {url} (status {response.status_code})")
        except Exception as e:
            logger.error(f"Error downloading image {url}: {e}")

    # Fill in missing images with empty strings
    while len(image_data_urls) < 2:
        image_data_urls.append('')

    # Default settings
    if settings is None:
        settings = {
            'fontFamily': '"Bebas Neue", Impact, sans-serif',
            'textColor': '#000000',
            'textZonePadLeft': 0,
            'textZonePadRight': 0,
            'text_zone_y': template_data.get('text_zone_y', 0),
            'text_zone_height': template_data.get('text_zone_height', 100),
        }
    else:
        settings = {
            'fontFamily': settings.get('font_family', settings.get('fontFamily', '"Bebas Neue", Impact, sans-serif')),
            'textColor': settings.get('text_color', settings.get('textColor', '#000000')),
            'textZonePadLeft': settings.get('text_zone_pad_left', settings.get('textZonePadLeft', 0)),
            'textZonePadRight': settings.get('text_zone_pad_right', settings.get('textZonePadRight', 0)),
            'text_zone_y': settings.get('text_zone_y', template_data.get('text_zone_y', 0)),
            'text_zone_height': settings.get('text_zone_height', template_data.get('text_zone_height', 100)),
        }

    # Prepare render data
    zones = template_data.get('zones', [])
    if not zones:
        text_zone_y = settings.get('text_zone_y', template_data.get('text_zone_y', 0))
        text_zone_height = settings.get('text_zone_height', template_data.get('text_zone_height', 0))
        top_height = max(0, int(text_zone_y))
        bottom_start = int(text_zone_y + text_zone_height)
        bottom_height = max(0, int(template.height - bottom_start))
        if top_height == 0 or bottom_height == 0:
            half_height = int(template.height * 0.44)
            gap_height = int(template.height * 0.12)
            zones = [
                {'x': 0, 'y': 0, 'width': template.width, 'height': half_height},
                {'x': 0, 'y': half_height + gap_height, 'width': template.width, 'height': half_height},
            ]
        else:
            zones = [
                {'x': 0, 'y': 0, 'width': template.width, 'height': top_height},
                {'x': 0, 'y': bottom_start, 'width': template.width, 'height': bottom_height},
            ]
    logger.info(f"Rendering pin with {len(zones)} zones")
    logger.info(f"Image 1: {'Downloaded' if image_data_urls[0] else 'None'}")
    logger.info(f"Image 2: {'Downloaded' if image_data_urls[1] else 'None'}")
    logger.debug(f"Zones data: {zones}")

    render_data = {
        'template': {
            'width': template.width,
            'height': template.height,
            'overlaySvg': template_data.get('stripped_svg', ''),
            'zones': zones,
            'textZoneY': settings.get('text_zone_y', template_data.get('text_zone_y', 0)),
            'textZoneHeight': settings.get('text_zone_height', template_data.get('text_zone_height', 100)),
            'textZoneBorderColor': template_data.get('text_zone_border_color'),
            'textZoneBorderWidth': template_data.get('text_zone_border_width') or 4,
            'textElements': template_data.get('text_elements', []),
        },
        'content': {
            'title': page.title or '',
            'image1Url': image_data_urls[0] if len(image_data_urls) > 0 else None,
            'image2Url': image_data_urls[1] if len(image_data_urls) > 1 else None,
            'link': page.url or '',
        },
        'settings': settings,
        'outputPath': str(output_path),
    }

    # Try Node.js renderer first
    if NODE_RENDERER_PATH.exists():
        try:
            result = await _render_with_nodejs(render_data)
            return result
        except Exception as e:
            print(f"Node.js rendering failed: {e}")

    # Fall back to Python rendering (cairosvg + PIL)
    return await _render_with_python(render_data)


async def _render_with_nodejs(render_data: Dict[str, Any]) -> bool:
    """Render pin using Node.js canvas package."""
    # Create a temp file with the render data
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(render_data, f)
        data_file = f.name

    try:
        # Run Node.js renderer
        process = await asyncio.create_subprocess_exec(
            'node',
            str(NODE_RENDERER_PATH),
            data_file,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode('utf-8') if stderr else 'Unknown error'
            raise Exception(f"Node.js renderer failed: {error_msg}")

        result = json.loads(stdout.decode('utf-8'))
        return result.get('success', False)

    finally:
        # Clean up temp file
        try:
            os.unlink(data_file)
        except:
            pass


async def _render_with_python(render_data: Dict[str, Any]) -> bool:
    """Render pin using Python libraries (cairosvg + PIL).

    This is a simplified fallback that creates a basic pin image.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
        import requests
        import base64
        from io import BytesIO

        template = render_data['template']
        content = render_data['content']
        settings = render_data['settings']

        # Create canvas
        width = template['width']
        height = template['height']
        img = Image.new('RGB', (width, height), 'white')
        draw = ImageDraw.Draw(img)

        # Draw image zones
        for i, zone in enumerate(template.get('zones', [])):
            image_url = content.get(f'image{i+1}Url')
            if image_url:
                try:
                    if image_url.startswith('data:'):
                        header, encoded = image_url.split(',', 1)
                        img_bytes = base64.b64decode(encoded)
                        zone_img = Image.open(BytesIO(img_bytes))
                    else:
                        response = requests.get(
                            image_url,
                            timeout=15,
                            headers={
                                'User-Agent': 'Mozilla/5.0 (compatible; PinterestCSVTool/1.0)',
                                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                                'Referer': content.get('link', ''),
                            },
                        )
                        zone_img = Image.open(BytesIO(response.content))

                    # Scale and crop to fit zone
                    zone_x = int(zone['x'])
                    zone_y = int(zone['y'])
                    zone_w = int(zone['width'])
                    zone_h = int(zone['height'])

                    # Simple cover fit
                    img_ratio = zone_w / zone_h
                    src_ratio = zone_img.width / zone_img.height

                    if src_ratio > img_ratio:
                        # Source is wider - crop height
                        new_h = int(zone_img.width / img_ratio)
                        y_offset = (zone_img.height - new_h) // 2
                        zone_img = zone_img.crop((0, y_offset, zone_img.width, y_offset + new_h))
                    else:
                        # Source is taller - crop width
                        new_w = int(zone_img.height * img_ratio)
                        x_offset = (zone_img.width - new_w) // 2
                        zone_img = zone_img.crop((x_offset, 0, x_offset + new_w, zone_img.height))

                    # Resize to zone
                    zone_img = zone_img.resize((zone_w, zone_h), Image.LANCZOS)
                    img.paste(zone_img, (zone_x, zone_y))

                except Exception as e:
                    print(f"Failed to load image {image_url}: {e}")

        # Draw text zone
        text_zone_y = template.get('textZoneY', 0)
        text_zone_h = template.get('textZoneHeight', 100)
        pad_left = settings.get('textZonePadLeft', 0)
        pad_right = settings.get('textZonePadRight', 0)

        # White background for text zone
        draw.rectangle(
            [pad_left, text_zone_y, width - pad_right, text_zone_y + text_zone_h],
            fill='white'
        )

        # Draw title
        title = content.get('title', '')
        if title:
            try:
                # Try to use a bold font
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
            except:
                font = ImageFont.load_default()

            text_color = settings.get('textColor', '#000000')
            text_upper = title.upper()

            # Simple centering
            bbox = draw.textbbox((0, 0), text_upper, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            x = (width - text_w) // 2
            y = text_zone_y + (text_zone_h - text_h) // 2

            draw.text((x, y), text_upper, fill=text_color, font=font)

        # Save
        output_path = Path(render_data['outputPath'])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, 'PNG')

        return True

    except ImportError:
        # PIL not available - create a simple placeholder
        print("PIL not available, creating placeholder image")
        return await _create_placeholder(render_data)
    except Exception as e:
        print(f"Python rendering failed: {e}")
        return False


async def _create_placeholder(render_data: Dict[str, Any]) -> bool:
    """Create a simple placeholder image when rendering libraries are not available."""
    output_path = Path(render_data['outputPath'])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Create a simple SVG as placeholder
    width = render_data['template']['width']
    height = render_data['template']['height']
    title = render_data['content'].get('title', 'Untitled')

    svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#ffffff"/>
  <text x="{width//2}" y="{height//2}" text-anchor="middle" font-family="Arial" font-size="48" fill="#000000">
    {title[:50]}
  </text>
</svg>'''

    # Save as SVG (convert to PNG would require cairosvg)
    svg_path = output_path.with_suffix('.svg')
    with open(svg_path, 'w') as f:
        f.write(svg_content)

    # Return True but note it's an SVG, not PNG
    return True


async def generate_pin_media_url(
    pin: PinDraft,
    db: Session,
    settings: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Generate the actual pin image and update media_url.

    Args:
        pin: PinDraft to generate
        db: Database session
        settings: Optional rendering settings

    Returns:
        The generated media URL or None if failed
    """
    # Get template
    template = db.query(Template).filter(Template.id == pin.template_id).first()
    if not template:
        return None

    # Get page
    from models import Page
    page = db.query(Page).filter(Page.id == pin.page_id).first()
    if not page:
        return None

    # Parse template
    from services.template_parser import parse_svg_template
    template_path = Path(__file__).parent.parent.parent / "storage" / "templates" / template.filename
    with open(template_path, 'r') as f:
        svg_content = f.read()

    template_data = parse_svg_template(svg_content)

    # Generate output filename
    output_filename = f"pin_{pin.id}.png"
    output_path = RENDERER_DIR / output_filename

    # Render pin with the selected image
    success = await render_pin_to_file(page, template, template_data, output_path, settings, pin.selected_image_url)

    if success and output_path.exists():
        # Update pin with hosted URL
        # This will be served at /static/pins/{filename}
        pin.media_url = f"/static/pins/{output_filename}"
        db.commit()
        return pin.media_url

    return None


async def regenerate_all_pins(
    template_id: int,
    db: Session,
    settings: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Regenerate all pins for a template.

    Args:
        template_id: Template to use
        db: Database session
        settings: Optional rendering settings

    Returns:
        Dict with success count and errors
    """
    pins = (
        db.query(PinDraft)
        .filter(PinDraft.template_id == template_id)
        .all()
    )

    success_count = 0
    errors = []

    for pin in pins:
        try:
            url = await generate_pin_media_url(pin, db, settings)
            if url:
                success_count += 1
            else:
                errors.append(f"Pin {pin.id}: Failed to generate")
        except Exception as e:
            errors.append(f"Pin {pin.id}: {str(e)}")

    return {
        'total': len(pins),
        'success': success_count,
        'errors': errors,
    }
