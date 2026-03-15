"""
Template parser service for extracting SVG template data.

Uses clipPath-based zone detection (not data-zone attributes).
Based on the reference implementation in React/index.html
"""
import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import base64
from io import BytesIO
import logging

logger = logging.getLogger(__name__)


def parse_svg_template(svg_content: str) -> Dict[str, Any]:
    """Parse SVG and extract canvas size, zones, and template data.

    This implementation uses clipPath detection (not data-zone attributes)
    as per the reference implementation.

    Args:
        svg_content: SVG file content as string

    Returns:
        Dictionary containing:
            - width: canvas width
            - height: canvas height
            - zones: list of detected image zones
            - text_zone_y: y position of text zone
            - text_zone_height: height of text zone
            - text_zone_border_color: detected border color (if any)
            - text_zone_text_color: detected text color (if any)
            - text_elements: list of static text elements
            - stripped_svg: SVG with placeholders removed for overlay
    """
    # Parse SVG
    try:
        root = ET.fromstring(svg_content)
    except ET.ParseError as e:
        raise ValueError(f"Invalid SVG: {str(e)}")

    # Register namespace for SVG
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')

    # Extract canvas dimensions
    width, height = extract_canvas_size(root)

    # Build clipPath bounding-box map
    clip_paths = parse_clip_paths(root)
    logger.info(f"Parsed {len(clip_paths)} clipPaths from template")

    # Detect image zones from clipPaths around <image> elements
    zones = detect_image_zones(root, clip_paths)

    # Sort zones by y-position
    zones.sort(key=lambda z: z['y'])

    # Detect text zone
    text_zone_y, text_zone_height = detect_text_zone(root, zones, width, height)

    # Detect text zone border
    text_zone_border_color, text_zone_border_width = detect_text_zone_border(
        root, clip_paths, text_zone_y, text_zone_height, width
    )

    # Detect text zone text color
    text_zone_text_color = detect_text_zone_text_color(root, text_zone_y, text_zone_height)

    # Extract static text elements (for footer, brand, etc.)
    text_elements = extract_text_elements(root, text_zone_y, text_zone_height)

    # Strip placeholders and create overlay SVG
    stripped_svg = strip_placeholders(svg_content, text_zone_y, text_zone_height)

    return {
        'width': width,
        'height': height,
        'zones': zones,
        'text_zone_y': text_zone_y,
        'text_zone_height': text_zone_height,
        'text_zone_border_color': text_zone_border_color,
        'text_zone_border_width': text_zone_border_width,
        'text_zone_text_color': text_zone_text_color,
        'text_elements': text_elements,
        'stripped_svg': stripped_svg,
    }


def extract_canvas_size(root: ET.Element) -> Tuple[int, int]:
    """Extract canvas width and height from SVG element."""
    # Default values
    width = 952
    height = 2000

    # Try viewBox first
    viewbox = root.get('viewBox')
    if viewbox:
        parts = viewbox.strip().split()
        if len(parts) >= 4:
            width = int(round(float(parts[2])))
            height = int(round(float(parts[3])))
            return width, height

    # Fall back to width/height attributes
    width_attr = root.get('width')
    height_attr = root.get('height')

    if width_attr:
        width = int(round(float(width_attr)))
    if height_attr:
        height = int(round(float(height_attr)))

    return width, height


def parse_clip_paths(root: ET.Element) -> Dict[str, Dict[str, float]]:
    """Parse all clipPath elements and extract their bounding boxes."""
    clip_paths = {}

    # SVG namespace
    ns = {'svg': 'http://www.w3.org/2000/svg'}

    for clip_path in root.iter():
        if clip_path.tag.endswith('clipPath'):
            cp_id = clip_path.get('id')
            if not cp_id:
                continue

            bbox = parse_clip_path_bbox(clip_path)
            if bbox:
                clip_paths[cp_id] = bbox

    return clip_paths


