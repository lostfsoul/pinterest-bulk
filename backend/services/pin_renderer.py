"""
Pin renderer service for Canvas-based pin generation.

Uses Node.js with canvas package for server-side rendering.
"""
import subprocess
import json
import asyncio
import time
import re
from pathlib import Path
from typing import Dict, Any, Optional, List
import tempfile
import os
import shutil
import uuid
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
RENDER_LAYOUT_VERSION = 5
DEFAULT_RENDER_ENGINE = "resvg"


def resolve_render_engine() -> str:
    raw = str(os.getenv("PIN_RENDER_ENGINE") or DEFAULT_RENDER_ENGINE).strip().lower()
    return raw if raw in {"resvg", "canvas"} else DEFAULT_RENDER_ENGINE


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
    pin_title: Optional[str] = None,
) -> tuple[bool, str]:
    """Render a single pin to a PNG file using Node.js canvas.

    Args:
        page: Page containing title and images
        template: Template to use
        template_data: Parsed template data
        output_path: Where to save the PNG file
        settings: Optional rendering settings (font, colors, etc.)
        selected_image_url: Optional specific image URL to use for this pin
        pin_title: Optional pin draft title to render (falls back to page title)

    Returns:
        Tuple of (success, renderer_engine_used)
    """
    # Import PageImage here to avoid circular imports
    from models import PageImage
    from database import SessionLocal
    import requests
    import base64
    from io import BytesIO

    # Always trust fresh parser-detected zones from SVG for rendering.
    # This keeps server generation aligned with live preview behavior.
    zones = list(template_data.get("zones") or [])
    image_slot_count = max(1, len(zones))
    text_zone = next((z for z in (template.zones or []) if z.zone_type == "text"), None)
    text_zone_props = dict(text_zone.props or {}) if text_zone and isinstance(text_zone.props, dict) else {}
    secondary_text_slots = text_zone_props.get("secondary_text_slots")
    if not isinstance(secondary_text_slots, list):
        secondary_text_slots = template_data.get("secondary_text_slots") or []
    secondary_text_defaults = text_zone_props.get("secondary_text_defaults")
    if not isinstance(secondary_text_defaults, dict):
        secondary_text_defaults = {}

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
            'fontFamily': '"Poppins", "Segoe UI", Arial, sans-serif',
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
            'titlePaddingX': 15,
            'lineHeightMultiplier': 1.0,
            'customFontFile': None,
            'secondaryTextValues': dict(secondary_text_defaults),
        }
    else:
        settings = {
            'fontFamily': settings.get('font_family', settings.get('fontFamily', '"Poppins", "Segoe UI", Arial, sans-serif')),
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
            'titleScale': settings.get('title_scale', settings.get('titleScale', 1)),
            'titlePaddingX': settings.get('title_padding_x', settings.get('titlePaddingX', 15)),
            'lineHeightMultiplier': settings.get('line_height_multiplier', settings.get('lineHeightMultiplier', 1)),
            'deferCustomTitleToPillow': bool(settings.get('custom_font_file', settings.get('customFontFile'))),
            'customFontFile': settings.get('custom_font_file', settings.get('customFontFile')),
            'secondaryTextValues': settings.get('secondary_text_values', settings.get('secondaryTextValues', dict(secondary_text_defaults))),
        }

    # Force text zone geometry to parser-detected SVG values so stale DB zone
    # metadata cannot place title in the wrong band.
    parsed_text_zone_y = template_data.get('text_zone_y')
    parsed_text_zone_h = template_data.get('text_zone_height')
    parsed_text_zone_x = template_data.get('text_zone_x')
    parsed_text_zone_w = template_data.get('text_zone_width')
    try:
        if parsed_text_zone_y is not None:
            settings['text_zone_y'] = int(parsed_text_zone_y)
    except (TypeError, ValueError):
        pass
    try:
        if parsed_text_zone_h is not None:
            settings['text_zone_height'] = int(parsed_text_zone_h)
    except (TypeError, ValueError):
        pass
    try:
        if parsed_text_zone_x is not None:
            settings['textZonePadLeft'] = max(0, int(parsed_text_zone_x))
    except (TypeError, ValueError):
        pass
    try:
        if parsed_text_zone_x is not None and parsed_text_zone_w is not None:
            right = int(template.width) - (int(parsed_text_zone_x) + int(parsed_text_zone_w))
            settings['textZonePadRight'] = max(0, right)
    except (TypeError, ValueError):
        pass

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
            'secondaryTextSlots': secondary_text_slots,
            'secondaryTextDefaults': secondary_text_defaults,
        },
        'content': {
            'title': (pin_title or '').strip() or (page.title or ''),
            'imageUrls': image_data_urls,
            'image1Url': image_data_urls[0] if len(image_data_urls) > 0 else None,
            'image2Url': image_data_urls[1] if len(image_data_urls) > 1 else None,
            'link': page.url or '',
        },
        'settings': settings,
        'renderEngine': resolve_render_engine(),
        'outputPath': str(output_path),
    }

    # Use Node renderer as the single rendering path for production output.
    if NODE_RENDERER_PATH.exists():
        try:
            node_result = await _render_with_nodejs(render_data)
            result = bool(node_result.get("success"))
            engine_used = str(node_result.get("engine") or "canvas").strip().lower() or "canvas"
            if result and output_path.exists():
                _apply_custom_font_overlay(output_path, render_data)
            if result:
                return True, engine_used
            logger.error("Node renderer failed for pin %s (engine=%s): %s", page.id, engine_used, node_result)
            return False, engine_used
        except Exception as e:
            logger.exception("Node.js rendering failed: %s", e)
            return False, resolve_render_engine()

    logger.error("Node renderer script not found at %s", NODE_RENDERER_PATH)
    return False, resolve_render_engine()


