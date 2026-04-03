"""
Pin renderer service for Canvas-based pin generation.

Uses Node.js with canvas package for server-side rendering.
"""
import subprocess
import json
import asyncio
import time
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


def sort_page_images(images: list["PageImage"]) -> list["PageImage"]:
    """Match renderer image ordering with preview/generation ranking."""
    return sorted(
        images,
        key=lambda img: (
            0 if img.category == "featured" else 1 if img.category == "article" else 2,
            -((img.width or 0) * (img.height or 0)),
            img.id or 0,
        ),
    )


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

    # Prefer persisted template zones from DB (same source used by preview UI),
    # then fall back to parser zones.
    db_image_zones = [
        {
            "x": int(zone.x),
            "y": int(zone.y),
            "width": int(zone.width),
            "height": int(zone.height),
        }
        for zone in sorted(
            [z for z in (template.zones or []) if z.zone_type == "image"],
            key=lambda z: (int((z.props or {}).get("zone_index", 9999)), z.id or 0),
        )
    ]
    zones = db_image_zones if db_image_zones else list(template_data.get("zones") or [])
    image_slot_count = max(1, len(zones))

    # Get page images
    db = SessionLocal()
    try:
        if selected_image_url:
            # Use the selected image as the primary image
            image_urls = [selected_image_url]
            additional_images = (
                db.query(PageImage)
                .filter(PageImage.page_id == page.id, PageImage.is_excluded == False, PageImage.url != selected_image_url)
                .all()
            )
            additional_images = sort_page_images(additional_images)[: max(0, image_slot_count - 1)]
            image_urls.extend([img.url for img in additional_images])
        else:
            # No specific image selected, use as many images as template slots
            images = (
                db.query(PageImage)
                .filter(PageImage.page_id == page.id, PageImage.is_excluded == False)
                .all()
            )
            image_urls = [img.url for img in sort_page_images(images)[:image_slot_count]]
    finally:
        db.close()

    # Download images and convert to base64 (for canvas rendering).
    # Normalize to PNG first because node-canvas is less reliable with formats
    # like WebP/AVIF that browsers preview correctly.
    image_data_urls = []
    for url in image_urls[:image_slot_count]:
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

    # Fill missing slots by duplicating available images (round-robin).
    if image_data_urls:
        idx = 0
        while len(image_data_urls) < image_slot_count:
            image_data_urls.append(image_data_urls[idx % len(image_data_urls)])
            idx += 1
    else:
        while len(image_data_urls) < image_slot_count:
            image_data_urls.append('')

    # Default settings
    if settings is None:
        settings = {
            'fontFamily': '"Bebas Neue", Impact, sans-serif',
            'textColor': '#000000',
            'textZonePadLeft': 0,
            'textZonePadRight': 0,
            'textAlign': 'left',
            'textZoneBgColor': '#ffffff',
            'text_zone_y': template_data.get('text_zone_y', 0),
            'text_zone_height': template_data.get('text_zone_height', 100),
            'textEffect': 'none',
            'textEffectColor': '#000000',
            'textEffectOffsetX': 2,
            'textEffectOffsetY': 2,
            'textEffectBlur': 0,
            'customFontFile': None,
        }
    else:
        settings = {
            'fontFamily': settings.get('font_family', settings.get('fontFamily', '"Bebas Neue", Impact, sans-serif')),
            'textColor': settings.get('text_color', settings.get('textColor', '#000000')),
            'textZonePadLeft': settings.get('text_zone_pad_left', settings.get('textZonePadLeft', 0)),
            'textZonePadRight': settings.get('text_zone_pad_right', settings.get('textZonePadRight', 0)),
            'textAlign': settings.get('text_align', settings.get('textAlign', 'left')),
            'textZoneBgColor': settings.get('text_zone_bg_color', settings.get('textZoneBgColor', '#ffffff')),
            'text_zone_y': settings.get('text_zone_y', template_data.get('text_zone_y', 0)),
            'text_zone_height': settings.get('text_zone_height', template_data.get('text_zone_height', 100)),
            'textEffect': settings.get('text_effect', settings.get('textEffect', 'none')),
            'textEffectColor': settings.get('text_effect_color', settings.get('textEffectColor', '#000000')),
            'textEffectOffsetX': settings.get('text_effect_offset_x', settings.get('textEffectOffsetX', 2)),
            'textEffectOffsetY': settings.get('text_effect_offset_y', settings.get('textEffectOffsetY', 2)),
            'textEffectBlur': settings.get('text_effect_blur', settings.get('textEffectBlur', 0)),
            'customFontFile': settings.get('custom_font_file', settings.get('customFontFile')),
        }

    # Prepare render data
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
            # Avoid double-rendered copy; title text is rendered explicitly.
            'textElements': [],
        },
        'content': {
            'title': page.title or '',
            'imageUrls': image_data_urls,
            'image1Url': image_data_urls[0] if len(image_data_urls) > 0 else None,
            'image2Url': image_data_urls[1] if len(image_data_urls) > 1 else None,
            'link': page.url or '',
        },
        'settings': settings,
        'outputPath': str(output_path),
    }

    # Try Node.js renderer first; it matches preview behavior more closely.
    if NODE_RENDERER_PATH.exists():
        try:
            result = await _render_with_nodejs(render_data)
            if result and output_path.exists():
                _apply_custom_font_overlay(output_path, render_data)
            return result
        except Exception as e:
            print(f"Node.js rendering failed: {e}")

    # Fall back to Python rendering (cairosvg + PIL)
    result = await _render_with_python(render_data)
    if result and output_path.exists():
        _apply_custom_font_overlay(output_path, render_data)
    return result


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

        image_url_list = content.get('imageUrls') or []

        # Draw image zones
        for i, zone in enumerate(template.get('zones', [])):
            image_url = image_url_list[i] if i < len(image_url_list) else content.get(f'image{i+1}Url')
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
            fill=settings.get('textZoneBgColor', '#ffffff'),
        )

        # Draw title
        title = content.get('title', '')
        if title:
            custom_font_file = settings.get('customFontFile') or settings.get('custom_font_file')
            custom_font_path = None
            if custom_font_file:
                candidate = Path(__file__).parent.parent.parent / "storage" / "fonts" / str(custom_font_file)
                if candidate.exists():
                    custom_font_path = candidate
            try:
                if custom_font_path:
                    font = ImageFont.truetype(str(custom_font_path), 48)
                else:
                    # Fallback system font
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


