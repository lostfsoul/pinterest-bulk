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
            - secondary_text_slots: list of editable secondary text slot metadata
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
    zones, image_clip_ids = detect_image_zones(root, clip_paths, width, height)

    # Sort zones by y-position
    zones.sort(key=lambda z: z['y'])

    # Detect text zone
    text_zone_x, text_zone_y, text_zone_width, text_zone_height, text_align = detect_text_zone(
        root,
        zones,
        width,
        height,
        clip_paths,
        image_clip_ids,
    )

    # Detect text zone border
    text_zone_border_color, text_zone_border_width = detect_text_zone_border(
        root, clip_paths, text_zone_y, text_zone_height, width
    )

    # Detect text zone text color
    text_zone_text_color = detect_text_zone_text_color(root, text_zone_y, text_zone_height)

    # Extract static text elements (for footer, brand, etc.)
    text_elements = extract_text_elements(root, text_zone_y, text_zone_height)

    # Detect editable secondary text slots (including path-based text exports).
    secondary_text_slots = detect_secondary_text_slots(
        root=root,
        clip_paths=clip_paths,
        image_clip_ids=image_clip_ids,
        zones=zones,
        canvas_width=width,
        canvas_height=height,
        text_zone_y=text_zone_y,
        text_zone_height=text_zone_height,
    )

    # Strip placeholders and create overlay SVG
    stripped_svg = strip_placeholders(svg_content, text_zone_y, text_zone_height)

    return {
        'width': width,
        'height': height,
        'zones': zones,
        'text_zone_x': text_zone_x,
        'text_zone_y': text_zone_y,
        'text_zone_width': text_zone_width,
        'text_zone_height': text_zone_height,
        'text_zone_align': text_align,
        'text_zone_border_color': text_zone_border_color,
        'text_zone_border_width': text_zone_border_width,
        'text_zone_text_color': text_zone_text_color,
        'text_elements': text_elements,
        'secondary_text_slots': secondary_text_slots,
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


def detect_image_zones(
    root: ET.Element,
    clip_paths: Dict[str, Dict[str, float]],
    canvas_width: int,
    canvas_height: int,
) -> Tuple[List[Dict[str, float]], set[str]]:
    """Detect image zones by finding clipPaths around <image> elements.

    Uses parent map for proper upward traversal (like React's parentElement).
    """
    zones = []
    image_clip_ids: set[str] = set()

    # Build parent map for proper upward traversal
    # This maps each child element to its parent, allowing us to walk up the tree
    parent_map = {c: p for p in root.iter() for c in p}

    logger.debug(f"Built parent map with {len(parent_map)} entries")

    for img in root.iter():
        if img.tag.endswith('image'):
            candidate_boxes: list[tuple[str, Dict[str, float]]] = []
            total_transform = accumulate_element_transform(img, parent_map, root)
            image_bbox = image_bbox_from_element(img, total_transform)
            current = img

            # Walk up tree and collect all clipPaths on ancestors.
            while current is not None and current != root:
                cp_attr = current.get('clip-path')
                if cp_attr:
                    # Extract clipPath ID from url(#id)
                    match = re.search(r'url\(#([^)]+)\)', cp_attr)
                    if match and match.group(1) in clip_paths:
                        cp_id = match.group(1)
                        bbox = clip_paths[cp_id]
                        current_transform = accumulate_element_transform(current, parent_map, root)
                        candidate_boxes.append((cp_id, choose_image_zone_candidate(
                            bbox,
                            current_transform,
                            image_bbox,
                            canvas_width,
                            canvas_height,
                        )))
                        logger.debug(f"Found clip-path #{cp_id} for image at bbox: {bbox}")
                # Move to parent using parent map
                current = parent_map.get(current)

            if candidate_boxes:
                cp_id, chosen = max(
                    candidate_boxes,
                    key=lambda item: score_image_zone_candidate(
                        item[1],
                        image_bbox,
                        canvas_width,
                        canvas_height,
                    ),
                )
                image_clip_ids.add(cp_id)
                zones.append(chosen.copy())
                logger.debug(f"Added image zone from #{cp_id}: {chosen}")
            else:
                # Fallback: use image element bounds if available.
                fallback_bbox = image_bbox
                if fallback_bbox:
                    zones.append(fallback_bbox)
                    logger.debug(f"Added fallback image zone from <image> attrs: {fallback_bbox}")
                else:
                    logger.warning(f"No clip-path found for <image> element")

    # De-duplicate near-identical boxes (same clip path reused by multiple images)
    deduped: list[Dict[str, float]] = []
    seen_keys: set[tuple[int, int, int, int]] = set()
    for zone in zones:
        key = (
            int(round(zone["x"])),
            int(round(zone["y"])),
            int(round(zone["width"])),
            int(round(zone["height"])),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(zone)

    # Drop giant full-canvas zones when more specific zones exist.
    canvas_area = float(canvas_width * canvas_height)
    filtered = deduped
    if len(deduped) > 1:
        non_giant = [
            z for z in deduped
            if (z["width"] * z["height"]) < (canvas_area * 0.85)
        ]
        if non_giant:
            filtered = non_giant

    logger.info(f"Detected {len(filtered)} image zones total")
    return filtered, image_clip_ids


def parse_transform_components(transform: str) -> tuple[float, float, float, float]:
    """Parse translate/matrix and return (tx, ty, sx, sy)."""
    tx = 0.0
    ty = 0.0
    sx = 1.0
    sy = 1.0
    if not transform:
        return tx, ty, sx, sy

    translate_match = re.search(r"translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)", transform)
    if translate_match:
        tx += float(translate_match.group(1))
        ty += float(translate_match.group(2))
    matrix_match = re.search(
        r"matrix\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)",
        transform,
    )
    if matrix_match:
        sx *= float(matrix_match.group(1))
        sy *= float(matrix_match.group(4))
        tx += float(matrix_match.group(5))
        ty += float(matrix_match.group(6))

    return tx, ty, sx, sy


def accumulate_element_transform(
    elem: ET.Element,
    parent_map: Dict[ET.Element, ET.Element],
    root: ET.Element,
) -> tuple[float, float, float, float]:
    """Accumulate translate/scale transform from element up to root."""
    tx = 0.0
    ty = 0.0
    sx = 1.0
    sy = 1.0

    current: Optional[ET.Element] = elem
    while current is not None and current != root:
        c_tx, c_ty, c_sx, c_sy = parse_transform_components(current.get("transform") or "")
        tx = tx * c_sx + c_tx
        ty = ty * c_sy + c_ty
        sx *= c_sx
        sy *= c_sy
        current = parent_map.get(current)

    return tx, ty, sx, sy


def apply_bbox_transform(
    bbox: Dict[str, float],
    transform: tuple[float, float, float, float],
) -> Dict[str, float]:
    tx, ty, sx, sy = transform
    return {
        "x": bbox["x"] * sx + tx,
        "y": bbox["y"] * sy + ty,
        "width": abs(bbox["width"] * sx),
        "height": abs(bbox["height"] * sy),
    }


def image_bbox_from_element(
    img: ET.Element,
    transform: tuple[float, float, float, float],
) -> Optional[Dict[str, float]]:
    try:
        x = float(img.get("x", 0))
        y = float(img.get("y", 0))
        w = float(img.get("width", 0))
        h = float(img.get("height", 0))
    except ValueError:
        return None
    if w <= 10 or h <= 10:
        return None
    return apply_bbox_transform({"x": x, "y": y, "width": w, "height": h}, transform)


def clamp_bbox_to_canvas(
    bbox: Dict[str, float],
    canvas_width: int,
    canvas_height: int,
) -> Optional[Dict[str, float]]:
    x1 = max(0.0, bbox["x"])
    y1 = max(0.0, bbox["y"])
    x2 = min(float(canvas_width), bbox["x"] + bbox["width"])
    y2 = min(float(canvas_height), bbox["y"] + bbox["height"])
    if (x2 - x1) <= 10 or (y2 - y1) <= 10:
        return None
    return {
        "x": x1,
        "y": y1,
        "width": x2 - x1,
        "height": y2 - y1,
    }


def bbox_overlap_area(a: Dict[str, float], b: Dict[str, float]) -> float:
    x1 = max(a["x"], b["x"])
    y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["width"], b["x"] + b["width"])
    y2 = min(a["y"] + a["height"], b["y"] + b["height"])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return (x2 - x1) * (y2 - y1)


def score_image_zone_candidate(
    candidate: Dict[str, float],
    image_bbox: Optional[Dict[str, float]],
    canvas_width: int,
    canvas_height: int,
) -> tuple[float, float, float]:
    area = max(candidate["width"] * candidate["height"], 1.0)
    overlap_ratio = 0.0
    size_delta = area
    if image_bbox:
        image_area = max(image_bbox["width"] * image_bbox["height"], 1.0)
        overlap = bbox_overlap_area(candidate, image_bbox)
        overlap_ratio = overlap / image_area
        size_delta = abs(area - image_area)
    canvas_penalty = 0.0
    if (
        candidate["x"] < 0
        or candidate["y"] < 0
        or (candidate["x"] + candidate["width"]) > canvas_width
        or (candidate["y"] + candidate["height"]) > canvas_height
    ):
        canvas_penalty = 1.0
    return (
        overlap_ratio - canvas_penalty,
        -size_delta,
        -area,
    )


def choose_image_zone_candidate(
    raw_bbox: Dict[str, float],
    current_transform: tuple[float, float, float, float],
    image_bbox: Optional[Dict[str, float]],
    canvas_width: int,
    canvas_height: int,
) -> Dict[str, float]:
    candidates: list[Dict[str, float]] = []
    raw_clamped = clamp_bbox_to_canvas(raw_bbox, canvas_width, canvas_height)
    if raw_clamped:
        candidates.append(raw_clamped)
    transformed = apply_bbox_transform(raw_bbox, current_transform)
    transformed_clamped = clamp_bbox_to_canvas(transformed, canvas_width, canvas_height)
    if transformed_clamped:
        candidates.append(transformed_clamped)
    if not candidates:
        return raw_bbox
    return max(
        candidates,
        key=lambda candidate: score_image_zone_candidate(
            candidate,
            image_bbox,
            canvas_width,
            canvas_height,
        ),
    )


def detect_text_zone(
    root: ET.Element,
    zones: List[Dict[str, float]],
    canvas_width: int,
    canvas_height: int,
    clip_paths: Dict[str, Dict[str, float]],
    image_clip_ids: set[str],
) -> Tuple[int, int, int, int, str]:
    """Detect text zone position and height.

    Strategy:
    1. Look for a wide, short clipPath centered between image zones
    2. Fall back to gap between image zones
    3. Default to 44% from top with 12% height
    """
    # Default values
    text_zone_x = 0
    text_zone_y = int(round(canvas_height * 0.44))
    text_zone_width = canvas_width
    text_zone_height = int(round(canvas_height * 0.12))
    text_align = "center"

    image_bottom = max((z['y'] + z['height'] for z in zones), default=canvas_height * 0.35)

    # Build parent map once for transform traversal.
    parent_map = {c: p for p in root.iter() for c in p}

    # Prefer explicit text containers from template structure.
    foreign_objects: list[dict[str, float]] = []
    for elem in root.iter():
        if not elem.tag.endswith('foreignObject'):
            continue
        try:
            x = float(elem.get('x', 0))
            y = float(elem.get('y', 0))
            w = float(elem.get('width', 0))
            h = float(elem.get('height', 0))
        except ValueError:
            continue
        if w > canvas_width * 0.35 and h > 20 and y >= image_bottom - 20:
            foreign_objects.append({'x': x, 'y': y, 'width': w, 'height': h})

    if foreign_objects:
        x = min(item['x'] for item in foreign_objects)
        y = min(item['y'] for item in foreign_objects)
        right = max(item['x'] + item['width'] for item in foreign_objects)
        bottom = max(item['y'] + item['height'] for item in foreign_objects)
        text_zone_x = int(round(max(0, x)))
        text_zone_y = int(round(max(0, y)))
        text_zone_width = int(round(min(canvas_width, right) - text_zone_x))
        text_zone_height = int(round(min(canvas_height, bottom) - text_zone_y))
        text_align = "left"
        if text_zone_width > 10 and text_zone_height > 10:
            return text_zone_x, text_zone_y, text_zone_width, text_zone_height, text_align

    # Canva exports often flatten text to path groups clipped by non-image clipPaths.
    # Detect those groups and merge top candidates into a usable text zone.
    path_text_blocks: list[dict[str, float]] = []
    for elem in root.iter():
        cp_attr = elem.get("clip-path")
        if not cp_attr:
            continue
        match = re.search(r"url\(#([^)]+)\)", cp_attr)
        if not match:
            continue
        cp_id = match.group(1)
        if cp_id in image_clip_ids:
            continue
        bbox = clip_paths.get(cp_id)
        if not bbox:
            continue
        area = bbox["width"] * bbox["height"]
        if area < 400 or area > (canvas_width * canvas_height * 0.8):
            continue

        has_path = any(child.tag.endswith("path") for child in elem.iter())
        has_image = any(child.tag.endswith("image") for child in elem.iter())
        if not has_path or has_image:
            continue

        tx = 0.0
        ty = 0.0
        current: Optional[ET.Element] = elem
        while current is not None and current != root:
            transform = current.get("transform") or ""
            translate_match = re.search(r"translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)", transform)
            if translate_match:
                tx += float(translate_match.group(1))
                ty += float(translate_match.group(2))
            matrix_match = re.search(
                r"matrix\(\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)",
                transform,
            )
            if matrix_match:
                tx += float(matrix_match.group(1))
                ty += float(matrix_match.group(2))
            current = parent_map.get(current)

        path_text_blocks.append({
            "x": bbox["x"] + tx,
            "y": bbox["y"] + ty,
            "width": bbox["width"],
            "height": bbox["height"],
        })

    if path_text_blocks:
        path_text_blocks.sort(key=lambda b: b["width"] * b["height"], reverse=True)
        top_blocks = path_text_blocks[:2]
        x = min(item["x"] for item in top_blocks)
        y = min(item["y"] for item in top_blocks)
        right = max(item["x"] + item["width"] for item in top_blocks)
        bottom = max(item["y"] + item["height"] for item in top_blocks)
        text_zone_x = int(round(max(0, x)))
        text_zone_y = int(round(max(0, y)))
        text_zone_width = int(round(min(canvas_width, right) - text_zone_x))
        text_zone_height = int(round(min(canvas_height, bottom) - text_zone_y))
        text_align = "center"
        if text_zone_width > 10 and text_zone_height > 10:
            return text_zone_x, text_zone_y, text_zone_width, text_zone_height, text_align

    # Next, detect a dedicated text background rect below image blocks.
    rect_candidates: list[dict[str, float]] = []
    for elem in root.iter():
        if not elem.tag.endswith('rect'):
            continue
        if elem.get('clip-path'):
            continue
        try:
            x = float(elem.get('x', 0))
            y = float(elem.get('y', 0))
            w = float(elem.get('width', 0))
            h = float(elem.get('height', 0))
        except ValueError:
            continue
        if w < canvas_width * 0.5 or h < canvas_height * 0.08:
            continue
        if y < image_bottom - 20:
            continue
        rect_candidates.append({'x': x, 'y': y, 'width': w, 'height': h})

    if rect_candidates:
        best = max(rect_candidates, key=lambda r: r['width'] * r['height'])
        text_zone_x = int(round(max(0, best['x'])))
        text_zone_y = int(round(max(0, best['y'])))
        text_zone_width = int(round(min(canvas_width, best['x'] + best['width']) - text_zone_x))
        text_zone_height = int(round(min(canvas_height, best['y'] + best['height']) - text_zone_y))
        text_align = "left"
        if text_zone_width > 10 and text_zone_height > 10:
            return text_zone_x, text_zone_y, text_zone_width, text_zone_height, text_align

    if len(zones) >= 2:
        # For 3+ image templates, find the largest vertical gap between consecutive zones.
        # This is a more stable default text region than always using first two zones.
        gaps: list[tuple[float, float]] = []
        for idx in range(len(zones) - 1):
            gap_top = zones[idx]['y'] + zones[idx]['height']
            gap_bottom = zones[idx + 1]['y']
            if gap_bottom > gap_top + 8:
                gaps.append((gap_top, gap_bottom))

        chosen_gap: tuple[float, float] | None = None
        if gaps:
            chosen_gap = max(gaps, key=lambda item: item[1] - item[0])
        else:
            # No clear gap: fallback to first two zones
            chosen_gap = (
                zones[0]['y'] + zones[0]['height'],
                zones[1]['y'],
            )

        bottom1, top2 = chosen_gap

        # Try to find a matching wide clipPath around chosen gap center.
        best_cp = None
        best_area = 0
        for bbox in clip_paths.values():
            if bbox['width'] < canvas_width * 0.5:
                continue
            if bbox['height'] > canvas_height * 0.35:
                continue
            cp_center = bbox['y'] + bbox['height'] / 2
            if cp_center < bottom1 - 40 or cp_center > top2 + 40:
                continue
            area = bbox['width'] * bbox['height']
            if area > best_area:
                best_area = area
                best_cp = bbox

        if best_cp:
            text_zone_x = int(round(best_cp['x']))
            text_zone_y = int(round(best_cp['y']))
            text_zone_width = int(round(best_cp['width']))
            text_zone_height = int(round(best_cp['height']))
        elif top2 > bottom1:
            text_zone_y = int(round(bottom1))
            text_zone_height = int(round(top2 - bottom1))

    elif len(zones) == 1:
        text_zone_y = int(round(zones[0]['y'] + zones[0]['height']))
        text_zone_height = int(round(canvas_height * 0.12))

    return text_zone_x, text_zone_y, text_zone_width, text_zone_height, text_align


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


def _extract_text_node_content(elem: ET.Element) -> str:
    chunks: list[str] = []
    if elem.text:
        chunks.append(elem.text)
    for child in elem.iter():
        if child is elem:
            continue
        if child.text:
            chunks.append(child.text)
    value = " ".join(part.strip() for part in chunks if part and part.strip())
    return re.sub(r"\s+", " ", value).strip()


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_hex_color(value: Any, fallback: str = "#000000") -> str:
    text = str(value or "").strip().lower()
    if not text:
        return fallback
    if re.fullmatch(r"#[0-9a-f]{3}", text) or re.fullmatch(r"#[0-9a-f]{6}", text):
        return text
    if text in {"black", "white", "red", "green", "blue"}:
        mapping = {
            "black": "#000000",
            "white": "#ffffff",
            "red": "#ff0000",
            "green": "#008000",
            "blue": "#0000ff",
        }
        return mapping[text]
    return fallback


def _bbox_overlap_area(a: Dict[str, float], b: Dict[str, float]) -> float:
    x1 = max(a["x"], b["x"])
    y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["width"], b["x"] + b["width"])
    y2 = min(a["y"] + a["height"], b["y"] + b["height"])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return (x2 - x1) * (y2 - y1)