def parse_clip_path_bbox(clip_path: ET.Element) -> Optional[Dict[str, float]]:
    """Extract bounding box from a clipPath element."""
    # Try to find a path element
    path = clip_path.find('.//{http://www.w3.org/2000/svg}path')
    if path is not None:
        d = path.get('d', '')
        if d:
            bbox = parse_path_bbox(d)
            if bbox and bbox['width'] > 10 and bbox['height'] > 10:
                return bbox

    # Try to find a rect element
    rect = clip_path.find('.//{http://www.w3.org/2000/svg}rect')
    if rect is not None:
        x = float(rect.get('x', 0))
        y = float(rect.get('y', 0))
        w = float(rect.get('width', 0))
        h = float(rect.get('height', 0))
        if w > 10 and h > 10:
            return {'x': x, 'y': y, 'width': w, 'height': h}

    return None


def parse_path_bbox(d: str) -> Optional[Dict[str, float]]:
    """Parse SVG path data and calculate bounding box."""
    # Extract all numbers from path data
    numbers = re.findall(r'-?\d+\.?\d*', d)
    if len(numbers) < 4:
        return None

    # Convert to float and pair up as coordinates
    coords = [float(n) for n in numbers]
    points = []
    for i in range(0, len(coords) - 1, 2):
        points.append({'x': coords[i], 'y': coords[i + 1]})

    if not points:
        return None

    xs = [p['x'] for p in points]
    ys = [p['y'] for p in points]

    x = min(xs)
    y = min(ys)
    width = max(xs) - x
    height = max(ys) - y

    return {'x': x, 'y': y, 'width': width, 'height': height}


def detect_image_zones(root: ET.Element, clip_paths: Dict[str, Dict[str, float]]) -> List[Dict[str, float]]:
    """Detect image zones by finding clipPaths around <image> elements.

    Uses parent map for proper upward traversal (like React's parentElement).
    """
    zones = []

    # Build parent map for proper upward traversal
    # This maps each child element to its parent, allowing us to walk up the tree
    parent_map = {c: p for p in root.iter() for c in p}

    logger.debug(f"Built parent map with {len(parent_map)} entries")

    for img in root.iter():
        if img.tag.endswith('image'):
            outermost_bbox = None
            current = img

            # Walk up tree using parent map (like React's parentElement)
            while current is not None and current != root:
                cp_attr = current.get('clip-path')
                if cp_attr:
                    # Extract clipPath ID from url(#id)
                    match = re.search(r'url\(#([^)]+)\)', cp_attr)
                    if match and match.group(1) in clip_paths:
                        outermost_bbox = clip_paths[match.group(1)]
                        logger.debug(f"Found clip-path #{match.group(1)} for image at bbox: {outermost_bbox}")
                # Move to parent using parent map
                current = parent_map.get(current)

            if outermost_bbox:
                zones.append(outermost_bbox.copy())
                logger.debug(f"Added image zone: {outermost_bbox}")
            else:
                logger.warning(f"No clip-path found for <image> element")

    logger.info(f"Detected {len(zones)} image zones total")
    return zones


def detect_text_zone(root: ET.Element, zones: List[Dict[str, float]], canvas_width: int, canvas_height: int) -> Tuple[int, int]:
    """Detect text zone position and height.

    Strategy:
    1. Look for a wide, short clipPath centered between image zones
    2. Fall back to gap between image zones
    3. Default to 44% from top with 12% height
    """
    # Default values
    text_zone_y = int(round(canvas_height * 0.44))
    text_zone_height = int(round(canvas_height * 0.12))

    if len(zones) >= 2:
        bottom1 = zones[0]['y'] + zones[0]['height']
        top2 = zones[1]['y']
        gap_center = (bottom1 + top2) / 2

        # Try to find a matching clipPath
        clip_paths = parse_clip_paths(root)
        best_cp = None
        best_area = 0

        for bbox in clip_paths.values():
            if bbox['width'] < canvas_width * 0.5:
                continue
            if bbox['height'] > canvas_height * 0.25:
                continue

            cp_center = bbox['y'] + bbox['height'] / 2
            if cp_center < bottom1 - 40 or cp_center > top2 + 40:
                continue

            area = bbox['width'] * bbox['height']
            if area > best_area:
                best_area = area
                best_cp = bbox

        if best_cp:
            text_zone_y = int(round(best_cp['y']))
            text_zone_height = int(round(best_cp['height']))
        elif top2 > bottom1:
            text_zone_y = int(round(bottom1))
            text_zone_height = int(round(top2 - bottom1))

    elif len(zones) == 1:
        text_zone_y = int(round(zones[0]['y'] + zones[0]['height']))
        text_zone_height = int(round(canvas_height * 0.12))

    return text_zone_y, text_zone_height