async def _render_with_nodejs(render_data: Dict[str, Any]) -> Dict[str, Any]:
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

        try:
            result = json.loads(stdout.decode('utf-8'))
        except json.JSONDecodeError:
            result = {"success": False, "engine": "unknown"}
        if "engine" not in result:
            result["engine"] = "canvas"
        return result

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

        # Keep template background as uploaded; only render title text.

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
    *,
    max_lines: int = 3,
    uppercase: bool = False,
    pad_x: int = 15,
    pad_y: int = 0,
    effect_margin_x: int = 0,
    effect_margin_y: int = 0,
    preferred_font_size: int | None = None,
    split_layout: bool = False,
    line_height_multiplier: float = 1.0,
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

    normalized = re.sub(r"\s+", " ", (text or "")).strip()
    if uppercase:
        normalized = normalized.upper()

    usable_width = max(20, zone_width - (2 * pad_x) - (2 * abs(effect_margin_x)))
    usable_height = max(20, zone_height - (2 * pad_y) - (2 * abs(effect_margin_y)))
    max_lines = max(1, int(max_lines or 1))

    def line_width(value: str, font) -> int:
        bbox = draw.textbbox((0, 0), value, font=font)
        return int(bbox[2] - bbox[0])

    def fit_line_with_ellipsis(value: str, font) -> str:
        raw = value.strip()
        if not raw:
            return raw
        ellipsis = "..."
        if line_width(raw, font) <= usable_width:
            return raw
        while raw:
            candidate = (raw.rstrip() + ellipsis).strip()
            if line_width(candidate, font) <= usable_width:
                return candidate
            raw = raw[:-1]
        return ellipsis

    def wrap_words(value: str, font) -> list[str]:
        if not value:
            return [""]
        words = [part for part in value.split(" ") if part]
        if not words:
            return [""]

        lines: list[str] = []
        current = ""
        for word in words:
            probe = f"{current} {word}".strip() if current else word
            if line_width(probe, font) <= usable_width or not current:
                current = probe
                continue
            lines.append(current)
            current = word
        if current:
            lines.append(current)

        adjusted: list[str] = []
        for line in lines:
            if line_width(line, font) <= usable_width:
                adjusted.append(line)
                continue
            chunk = ""
            for char in line:
                probe = f"{chunk}{char}"
                if chunk and line_width(probe, font) > usable_width:
                    adjusted.append(chunk)
                    chunk = char
                else:
                    chunk = probe
            if chunk:
                adjusted.append(chunk)

        if len(adjusted) > max_lines:
            adjusted = adjusted[:max_lines]
            adjusted[-1] = fit_line_with_ellipsis(adjusted[-1], font)

        return adjusted or [""]

    def max_width(lines: list[str], font) -> int:
        return max((line_width(line, font) for line in lines), default=0)

    def find_max_font_for_lines(lines: list[str]) -> tuple[int, Any]:
        low = 6
        if preferred_font_size is not None and int(preferred_font_size) > 0:
            high = max(8, min(220, int(preferred_font_size)))
        else:
            high = 220
        best_size_local = 6
        best_font_local = load_font(6)
        while low <= high:
            size = (low + high) // 2
            font = load_font(size)
            line_height = max(1, int(round(size * line_height_multiplier)))
            total_height = line_height * len(lines)
            max_line_w = max_width(lines, font)
            fits = len(lines) <= max_lines and max_line_w <= usable_width and total_height <= usable_height
            if fits:
                best_size_local = size
                best_font_local = font
                low = size + 1
            else:
                high = size - 1
        return best_size_local, best_font_local

    if split_layout and normalized:
        low = 8
        if preferred_font_size is not None and int(preferred_font_size) > 0:
            high = max(8, min(220, int(preferred_font_size)))
        else:
            high = 220
        best_lines = [normalized]
        best_font = load_font(12)
        best_size = 12
        while low <= high:
            size = (low + high) // 2
            font = load_font(size)
            lines = wrap_words(normalized, font)
            lines = lines[:max_lines]
            if len(lines) > max_lines:
                lines = lines[:max_lines]
            total_h = max(1, int(round(size * line_height_multiplier))) * len(lines)
            max_line_w = max_width(lines, font)
            fits = len(lines) <= max_lines and max_line_w <= usable_width and total_h <= usable_height
            if fits:
                best_size = size
                best_font = font
                best_lines = lines
                low = size + 1
            else:
                high = size - 1
        best_lines = [fit_line_with_ellipsis(line, best_font) for line in best_lines[:max_lines]]
        return best_lines, best_font, best_size

    best_lines = [normalized] if normalized else [""]
    best_font = load_font(12)
    best_size = 12

    low = 8
    if preferred_font_size is not None and int(preferred_font_size) > 0:
        high = max(8, min(220, int(preferred_font_size)))
    else:
        high = 220
    while low <= high:
        size = (low + high) // 2
        font = load_font(size)
        lines = wrap_words(normalized, font)
        heights = []
        for line in lines:
            bbox = draw.textbbox((0, 0), line or "A", font=font)
            heights.append(max(1, bbox[3] - bbox[1]))
        line_height = max(1, int(round(size * line_height_multiplier)))
        total_height = line_height * len(lines)
        max_width = max((line_width(line, font) for line in lines), default=0)
        fits = len(lines) <= max_lines and max_width <= usable_width and total_height <= usable_height
        if fits:
            best_size = size
            best_font = font
            best_lines = lines
            low = size + 1
        else:
            high = size - 1

    # Ensure final lines still fit width with ellipsis.
    best_lines = [fit_line_with_ellipsis(line, best_font) for line in best_lines[:max_lines]]
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
    clip_rect: tuple[int, int, int, int] | None = None,
) -> None:
    from PIL import Image, ImageDraw, ImageFilter, ImageChops

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
        if clip_rect:
            clip_mask = Image.new("L", img.size, 0)
            clip_draw = ImageDraw.Draw(clip_mask)
            clip_draw.rectangle(clip_rect, fill=255)
            alpha = effect_layer.getchannel("A")
            effect_layer.putalpha(ImageChops.multiply(alpha, clip_mask))
        composed = Image.alpha_composite(img.convert("RGBA"), effect_layer)
        img.paste(composed.convert("RGB"))

    text_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    for (x, y), line in zip(positions, lines):
        text_draw.text((x, y), line, fill=text_color, font=font)
    if clip_rect:
        clip_mask = Image.new("L", img.size, 0)
        clip_draw = ImageDraw.Draw(clip_mask)
        clip_draw.rectangle(clip_rect, fill=255)
        alpha = text_layer.getchannel("A")
        text_layer.putalpha(ImageChops.multiply(alpha, clip_mask))
    composed = Image.alpha_composite(img.convert("RGBA"), text_layer)
    img.paste(composed.convert("RGB"))