def _fit_text_lines_with_pillow(
    draw,
    text: str,
    zone_width: int,
    zone_height: int,
    font_path: str | None,
    fallback_font_path: str | None,
) -> tuple[list[str], Any, int]:
    from PIL import ImageFont

    def load_font(size: int):
        candidates = [font_path, fallback_font_path]
        for candidate in candidates:
            if not candidate:
                continue
            try:
                return ImageFont.truetype(candidate, size)
            except Exception:
                continue
        return ImageFont.load_default()

    upper = (text or "").upper()
    words = [w for w in upper.split() if w]
    usable_width = max(20, zone_width - 30)
    usable_height = max(20, zone_height)
    best_lines = [upper] if upper else [""]
    best_font = load_font(12)
    best_size = 12

    def measure(lines: list[str], size: int):
        font = load_font(size)
        widths = []
        heights = []
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            widths.append(bbox[2] - bbox[0])
            heights.append(bbox[3] - bbox[1])
        line_height = max(heights or [size])
        return font, max(widths or [0]), line_height * len(lines)

    def try_lines(lines: list[str]):
        nonlocal best_lines, best_font, best_size
        low, high = 12, 200
        local_best = 12
        local_font = load_font(12)
        while low <= high:
            mid = (low + high) // 2
            font, max_width, total_height = measure(lines, mid)
            if max_width <= usable_width and total_height <= usable_height:
                local_best = mid
                local_font = font
                low = mid + 1
            else:
                high = mid - 1
        if local_best > best_size:
            best_lines = lines
            best_font = local_font
            best_size = local_best

    if upper:
        try_lines([upper])
        if len(words) >= 2:
            for idx in range(1, len(words)):
                try_lines([ " ".join(words[:idx]), " ".join(words[idx:]) ])
        if len(words) >= 4:
            for start in range(1, len(words) - 1):
                for end in range(start + 1, len(words)):
                    try_lines([
                        " ".join(words[:start]),
                        " ".join(words[start:end]),
                        " ".join(words[end:]),
                    ])

    return best_lines, best_font, best_size