def detect_text_zone_border(
    root: ET.Element,
    clip_paths: Dict[str, Dict[str, float]],
    text_zone_y: int,
    text_zone_height: int,
    canvas_width: int,
) -> Tuple[Optional[str], Optional[int]]:
    """Detect text zone border color from SVG stroke elements."""
    for cp_id, bbox in clip_paths.items():
        # Match clipPaths that closely wrap the text zone
        if abs(bbox['y'] - text_zone_y) > 60:
            continue
        if abs(bbox['height'] - text_zone_height) > 60:
            continue
        if bbox['width'] < canvas_width * 0.5:
            continue

        # Find elements using this clipPath
        for elem in root.iter():
            cp_attr = elem.get('clip-path')
            if cp_attr and f'url(#{cp_id})' in cp_attr:
                # Look for stroke-only elements
                stroke = elem.get('stroke')
                fill = elem.get('fill')
                if stroke and stroke != 'none' and (not fill or fill == 'none'):
                    return stroke.lower(), 4

    return None, None


def detect_text_zone_text_color(root: ET.Element, text_zone_y: int, text_zone_height: int) -> Optional[str]:
    """Detect text color from fill-opacity elements in text zone."""
    tz_top = text_zone_y - 10
    tz_bottom = text_zone_y + text_zone_height + 10

    best_color = None
    best_opacity = 0

    for elem in root.iter():
        fill_opacity = elem.get('fill-opacity')
        if not fill_opacity:
            continue

        if elem.get('clip-path'):
            continue
        if elem.get('transform'):
            continue

        # Check for child with transform
        has_transform_child = False
        for child in elem:
            if child.get('transform'):
                has_transform_child = True
                # Extract Y translate
                transform = child.get('transform', '')
                match = re.search(r'translate\(\s*[\d.-]+\s*,\s*([\d.-]+)\s*\)', transform)
                if match:
                    ty = float(match.group(1))
                    if tz_top <= ty <= tz_bottom:
                        opacity = float(fill_opacity)
                        fill = elem.get('fill')
                        if fill and fill != 'none' and opacity > best_opacity:
                            best_color = fill.lower()
                            best_opacity = opacity

    return best_color


def extract_text_elements(root: ET.Element, text_zone_y: int, text_zone_height: int) -> List[Dict[str, Any]]:
    """Extract static text elements (for footer, brand, etc.)."""
    elements = []

    for elem in root.iter():
        if elem.tag.endswith('text'):
            if is_text_in_zone(elem, text_zone_y, text_zone_height):
                continue
            content = elem.text or ''
            if not content:
                # Check for tspan children
                for tspan in elem:
                    if tspan.text:
                        content += tspan.text

            if content.strip():
                elements.append({
                    'content': content.strip(),
                    'x': float(elem.get('x', 0)),
                    'y': float(elem.get('y', 0)),
                    'font_size': float(elem.get('font-size', 16)),
                    'font_weight': elem.get('font-weight', 'normal'),
                    'font_family': elem.get('font-family', 'sans-serif'),
                    'fill': elem.get('fill', '#000000'),
                    'text_anchor': elem.get('text-anchor', 'start'),
                })

    return elements