def _resolve_dynamic_text_value(value: str, link: str | None) -> str:
    raw = str(value or "")
    outbound = (link or "").strip()
    domain = ""
    if outbound:
        try:
            from urllib.parse import urlparse

            parsed = urlparse(outbound)
            domain = (parsed.netloc or "").replace("www.", "")
        except Exception:
            domain = outbound
    replaced = re.sub(r"\{\{\s*link\s*\}\}", outbound, raw, flags=re.IGNORECASE)
    replaced = re.sub(r"\{\{\s*site_url\s*\}\}", domain or outbound, replaced, flags=re.IGNORECASE)
    replaced = re.sub(r"\{\{\s*domain\s*\}\}", domain or outbound, replaced, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", replaced).strip()


def _font_path_from_file(font_file: str | None) -> Path | None:
    if not font_file:
        return None
    candidate = Path(__file__).parent.parent.parent / "storage" / "fonts" / str(font_file)
    if candidate.exists():
        return candidate
    return None


def _draw_fitted_text_block_with_pillow(
    img,
    draw,
    *,
    value: str,
    rect: tuple[int, int, int, int],
    text_align: str,
    text_color: str,
    font_path: str | None,
    fallback_font_path: str | None,
    text_effect: str,
    text_effect_color: str,
    text_effect_offset_x: int,
    text_effect_offset_y: int,
    text_effect_blur: int,
    max_lines: int = 3,
    uppercase: bool = False,
    preferred_font_size: int | None = None,
    title_scale: float | None = None,
    force_title_layout: bool = False,
    title_padding_x: int = 15,
    line_height_multiplier: float = 1.0,
) -> None:
    x, y, width, height = rect
    if width <= 4 or height <= 4:
        return
    text = _resolve_dynamic_text_value(value, None)
    if not text:
        return

    lines, font, font_size = _fit_text_lines_with_pillow(
        draw,
        text,
        width,
        height,
        font_path,
        fallback_font_path,
        max_lines=max_lines,
        uppercase=uppercase,
        pad_x=title_padding_x,
        pad_y=0,
        effect_margin_x=text_effect_offset_x,
        effect_margin_y=text_effect_offset_y + text_effect_blur,
        preferred_font_size=preferred_font_size,
        split_layout=force_title_layout,
        line_height_multiplier=line_height_multiplier,
    )

    if title_scale is not None:
        try:
            scale = max(0.7, min(1.6, float(title_scale)))
        except (TypeError, ValueError):
            scale = 1.0
        if abs(scale - 1.0) > 0.001:
            target_size = max(8, min(220, int(round(font_size * scale))))
            lines, font, font_size = _fit_text_lines_with_pillow(
                draw,
                text,
                width,
                height,
                font_path,
                fallback_font_path,
                max_lines=max_lines,
                uppercase=uppercase,
                pad_x=title_padding_x,
                pad_y=0,
                effect_margin_x=text_effect_offset_x,
                effect_margin_y=text_effect_offset_y + text_effect_blur,
                preferred_font_size=target_size,
                split_layout=force_title_layout,
                line_height_multiplier=line_height_multiplier,
            )

    metrics = draw.textbbox((0, 0), "Ag", font=font)
    cap_height = (metrics[3] - metrics[1]) or font_size
    line_height = max(1, int(round(font_size * line_height_multiplier)))
    visual_height = cap_height + (len(lines) - 1) * line_height
    first_y = y + (height - visual_height) / 2
    center_x = x + (width / 2)
    left_x = x + title_padding_x
    right_x = x + width - title_padding_x
    positions: list[tuple[float, float]] = []

    align = str(text_align or "center").strip().lower()
    for idx, line in enumerate(lines):
        line_y = first_y + idx * line_height
        if align == "left":
            positions.append((left_x, line_y))
        elif align == "right":
            bbox = draw.textbbox((0, 0), line, font=font)
            line_w = bbox[2] - bbox[0]
            positions.append((right_x - line_w, line_y))
        else:
            bbox = draw.textbbox((0, 0), line, font=font)
            line_w = bbox[2] - bbox[0]
            positions.append((center_x - line_w / 2, line_y))

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
        clip_rect=(x, y, x + width, y + height),
    )