def _slot_id_for_bbox(source_type: str, bbox: Dict[str, float]) -> str:
    x = int(round(bbox["x"]))
    y = int(round(bbox["y"]))
    w = int(round(bbox["width"]))
    h = int(round(bbox["height"]))
    return f"slot_{source_type}_{x}_{y}_{w}_{h}"


def detect_secondary_text_slots(
    root: ET.Element,
    clip_paths: Dict[str, Dict[str, float]],
    image_clip_ids: set[str],
    zones: List[Dict[str, float]],
    canvas_width: int,
    canvas_height: int,
    text_zone_y: int,
    text_zone_height: int,
) -> List[Dict[str, Any]]:
    """Detect editable secondary text slots from real text and path-based exports."""
    parent_map = {c: p for p in root.iter() for c in p}
    title_zone = {
        "x": 0.0,
        "y": float(text_zone_y),
        "width": float(canvas_width),
        "height": float(text_zone_height),
    }
    canvas_area = float(canvas_width * canvas_height)
    candidates: list[Dict[str, Any]] = []

    # 1) Native text nodes.
    for elem in root.iter():
        if not elem.tag.endswith("text"):
            continue
        content = _extract_text_node_content(elem)
        if not content:
            continue

        font_size = max(10.0, _coerce_float(elem.get("font-size"), 16.0))
        x = _coerce_float(elem.get("x"), 0.0)
        y = _coerce_float(elem.get("y"), 0.0)
        est_width = max(20.0, min(float(canvas_width), len(content) * font_size * 0.58))
        est_height = max(14.0, font_size * 1.35)
        bbox = {"x": x, "y": y - est_height, "width": est_width, "height": est_height}

        total_transform = accumulate_element_transform(elem, parent_map, root)
        transformed = apply_bbox_transform(bbox, total_transform)
        clamped = clamp_bbox_to_canvas(transformed, canvas_width, canvas_height)
        if not clamped:
            continue

        # Keep slots outside main generated title area.
        overlap = _bbox_overlap_area(clamped, title_zone)
        if overlap > 0 and overlap / max(1.0, clamped["width"] * clamped["height"]) > 0.45:
            continue

        fill = _normalize_hex_color(elem.get("fill"), "#000000")
        text_anchor = (elem.get("text-anchor") or "start").strip().lower()
        align = "left"
        if text_anchor == "middle":
            align = "center"
        elif text_anchor == "end":
            align = "right"

        candidates.append(
            {
                "source_type": "text",
                "x": clamped["x"],
                "y": clamped["y"],
                "width": clamped["width"],
                "height": clamped["height"],
                "default_text": content,
                "text_align": align,
                "text_color": fill,
            }
        )

    # 2) Path-based text blocks (Canva-like exports with outlined glyphs).
    for elem in root.iter():
        cp_attr = elem.get("clip-path")
        if not cp_attr:
            continue
        match = re.search(r"url\(#([^)]+)\)", cp_attr)
        if not match:
            continue
        cp_id = match.group(1)
        if cp_id in image_clip_ids:
            continue
        bbox = clip_paths.get(cp_id)
        if not bbox:
            continue
        area = bbox["width"] * bbox["height"]
        if area < 300 or area > (canvas_area * 0.7):
            continue

        has_path = any(child.tag.endswith("path") for child in elem.iter())
        has_image = any(child.tag.endswith("image") for child in elem.iter())
        if not has_path or has_image:
            continue

        transform = accumulate_element_transform(elem, parent_map, root)
        transformed = apply_bbox_transform(bbox, transform)
        clamped = clamp_bbox_to_canvas(transformed, canvas_width, canvas_height)
        if not clamped:
            continue
        if clamped["width"] < 30 or clamped["height"] < 12:
            continue
        if clamped["width"] < (clamped["height"] * 1.2):
            continue

        # Ignore main title placeholder area; keep top/bottom badges and secondary blocks.
        overlap = _bbox_overlap_area(clamped, title_zone)
        if overlap > 0 and overlap / max(1.0, clamped["width"] * clamped["height"]) > 0.45:
            continue

        fill = elem.get("fill")
        if not fill:
            for child in elem.iter():
                if child.get("fill") and child.get("fill") != "none":
                    fill = child.get("fill")
                    break

        candidates.append(
            {
                "source_type": "path",
                "x": clamped["x"],
                "y": clamped["y"],
                "width": clamped["width"],
                "height": clamped["height"],
                "default_text": "",
                "text_align": "center",
                "text_color": _normalize_hex_color(fill, "#000000"),
            }
        )

    # De-duplicate near-identical candidates using overlap ratio.
    deduped: list[Dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda c: c["width"] * c["height"], reverse=True):
        candidate_bbox = {
            "x": candidate["x"],
            "y": candidate["y"],
            "width": candidate["width"],
            "height": candidate["height"],
        }
        candidate_area = max(1.0, candidate_bbox["width"] * candidate_bbox["height"])
        duplicate = False
        for kept in deduped:
            kept_bbox = {
                "x": kept["x"],
                "y": kept["y"],
                "width": kept["width"],
                "height": kept["height"],
            }
            kept_area = max(1.0, kept_bbox["width"] * kept_bbox["height"])
            overlap = _bbox_overlap_area(candidate_bbox, kept_bbox)
            ratio = overlap / min(candidate_area, kept_area)
            if ratio >= 0.92:
                duplicate = True
                break
        if duplicate:
            continue
        deduped.append(candidate)
    deduped.sort(key=lambda c: (c["y"], c["x"]))

    # Build stable slot schema used by template parameters UI / renderer.
    slots: list[Dict[str, Any]] = []
    used_ids: set[str] = set()
    for candidate in deduped:
        bbox = {
            "x": candidate["x"],
            "y": candidate["y"],
            "width": candidate["width"],
            "height": candidate["height"],
        }
        slot_id = _slot_id_for_bbox(candidate["source_type"], bbox)
        if slot_id in used_ids:
            suffix = 2
            while f"{slot_id}_{suffix}" in used_ids:
                suffix += 1
            slot_id = f"{slot_id}_{suffix}"
        used_ids.add(slot_id)

        suggested_font_size = int(max(12, min(96, round(candidate["height"] * 0.44))))
        slots.append(
            {
                "slot_id": slot_id,
                "label": f"Secondary Text {len(slots) + 1}",
                "source_type": candidate["source_type"],
                "x": int(round(candidate["x"])),
                "y": int(round(candidate["y"])),
                "width": int(round(candidate["width"])),
                "height": int(round(candidate["height"])),
                "enabled": True,
                "mask_original": True,
                "text_align": candidate["text_align"],
                "font_family": '"Poppins", "Segoe UI", Arial, sans-serif',
                "font_weight": "700",
                "font_size": suggested_font_size,
                "text_color": candidate["text_color"],
                "text_effect": "none",
                "text_effect_color": "#000000",
                "text_effect_offset_x": 2,
                "text_effect_offset_y": 2,
                "text_effect_blur": 0,
                "max_lines": 2,
                "uppercase": False,
                "default_text": candidate.get("default_text", ""),
            }
        )

    return slots


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
    2. Large background rects extending beyond canvas

    Keeps text/path layers so template parameters can selectively mask/edit
    secondary copy at render time.
    """
    try:
        root = ET.fromstring(svg_content)
    except ET.ParseError as e:
        logger.warning(f"Failed to parse SVG for placeholder removal: {e}, falling back to regex")
        return _strip_placeholders_fallback(svg_content)

    result = ET.tostring(root, encoding='unicode')
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