def is_text_in_zone(elem: ET.Element, text_zone_y: int, text_zone_height: int) -> bool:
    """Return True when a text element belongs to the editable title zone."""
    y_value = elem.get('y')
    if y_value:
        try:
            y = float(y_value)
            return (text_zone_y - 20) <= y <= (text_zone_y + text_zone_height + 20)
        except ValueError:
            pass

    for child in elem.iter():
        transform = child.get('transform')
        if not transform:
            continue
        match = re.search(r'translate\(\s*[\d.-]+\s*,\s*([\d.-]+)\s*\)', transform)
        if match:
            ty = float(match.group(1))
            if (text_zone_y - 20) <= ty <= (text_zone_y + text_zone_height + 20):
                return True

    return False


def strip_placeholders(svg_content: str, text_zone_y: int, text_zone_height: int) -> str:
    """Remove placeholder elements from SVG for overlay rendering.

    Removes:
    1. <image> placeholder elements
    2. Large white background rects extending beyond canvas
    3. Canva-style placeholder text (path-based, nested g[fill-opacity] groups)

    Uses xml.etree for proper DOM traversal (regex is too fragile for nested structures).
    """
    # Parse SVG with ElementTree
    try:
        root = ET.fromstring(svg_content)
    except ET.ParseError as e:
        logger.warning(f"Failed to parse SVG for placeholder removal: {e}, falling back to regex")
        return _strip_placeholders_fallback(svg_content)

    # Build parent map for removal
    parent_map = {c: p for p in root.iter() for c in p}

    # Define text zone bounds (with some padding)
    tz_top_strict = text_zone_y - 10
    tz_bottom_strict = text_zone_y + text_zone_height + 10

    # Find and remove Canva-style placeholder text:
    # Pattern: <g fill-opacity><g transform="translate(x,Y)"> where Y is in text zone
    elements_to_remove = []

    for elem in root.iter():
        fill_opacity = elem.get('fill-opacity')
        if fill_opacity is None:
            continue

        # Skip structural clip groups or already-transformed groups
        if elem.get('clip-path'):
            continue
        if elem.get('transform'):
            continue

        # Check for direct child with transform
        child_transform_elem = None
        for child in elem:
            if child.get('transform'):
                child_transform_elem = child
                break

        if not child_transform_elem:
            continue

        # Extract Y coordinate from transform
        transform = child_transform_elem.get('transform')
        match = re.search(r'translate\(\s*[\d.-]+\s*,\s*([\d.-]+)\s*\)', transform)
        if not match:
            continue

        ty = float(match.group(1))

        # Check if Y is in text zone
        if tz_top_strict <= ty <= tz_bottom_strict:
            elements_to_remove.append(elem)

    # Remove identified elements using parent map
    for elem in elements_to_remove:
        parent = parent_map.get(elem)
        if parent is not None:
            parent.remove(elem)

    text_elements_to_remove = []
    for elem in root.iter():
        if elem.tag.endswith('text') and is_text_in_zone(elem, text_zone_y, text_zone_height):
            text_elements_to_remove.append(elem)

    for elem in text_elements_to_remove:
        parent = parent_map.get(elem)
        if parent is not None:
            parent.remove(elem)

    logger.info(f"Removed {len(elements_to_remove)} Canva-style placeholder elements")
    logger.info(f"Removed {len(text_elements_to_remove)} text elements from title zone")

    # Convert back to string
    result = ET.tostring(root, encoding='unicode')

    # Also remove image elements and large background rects (keep existing logic)
    result = re.sub(r'<image[^>]*>', '', result)
    result = re.sub(r'</image>', '', result)
    result = re.sub(r'<rect[^>]*\s(?:x|y)=["\']-\d[^>]*>', '', result)

    return result


def _strip_placeholders_fallback(svg_content: str) -> str:
    """Fallback placeholder removal using regex only."""
    result = svg_content

    # Remove image elements
    result = re.sub(r'<image[^>]*>', '', result)
    result = re.sub(r'</image>', '', result)

    # Remove large background rects (those with negative x or y)
    result = re.sub(r'<rect[^>]*\sx=["\']-\d[^>]*>', '', result)

    return result