def _apply_custom_font_overlay(
    output_path: Path,
    render_data: Dict[str, Any],
) -> None:
    from PIL import Image, ImageDraw

    template = render_data.get("template", {})
    settings = render_data.get("settings", {})
    secondary_slots = template.get("secondaryTextSlots") or []
    custom_font_file = settings.get("customFontFile") or settings.get("custom_font_file")
    custom_font_path = _font_path_from_file(custom_font_file)
    has_slot_custom_font = any(
        _font_path_from_file(raw_slot.get("custom_font_file"))
        for raw_slot in secondary_slots
        if isinstance(raw_slot, dict)
    )
    if not custom_font_path and not has_slot_custom_font:
        return

    img = Image.open(output_path).convert("RGB")
    draw = ImageDraw.Draw(img)

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
    title_scale = settings.get("titleScale", settings.get("title_scale", 1))
    title_padding_x = int(settings.get("titlePaddingX", settings.get("title_padding_x", 15)) or 15)
    line_height_multiplier = float(settings.get("lineHeightMultiplier", settings.get("line_height_multiplier", 1)) or 1)
    title = content.get("title", "")

    # Keep original template background/border untouched; only redraw text with custom font.

    fallback_font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    title_font_path = str(custom_font_path) if custom_font_path else None

    if title:
        _draw_fitted_text_block_with_pillow(
            img,
            draw,
            value=title,
            rect=(pad_left, text_zone_y, text_area_w, text_zone_h),
            text_align=text_align,
            text_color=text_color,
            font_path=title_font_path,
            fallback_font_path=fallback_font,
            text_effect=text_effect,
            text_effect_color=text_effect_color,
            text_effect_offset_x=text_effect_offset_x,
            text_effect_offset_y=text_effect_offset_y,
            text_effect_blur=text_effect_blur,
            max_lines=3,
            uppercase=True,
            title_scale=title_scale,
            force_title_layout=True,
            title_padding_x=title_padding_x,
            line_height_multiplier=line_height_multiplier,
        )

    secondary_defaults = template.get("secondaryTextDefaults") or {}
    secondary_values = settings.get("secondaryTextValues") or {}
    if not isinstance(secondary_values, dict):
        secondary_values = {}

    for raw_slot in secondary_slots:
        if not isinstance(raw_slot, dict):
            continue
        if raw_slot.get("enabled") is False:
            continue
        slot_id = str(raw_slot.get("slot_id") or "").strip()
        if not slot_id:
            continue
        value = secondary_values.get(slot_id)
        if value is None:
            value = secondary_defaults.get(slot_id, raw_slot.get("default_text", ""))
        rendered_value = _resolve_dynamic_text_value(str(value or ""), content.get("link"))
        if not rendered_value:
            continue

        slot_x = int(raw_slot.get("x", 0) or 0)
        slot_y = int(raw_slot.get("y", 0) or 0)
        slot_w = int(raw_slot.get("width", 0) or 0)
        slot_h = int(raw_slot.get("height", 0) or 0)
        if slot_w < 8 or slot_h < 8:
            continue

        if raw_slot.get("mask_original", True):
            mask_color = str(raw_slot.get("mask_color") or settings.get("textZoneBgColor") or "#ffffff")
            draw.rectangle([slot_x, slot_y, slot_x + slot_w, slot_y + slot_h], fill=mask_color)

        slot_font_path = _font_path_from_file(raw_slot.get("custom_font_file"))
        if not slot_font_path:
            slot_font_path = custom_font_path
        resolved_slot_font = str(slot_font_path) if slot_font_path else None

        _draw_fitted_text_block_with_pillow(
            img,
            draw,
            value=rendered_value,
            rect=(slot_x, slot_y, slot_w, slot_h),
            text_align=str(raw_slot.get("text_align") or "center"),
            text_color=str(raw_slot.get("text_color") or text_color),
            font_path=resolved_slot_font,
            fallback_font_path=fallback_font,
            text_effect=str(raw_slot.get("text_effect") or "none"),
            text_effect_color=str(raw_slot.get("text_effect_color") or "#000000"),
            text_effect_offset_x=int(raw_slot.get("text_effect_offset_x", 2) or 2),
            text_effect_offset_y=int(raw_slot.get("text_effect_offset_y", 2) or 2),
            text_effect_blur=int(raw_slot.get("text_effect_blur", 0) or 0),
            max_lines=int(raw_slot.get("max_lines", 2) or 2),
            uppercase=bool(raw_slot.get("uppercase", False)),
            preferred_font_size=int(raw_slot.get("font_size", 0) or 0),
            line_height_multiplier=float(raw_slot.get("line_height_multiplier", 1) or 1),
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

    # Generate output filename (unique per render to avoid stale-file collisions).
    timestamp = int(time.time() * 1000)
    suffix = uuid.uuid4().hex[:8]
    output_filename = f"pin_{pin.id}_{timestamp}_{suffix}.png"
    output_path = RENDERER_DIR / output_filename

    # Render pin with the selected image
    success, engine_used = await render_pin_to_file(
        page,
        template,
        template_data,
        output_path,
        settings,
        pin.selected_image_url,
        pin.title,
    )

    if success and output_path.exists():
        # Update pin with hosted URL
        # Add a cache-busting version because pin IDs are reused and browsers
        # otherwise keep serving stale PNGs after re-rendering.
        pin.media_url = (
            f"/static/pins/{output_filename}?v={int(time.time())}"
            f"&rv={RENDER_LAYOUT_VERSION}"
            f"&re={engine_used or resolve_render_engine()}"
        )
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
    line_height_multiplier = max(0.8, min(1.4, float(line_height_multiplier or 1.0)))
    title_padding_x = max(8, min(36, int(title_padding_x or 15)))
    line_height_multiplier = max(0.8, min(1.4, float(line_height_multiplier or 1.0)))