def _draw_text_with_pillow_effect(
    img,
    lines: list[str],
    font,
    positions: list[tuple[float, float]],
    *,
    text_color: str,
    effect: str,
    effect_color: str,
    offset_x: int,
    offset_y: int,
    blur: int,
) -> None:
    from PIL import Image, ImageDraw, ImageFilter

    if effect and effect != "none":
        effect_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        effect_draw = ImageDraw.Draw(effect_layer)
        for (x, y), line in zip(positions, lines):
            if effect == "drop":
                effect_draw.text((x + offset_x, y + offset_y), line, fill=effect_color, font=font)
            elif effect == "echo":
                effect_draw.text((x + offset_x, y + offset_y), line, fill=effect_color, font=font)
                effect_draw.text((x - offset_x, y - offset_y), line, fill=effect_color, font=font)
            elif effect == "outline":
                effect_draw.text(
                    (x, y),
                    line,
                    fill=(0, 0, 0, 0),
                    font=font,
                    stroke_width=max(1, abs(offset_x) or abs(offset_y) or 1),
                    stroke_fill=effect_color,
                )
        if blur > 0 and effect in {"drop", "echo"}:
            effect_layer = effect_layer.filter(ImageFilter.GaussianBlur(radius=blur))
        composed = Image.alpha_composite(img.convert("RGBA"), effect_layer)
        img.paste(composed.convert("RGB"))

    text_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    for (x, y), line in zip(positions, lines):
        text_draw.text((x, y), line, fill=text_color, font=font)
    composed = Image.alpha_composite(img.convert("RGBA"), text_layer)
    img.paste(composed.convert("RGB"))


def _apply_custom_font_overlay(
    output_path: Path,
    render_data: Dict[str, Any],
) -> None:
    from PIL import Image, ImageDraw

    settings = render_data.get("settings", {})
    custom_font_file = settings.get("customFontFile") or settings.get("custom_font_file")
    if not custom_font_file:
        return

    custom_font_path = Path(__file__).parent.parent.parent / "storage" / "fonts" / str(custom_font_file)
    if not custom_font_path.exists():
        return

    img = Image.open(output_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    template = render_data["template"]
    content = render_data["content"]
    width = int(template["width"])
    text_zone_y = int(template.get("textZoneY", 0))
    text_zone_h = int(template.get("textZoneHeight", 100))
    pad_left = int(settings.get("textZonePadLeft", 0) or 0)
    pad_right = int(settings.get("textZonePadRight", 0) or 0)
    text_area_w = max(20, width - pad_left - pad_right)
    text_align = settings.get("textAlign", "left")
    text_color = settings.get("textColor", "#000000")
    text_effect = settings.get("textEffect", "none")
    text_effect_color = settings.get("textEffectColor", "#000000")
    text_effect_offset_x = int(settings.get("textEffectOffsetX", 2) or 2)
    text_effect_offset_y = int(settings.get("textEffectOffsetY", 2) or 2)
    text_effect_blur = int(settings.get("textEffectBlur", 0) or 0)
    title = content.get("title", "")
    if not title:
        return

    # Replace the title area after the main render so uploaded fonts are deterministic.
    draw.rectangle(
        [pad_left, text_zone_y, width - pad_right, text_zone_y + text_zone_h],
        fill="white",
    )
    border_color = template.get("textZoneBorderColor")
    if border_color:
        border_width = int(template.get("textZoneBorderWidth") or 4)
        half = border_width / 2
        draw.rectangle(
            [pad_left + half, text_zone_y + half, width - pad_right - half, text_zone_y + text_zone_h - half],
            outline=border_color,
            width=border_width,
        )

    fallback_font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    lines, font, font_size = _fit_text_lines_with_pillow(
        draw,
        title,
        text_area_w,
        text_zone_h,
        str(custom_font_path),
        fallback_font,
    )

    metrics = draw.textbbox((0, 0), "A", font=font)
    cap_height = (metrics[3] - metrics[1]) or font_size
    line_height = font_size
    visual_height = cap_height + (len(lines) - 1) * line_height
    first_y = text_zone_y + (text_zone_h - visual_height) / 2
    center_x = pad_left + text_area_w / 2
    left_x = pad_left + 15
    positions: list[tuple[float, float]] = []

    for idx, line in enumerate(lines):
        y = first_y + idx * line_height
        if text_align == "left":
            positions.append((left_x, y))
        else:
            bbox = draw.textbbox((0, 0), line, font=font)
            line_w = bbox[2] - bbox[0]
            positions.append((center_x - line_w / 2, y))

    _draw_text_with_pillow_effect(
        img,
        lines,
        font,
        positions,
        text_color=text_color,
        effect=text_effect,
        effect_color=text_effect_color,
        offset_x=text_effect_offset_x,
        offset_y=text_effect_offset_y,
        blur=text_effect_blur,
    )

    img.save(output_path, "PNG")


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
        # Add a cache-busting version because pin IDs are reused and browsers
        # otherwise keep serving stale PNGs after re-rendering.
        pin.media_url = f"/static/pins/{output_filename}?v={int(time.time())}"
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
