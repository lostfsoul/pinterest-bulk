"""Detection-first template pipeline helpers.

This module provides a practical SVG detection flow for Pinterest templates where
text may exist as native <text>, outlined paths, or baked regions.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
import base64
import json
import logging
import math
import re
import xml.etree.ElementTree as ET
from typing import Any

logger = logging.getLogger(__name__)


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _int(value: Any, default: int = 0, minimum: int | None = None) -> int:
    parsed = int(round(_float(value, default)))
    if minimum is not None:
        return max(minimum, parsed)
    return parsed


def _sanitize_id(value: Any, prefix: str, index: int) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_:-]+", "_", str(value or "").strip())
    if cleaned:
        return cleaned
    return f"{prefix}_{index + 1}"


def _hex(value: Any, fallback: str) -> str:
    raw = str(value or "").strip().lower()
    if re.fullmatch(r"#[0-9a-f]{3}", raw) or re.fullmatch(r"#[0-9a-f]{6}", raw):
        return raw
    return fallback


def _normalize_align(value: Any, fallback: str = "center") -> str:
    raw = str(value or fallback).strip().lower()
    if raw in {"left", "center", "right"}:
        return raw
    return fallback


def _normalize_source_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"svg_text", "ocr_image", "vector_path_cluster", "svg_image"}:
        return raw
    return "ocr_image"


def _normalize_zone_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"main_text", "secondary_text", "image"}:
        return raw
    return "secondary_text"


@dataclass
class CandidateRegion:
    candidate_id: str
    source_type: str
    bounds: dict[str, int]
    text_hint: str
    confidence: float


def extract_canvas_size(root: ET.Element) -> tuple[int, int]:
    view_box = root.get("viewBox")
    if view_box:
        parts = [p for p in re.split(r"[\s,]+", view_box.strip()) if p]
        if len(parts) >= 4:
            w = _int(parts[2], 750, minimum=1)
            h = _int(parts[3], 1575, minimum=1)
            return w, h

    width = _int(root.get("width"), 750, minimum=1)
    height = _int(root.get("height"), 1575, minimum=1)
    return width, height


def parse_clip_paths(root: ET.Element) -> dict[str, dict[str, float]]:
    clip_paths: dict[str, dict[str, float]] = {}

    for clip_path in root.iter():
        if not str(clip_path.tag).endswith("clipPath"):
            continue
        cp_id = clip_path.get("id")
        if not cp_id:
            continue

        rect = clip_path.find('.//{http://www.w3.org/2000/svg}rect')
        if rect is not None:
            x = _float(rect.get("x"), 0)
            y = _float(rect.get("y"), 0)
            w = _float(rect.get("width"), 0)
            h = _float(rect.get("height"), 0)
            if w > 1 and h > 1:
                clip_paths[cp_id] = {"x": x, "y": y, "width": w, "height": h}
                continue

        path = clip_path.find('.//{http://www.w3.org/2000/svg}path')
        if path is None:
            continue
        d = path.get("d") or ""
        numbers = [float(n) for n in re.findall(r"-?\d+\.?\d*", d)]
        if len(numbers) < 4:
            continue
        xs = numbers[0::2]
        ys = numbers[1::2]
        x = min(xs)
        y = min(ys)
        w = max(xs) - x
        h = max(ys) - y
        if w > 1 and h > 1:
            clip_paths[cp_id] = {"x": x, "y": y, "width": w, "height": h}

    return clip_paths


def _collect_text_content(elem: ET.Element) -> str:
    parts: list[str] = []
    if elem.text:
        parts.append(elem.text)
    for child in elem.iter():
        if child is elem:
            continue
        if child.text:
            parts.append(child.text)
    return re.sub(r"\s+", " ", " ".join(part.strip() for part in parts if part and part.strip())).strip()


def _bbox_from_path_d(path_data: str) -> dict[str, float] | None:
    numbers = [float(n) for n in re.findall(r"-?\d+\.?\d*", path_data or "")]
    if len(numbers) < 4:
        return None
    xs = numbers[0::2]
    ys = numbers[1::2]
    if not xs or not ys:
        return None
    x = min(xs)
    y = min(ys)
    width = max(xs) - x
    height = max(ys) - y
    if width <= 1 or height <= 1:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _bounds_union(bounds: list[dict[str, float]]) -> dict[str, int] | None:
    if not bounds:
        return None
    x = min(item["x"] for item in bounds)
    y = min(item["y"] for item in bounds)
    right = max(item["x"] + item["width"] for item in bounds)
    bottom = max(item["y"] + item["height"] for item in bounds)
    width = right - x
    height = bottom - y
    if width <= 1 or height <= 1:
        return None
    return {
        "x": _int(x, 0),
        "y": _int(y, 0),
        "width": _int(width, 1, minimum=1),
        "height": _int(height, 1, minimum=1),
    }


def _group_path_bounds(group: ET.Element) -> dict[str, int] | None:
    path_boxes: list[dict[str, float]] = []
    for path in group.iter():
        if not str(path.tag).endswith("path"):
            continue
        bbox = _bbox_from_path_d(path.get("d") or "")
        if bbox:
            path_boxes.append(bbox)
    return _bounds_union(path_boxes)


def _intersects(a: dict[str, int], b: dict[str, int]) -> bool:
    return not (
        (a["x"] + a["width"]) < b["x"]
        or (b["x"] + b["width"]) < a["x"]
        or (a["y"] + a["height"]) < b["y"]
        or (b["y"] + b["height"]) < a["y"]
    )


def parse_svg_structure(svg_content: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(svg_content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid SVG: {exc}") from exc

    width, height = extract_canvas_size(root)
    clip_paths = parse_clip_paths(root)

    image_assets: list[dict[str, Any]] = []
    image_candidates: list[CandidateRegion] = []
    text_candidates: list[CandidateRegion] = []
    vector_candidates: list[CandidateRegion] = []
    group_candidates: list[CandidateRegion] = []

    for index, elem in enumerate(root.iter()):
        tag = str(elem.tag)

        if tag.endswith("image"):
            x = _int(elem.get("x"), 0)
            y = _int(elem.get("y"), 0)
            w = _int(elem.get("width"), 0, minimum=1)
            h = _int(elem.get("height"), 0, minimum=1)
            if w < 8 or h < 8:
                continue
            href = (
                elem.get("href")
                or elem.get("{http://www.w3.org/1999/xlink}href")
                or ""
            )
            asset_id = _sanitize_id(elem.get("id"), "img", len(image_assets))
            image_assets.append(
                {
                    "id": asset_id,
                    "type": "image",
                    "bounds": {"x": x, "y": y, "width": w, "height": h},
                    "href": href,
                }
            )
            image_candidates.append(
                CandidateRegion(
                    candidate_id=f"candidate_image_{len(image_candidates) + 1}",
                    source_type="svg_image",
                    bounds={"x": x, "y": y, "width": w, "height": h},
                    text_hint="",
                    confidence=1.0,
                )
            )
            continue

        if tag.endswith("text"):
            text = _collect_text_content(elem)
            if not text:
                continue
            font_size = _float(elem.get("font-size"), 24)
            x = _int(elem.get("x"), 0)
            y = _int(elem.get("y"), 0)
            est_w = _int(min(width, max(40, len(text) * font_size * 0.62)), 80, minimum=8)
            est_h = _int(max(16, font_size * 1.4), 30, minimum=8)
            text_candidates.append(
                CandidateRegion(
                    candidate_id=f"candidate_text_{len(text_candidates) + 1}",
                    source_type="svg_text",
                    bounds={
                        "x": max(0, x),
                        "y": max(0, y - est_h),
                        "width": est_w,
                        "height": est_h,
                    },
                    text_hint=text,
                    confidence=0.98,
                )
            )
            continue

        cp_attr = elem.get("clip-path")
        if not cp_attr:
            continue
        match = re.search(r"url\(#([^)]+)\)", cp_attr)
        if not match:
            continue
        cp_id = match.group(1)
        bbox = clip_paths.get(cp_id)
        if not bbox:
            continue

        area = bbox["width"] * bbox["height"]
        canvas_area = float(width * height)
        if area < 350 or area > canvas_area * 0.8:
            continue
        has_path = any(str(child.tag).endswith("path") for child in elem.iter())
        has_image = any(str(child.tag).endswith("image") for child in elem.iter())
        if not has_path or has_image:
            continue

        rounded = {
            "x": _int(bbox["x"], 0),
            "y": _int(bbox["y"], 0),
            "width": _int(bbox["width"], 1, minimum=1),
            "height": _int(bbox["height"], 1, minimum=1),
        }
        if rounded["width"] < 20 or rounded["height"] < 12:
            continue

        vector_candidates.append(
            CandidateRegion(
                candidate_id=f"candidate_vector_{len(vector_candidates) + 1}",
                source_type="vector_path_cluster",
                bounds=rounded,
                text_hint="",
                confidence=0.45,
            )
        )

    # Group-level path clusters catch templates that have outlined text wrapped in <g>.
    image_bounds = [asset.get("bounds") for asset in image_assets if isinstance(asset, dict) and isinstance(asset.get("bounds"), dict)]
    for group in root.iter():
        if not str(group.tag).endswith("g"):
            continue
        if any(str(child.tag).endswith("image") for child in group.iter()):
            continue
        bbox = _group_path_bounds(group)
        if not bbox:
            continue
        area = bbox["width"] * bbox["height"]
        canvas_area = float(width * height)
        if area < 600 or area > canvas_area * 0.72:
            continue
        if bbox["width"] < 24 or bbox["height"] < 14:
            continue
        if any(_intersects(bbox, ib) for ib in image_bounds):
            # Skip obvious image overlaps to avoid classifying photo regions as text.
            continue
        group_candidates.append(
            CandidateRegion(
                candidate_id=f"candidate_group_{len(group_candidates) + 1}",
                source_type="vector_path_cluster",
                bounds=bbox,
                text_hint="",
                confidence=0.4,
            )
        )

    # Deduplicate vector candidates by near-identical bounding boxes.
    seen_keys: set[tuple[int, int, int, int]] = set()
    deduped_vectors: list[CandidateRegion] = []
    for candidate in vector_candidates:
        b = candidate.bounds
        key = (b["x"], b["y"], b["width"], b["height"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped_vectors.append(candidate)

    all_text_like = [*text_candidates, *deduped_vectors, *group_candidates]

    return {
        "canvas": {"width": width, "height": height},
        "image_assets": image_assets,
        "image_candidates": [
            {
                "candidate_id": c.candidate_id,
                "source_type": c.source_type,
                "bounds": c.bounds,
                "text_hint": c.text_hint,
                "confidence": c.confidence,
            }
            for c in image_candidates
        ],
        "text_candidates": [
            {
                "candidate_id": c.candidate_id,
                "source_type": c.source_type,
                "bounds": c.bounds,
                "text_hint": c.text_hint,
                "confidence": c.confidence,
            }
            for c in all_text_like
        ],
    }


def render_candidate_crops(svg_content: str, structure: dict[str, Any], max_regions: int = 10) -> dict[str, str]:
    """Rasterize candidate regions and return crop PNG data URLs keyed by candidate id."""
    candidates = list(structure.get("text_candidates") or [])
    if not candidates:
        return {}

    try:
        import cairosvg  # type: ignore
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - dependency availability by env
        logger.warning("Raster crop dependencies unavailable: %s", exc)
        return {}

    try:
        png_bytes = cairosvg.svg2png(bytestring=svg_content.encode("utf-8"))
        base_image = Image.open(BytesIO(png_bytes)).convert("RGBA")
    except Exception as exc:
        logger.warning("Failed to rasterize SVG for candidate crops: %s", exc)
        return {}

    canvas = structure.get("canvas") or {}
    source_w = max(1, _int(canvas.get("width"), base_image.width, minimum=1))
    source_h = max(1, _int(canvas.get("height"), base_image.height, minimum=1))
    scale_x = base_image.width / source_w
    scale_y = base_image.height / source_h

    crops: dict[str, str] = {}
    for candidate in candidates[:max_regions]:
        bounds = candidate.get("bounds") if isinstance(candidate, dict) else None
        if not isinstance(bounds, dict):
            continue

        x = max(0, _int(bounds.get("x"), 0))
        y = max(0, _int(bounds.get("y"), 0))
        w = max(1, _int(bounds.get("width"), 1, minimum=1))
        h = max(1, _int(bounds.get("height"), 1, minimum=1))

        # Expand crop area to improve OCR context.
        pad_x = max(8, int(round(w * 0.08)))
        pad_y = max(6, int(round(h * 0.2)))
        left = max(0, int(round((x - pad_x) * scale_x)))
        top = max(0, int(round((y - pad_y) * scale_y)))
        right = min(base_image.width, int(round((x + w + pad_x) * scale_x)))
        bottom = min(base_image.height, int(round((y + h + pad_y) * scale_y)))

        if right <= left + 2 or bottom <= top + 2:
            continue

        crop = base_image.crop((left, top, right, bottom))
        buffer = BytesIO()
        crop.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        candidate_id = str(candidate.get("candidate_id") or "").strip()
        if candidate_id:
            crops[candidate_id] = f"data:image/png;base64,{encoded}"

    return crops


def _candidate_score(
    candidate: dict[str, Any],
    text: str,
    confidence: float,
    canvas_w: int,
    canvas_h: int,
) -> float:
    bounds = candidate.get("bounds") if isinstance(candidate, dict) else {}
    x = _float(bounds.get("x"), 0)
    y = _float(bounds.get("y"), 0)
    w = max(1.0, _float(bounds.get("width"), 1))
    h = max(1.0, _float(bounds.get("height"), 1))

    area = w * h
    canvas_area = float(max(1, canvas_w * canvas_h))
    area_score = min(1.0, area / (canvas_area * 0.22))

    center_x = x + (w / 2)
    center_y = y + (h / 2)
    center_dx = abs(center_x - (canvas_w / 2)) / max(1.0, canvas_w / 2)
    center_score = 1.0 - min(1.0, center_dx)
    top_score = 1.0 - min(1.0, center_y / max(1.0, canvas_h))
    text_score = min(1.0, len(text) / 48) if text else 0.15

    return (area_score * 0.35) + (center_score * 0.2) + (top_score * 0.25) + (text_score * 0.1) + (confidence * 0.1)


def classify_main_secondary(
    structure: dict[str, Any],
    ocr_results: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    ocr_results = ocr_results or {}
    candidates = list(structure.get("text_candidates") or [])
    canvas = structure.get("canvas") or {}
    canvas_w = max(1, _int(canvas.get("width"), 750, minimum=1))
    canvas_h = max(1, _int(canvas.get("height"), 1575, minimum=1))

    if not candidates:
        return None, None

    scored: list[tuple[float, dict[str, Any], str, float]] = []
    for candidate in candidates:
        candidate_id = str(candidate.get("candidate_id") or "")
        ocr_entry = ocr_results.get(candidate_id) or {}
        ocr_text = str(ocr_entry.get("text") or "").strip()
        text = ocr_text or str(candidate.get("text_hint") or "").strip()
        confidence = float(ocr_entry.get("confidence") or candidate.get("confidence") or 0.35)
        confidence = max(0.0, min(1.0, confidence))
        score = _candidate_score(candidate, text, confidence, canvas_w, canvas_h)
        scored.append((score, candidate, text, confidence))

    scored.sort(key=lambda item: item[0], reverse=True)
    main = scored[0]

    secondary: tuple[float, dict[str, Any], str, float] | None = None
    main_bounds = main[1].get("bounds") or {}
    main_center_y = _float(main_bounds.get("y"), 0) + (_float(main_bounds.get("height"), 1) / 2)
    main_area = max(1.0, _float(main_bounds.get("width"), 1) * _float(main_bounds.get("height"), 1))

    for item in scored[1:]:
        bounds = item[1].get("bounds") or {}
        center_y = _float(bounds.get("y"), 0) + (_float(bounds.get("height"), 1) / 2)
        area = max(1.0, _float(bounds.get("width"), 1) * _float(bounds.get("height"), 1))
        proximity = abs(center_y - main_center_y) / max(1.0, canvas_h)
        area_ratio = area / main_area

        # Prefer smaller text near the main block (often subheadline).
        secondary_score = item[0] + (0.18 if area_ratio < 0.95 else -0.12) + (0.12 if proximity < 0.22 else -0.08)
        if secondary is None or secondary_score > secondary[0]:
            secondary = (secondary_score, item[1], item[2], item[3])

    main_payload = {
        "candidate": main[1],
        "text": main[2],
        "confidence": main[3],
    }
    secondary_payload = None
    if secondary is not None:
        secondary_payload = {
            "candidate": secondary[1],
            "text": secondary[2],
            "confidence": secondary[3],
        }

    return main_payload, secondary_payload


def _default_style_for_zone(zone_type: str, bounds: dict[str, Any]) -> dict[str, Any]:
    height = max(1, _int(bounds.get("height"), 40, minimum=1))
    default_size = 24 if zone_type == "secondary_text" else 48
    computed = max(12, min(140, int(round(height * (0.45 if zone_type == "secondary_text" else 0.58)))))
    return {
        "font_family": '"Poppins", "Segoe UI", Arial, sans-serif',
        "font_size": computed if computed > 0 else default_size,
        "font_weight": 700,
        "fill": "#111111",
        "align": "center",
        "font_file": None,
    }


def build_manifest_v2(
    structure: dict[str, Any],
    ocr_results: dict[str, dict[str, Any]] | None = None,
    previous_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    canvas = structure.get("canvas") or {}
    width = max(1, _int(canvas.get("width"), 750, minimum=1))
    height = max(1, _int(canvas.get("height"), 1575, minimum=1))

    main_payload, secondary_payload = classify_main_secondary(structure, ocr_results)
    previous_manifest = previous_manifest or {}
    previous_zones = previous_manifest.get("zones") if isinstance(previous_manifest, dict) else None
    previous_zone_map: dict[str, dict[str, Any]] = {}
    if isinstance(previous_zones, list):
        for zone in previous_zones:
            if isinstance(zone, dict):
                previous_zone_map[str(zone.get("type") or "").strip()] = zone

    zones: list[dict[str, Any]] = []

    if main_payload:
        candidate = main_payload["candidate"]
        bounds = dict(candidate.get("bounds") or {})
        text = str(main_payload.get("text") or "").strip()
        prev = previous_zone_map.get("main_text", {})
        prev_style = prev.get("style") if isinstance(prev, dict) else {}
        prev_replacement = prev.get("replacement") if isinstance(prev, dict) else {}
        style = {
            **_default_style_for_zone("main_text", bounds),
            **(prev_style if isinstance(prev_style, dict) else {}),
        }
        replacement_text = str((prev_replacement or {}).get("text") or text)
        replacement_font = str((prev_replacement or {}).get("font_family") or style.get("font_family") or "")
        replacement_font_file = str((prev_replacement or {}).get("font_file") or style.get("font_file") or "").strip() or None
        zones.append(
            {
                "id": "zone_main_1",
                "type": "main_text",
                "source_type": _normalize_source_type(candidate.get("source_type")),
                "editable": True,
                "confidence": max(0.0, min(1.0, float(main_payload.get("confidence") or 0.0))),
                "bounds": {
                    "x": _int(bounds.get("x"), 0),
                    "y": _int(bounds.get("y"), 0),
                    "width": _int(bounds.get("width"), width, minimum=1),
                    "height": _int(bounds.get("height"), max(30, int(height * 0.12)), minimum=1),
                },
                "text": text,
                "style": {
                    "font_family": str(style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                    "font_size": _int(style.get("font_size"), 48, minimum=8),
                    "font_weight": _int(style.get("font_weight"), 700, minimum=100),
                    "fill": _hex(style.get("fill"), "#111111"),
                    "align": _normalize_align(style.get("align"), "center"),
                    "font_file": str(style.get("font_file") or "").strip() or None,
                },
                "replacement": {
                    "text": replacement_text,
                    "font_family": replacement_font or '"Poppins", "Segoe UI", Arial, sans-serif',
                    "font_file": replacement_font_file,
                },
            }
        )

    if secondary_payload:
        candidate = secondary_payload["candidate"]
        bounds = dict(candidate.get("bounds") or {})
        text = str(secondary_payload.get("text") or "").strip()
        prev = previous_zone_map.get("secondary_text", {})
        prev_style = prev.get("style") if isinstance(prev, dict) else {}
        prev_replacement = prev.get("replacement") if isinstance(prev, dict) else {}
        style = {
            **_default_style_for_zone("secondary_text", bounds),
            **(prev_style if isinstance(prev_style, dict) else {}),
        }
        replacement_text = str((prev_replacement or {}).get("text") or text)
        replacement_font = str((prev_replacement or {}).get("font_family") or style.get("font_family") or "")
        replacement_font_file = str((prev_replacement or {}).get("font_file") or style.get("font_file") or "").strip() or None
        zones.append(
            {
                "id": "zone_secondary_1",
                "type": "secondary_text",
                "source_type": _normalize_source_type(candidate.get("source_type")),
                "editable": True,
                "confidence": max(0.0, min(1.0, float(secondary_payload.get("confidence") or 0.0))),
                "bounds": {
                    "x": _int(bounds.get("x"), 0),
                    "y": _int(bounds.get("y"), 0),
                    "width": _int(bounds.get("width"), max(40, int(width * 0.4)), minimum=1),
                    "height": _int(bounds.get("height"), max(20, int(height * 0.06)), minimum=1),
                },
                "text": text,
                "style": {
                    "font_family": str(style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                    "font_size": _int(style.get("font_size"), 24, minimum=8),
                    "font_weight": _int(style.get("font_weight"), 700, minimum=100),
                    "fill": _hex(style.get("fill"), "#111111"),
                    "align": _normalize_align(style.get("align"), "center"),
                    "font_file": str(style.get("font_file") or "").strip() or None,
                },
                "replacement": {
                    "text": replacement_text,
                    "font_family": replacement_font or '"Poppins", "Segoe UI", Arial, sans-serif',
                    "font_file": replacement_font_file,
                },
            }
        )

    image_assets = structure.get("image_assets") if isinstance(structure.get("image_assets"), list) else []
    for index, asset in enumerate(image_assets):
        if not isinstance(asset, dict):
            continue
        bounds = asset.get("bounds") if isinstance(asset.get("bounds"), dict) else {}
        zones.append(
            {
                "id": _sanitize_id(asset.get("id"), "zone_image", index),
                "type": "image",
                "source_type": "svg_image",
                "editable": False,
                "confidence": 1.0,
                "bounds": {
                    "x": _int(bounds.get("x"), 0),
                    "y": _int(bounds.get("y"), 0),
                    "width": _int(bounds.get("width"), max(1, int(width * 0.3)), minimum=1),
                    "height": _int(bounds.get("height"), max(1, int(height * 0.3)), minimum=1),
                },
            }
        )

    needs_review = any(
        zone.get("editable") and float(zone.get("confidence") or 0.0) < 0.55
        for zone in zones
        if isinstance(zone, dict)
    )

    manifest = {
        "version": 2,
        "canvas": {
            "source_width": width,
            "source_height": height,
            "target_width": width,
            "target_height": height,
        },
        "zones": zones,
        "assets": image_assets,
        "meta": {
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "needs_review": needs_review,
            "strategy": "detection-first",
        },
    }
    return normalize_manifest_v2(manifest)


def normalize_manifest_v2(manifest: dict[str, Any]) -> dict[str, Any]:
    raw = manifest if isinstance(manifest, dict) else {}
    canvas_raw = raw.get("canvas") if isinstance(raw.get("canvas"), dict) else {}
    canvas = {
        "source_width": _int(canvas_raw.get("source_width"), 750, minimum=1),
        "source_height": _int(canvas_raw.get("source_height"), 1575, minimum=1),
        "target_width": _int(canvas_raw.get("target_width"), _int(canvas_raw.get("source_width"), 750, minimum=1), minimum=1),
        "target_height": _int(canvas_raw.get("target_height"), _int(canvas_raw.get("source_height"), 1575, minimum=1), minimum=1),
    }

    zones: list[dict[str, Any]] = []
    for index, item in enumerate(raw.get("zones") if isinstance(raw.get("zones"), list) else []):
        if not isinstance(item, dict):
            continue
        zone_type = _normalize_zone_type(item.get("type"))
        bounds_raw = item.get("bounds") if isinstance(item.get("bounds"), dict) else {}
        zone = {
            "id": _sanitize_id(item.get("id"), "zone", index),
            "type": zone_type,
            "source_type": _normalize_source_type(item.get("source_type")),
            "editable": bool(item.get("editable", zone_type != "image")),
            "confidence": max(0.0, min(1.0, float(item.get("confidence") or 0.0))),
            "bounds": {
                "x": _int(bounds_raw.get("x"), 0),
                "y": _int(bounds_raw.get("y"), 0),
                "width": _int(bounds_raw.get("width"), 1, minimum=1),
                "height": _int(bounds_raw.get("height"), 1, minimum=1),
            },
        }

        if zone_type != "image":
            style_raw = item.get("style") if isinstance(item.get("style"), dict) else {}
            replacement_raw = item.get("replacement") if isinstance(item.get("replacement"), dict) else {}
            zone["text"] = str(item.get("text") or "")
            zone["style"] = {
                "font_family": str(style_raw.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                "font_size": _int(style_raw.get("font_size"), 24, minimum=8),
                "font_weight": _int(style_raw.get("font_weight"), 700, minimum=100),
                "fill": _hex(style_raw.get("fill"), "#111111"),
                "align": _normalize_align(style_raw.get("align"), "center"),
                "font_file": str(style_raw.get("font_file") or "").strip() or None,
            }
            zone["replacement"] = {
                "text": str(replacement_raw.get("text") if replacement_raw.get("text") is not None else zone["text"]),
                "font_family": str(replacement_raw.get("font_family") or zone["style"]["font_family"]),
                "font_file": str(replacement_raw.get("font_file") or zone["style"]["font_file"] or "").strip() or None,
            }

        zones.append(zone)

    assets_raw = raw.get("assets") if isinstance(raw.get("assets"), list) else []
    assets: list[dict[str, Any]] = []
    for index, asset in enumerate(assets_raw):
        if not isinstance(asset, dict):
            continue
        bounds_raw = asset.get("bounds") if isinstance(asset.get("bounds"), dict) else {}
        assets.append(
            {
                "id": _sanitize_id(asset.get("id"), "asset", index),
                "type": "image",
                "bounds": {
                    "x": _int(bounds_raw.get("x"), 0),
                    "y": _int(bounds_raw.get("y"), 0),
                    "width": _int(bounds_raw.get("width"), 1, minimum=1),
                    "height": _int(bounds_raw.get("height"), 1, minimum=1),
                },
                "href": str(asset.get("href") or ""),
            }
        )

    meta_raw = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    meta = {
        "detected_at": str(meta_raw.get("detected_at") or datetime.now(timezone.utc).isoformat()),
        "needs_review": bool(meta_raw.get("needs_review", False)),
        "strategy": str(meta_raw.get("strategy") or "detection-first"),
    }

    return {
        "version": 2,
        "canvas": canvas,
        "zones": zones,
        "assets": assets,
        "meta": meta,
    }


def migrate_manifest_to_v2(
    existing_manifest: dict[str, Any] | None,
    structure: dict[str, Any],
) -> dict[str, Any]:
    if isinstance(existing_manifest, dict) and _int(existing_manifest.get("version"), 0) == 2:
        return normalize_manifest_v2(existing_manifest)

    # Convert previous single-svg manifest shape (image_slots/title_zone/secondary_text_slots).
    if isinstance(existing_manifest, dict) and (
        "image_slots" in existing_manifest or "title_zone" in existing_manifest or "secondary_text_slots" in existing_manifest
    ):
        text_style = existing_manifest.get("text_style") if isinstance(existing_manifest.get("text_style"), dict) else {}
        zones: list[dict[str, Any]] = []

        title = existing_manifest.get("title_zone") if isinstance(existing_manifest.get("title_zone"), dict) else {}
        if title:
            zones.append(
                {
                    "id": "zone_main_1",
                    "type": "main_text",
                    "source_type": "vector_path_cluster",
                    "editable": True,
                    "confidence": 0.7,
                    "bounds": {
                        "x": _int(title.get("x"), 0),
                        "y": _int(title.get("y"), 0),
                        "width": _int(title.get("width"), _int(structure.get("canvas", {}).get("width"), 750), minimum=1),
                        "height": _int(title.get("height"), 120, minimum=1),
                    },
                    "text": "",
                    "style": {
                        "font_family": str(text_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                        "font_size": _int(text_style.get("font_size"), 48, minimum=8),
                        "font_weight": _int(text_style.get("font_weight"), 700, minimum=100),
                        "fill": _hex(text_style.get("text_color"), "#111111"),
                        "align": _normalize_align(text_style.get("text_align"), "center"),
                        "font_file": str(text_style.get("custom_font_file") or "").strip() or None,
                    },
                    "replacement": {
                        "text": "",
                        "font_family": str(text_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                        "font_file": str(text_style.get("custom_font_file") or "").strip() or None,
                    },
                }
            )

        secondary_slots = existing_manifest.get("secondary_text_slots") if isinstance(existing_manifest.get("secondary_text_slots"), list) else []
        secondary_defaults = existing_manifest.get("secondary_text_defaults") if isinstance(existing_manifest.get("secondary_text_defaults"), dict) else {}
        for index, slot in enumerate(secondary_slots):
            if not isinstance(slot, dict):
                continue
            slot_id = _sanitize_id(slot.get("slot_id"), "zone_secondary", index)
            zones.append(
                {
                    "id": slot_id,
                    "type": "secondary_text",
                    "source_type": _normalize_source_type(slot.get("source_type") or "vector_path_cluster"),
                    "editable": bool(slot.get("enabled", True)),
                    "confidence": 0.62,
                    "bounds": {
                        "x": _int(slot.get("x"), 0),
                        "y": _int(slot.get("y"), 0),
                        "width": _int(slot.get("width"), 60, minimum=1),
                        "height": _int(slot.get("height"), 20, minimum=1),
                    },
                    "text": str(secondary_defaults.get(slot_id) or slot.get("default_text") or ""),
                    "style": {
                        "font_family": str(slot.get("font_family") or text_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                        "font_size": _int(slot.get("font_size"), 24, minimum=8),
                        "font_weight": _int(slot.get("font_weight"), 700, minimum=100),
                        "fill": _hex(slot.get("text_color"), "#111111"),
                        "align": _normalize_align(slot.get("text_align"), "center"),
                        "font_file": str(slot.get("custom_font_file") or "").strip() or None,
                    },
                    "replacement": {
                        "text": str(secondary_defaults.get(slot_id) or slot.get("default_text") or ""),
                        "font_family": str(slot.get("custom_font_file") or slot.get("font_family") or text_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                        "font_file": str(slot.get("custom_font_file") or "").strip() or None,
                    },
                }
            )

        image_slots = existing_manifest.get("image_slots") if isinstance(existing_manifest.get("image_slots"), list) else []
        for index, slot in enumerate(image_slots):
            if not isinstance(slot, dict):
                continue
            zones.append(
                {
                    "id": _sanitize_id(slot.get("slot_id"), "zone_image", index),
                    "type": "image",
                    "source_type": "svg_image",
                    "editable": False,
                    "confidence": 1.0,
                    "bounds": {
                        "x": _int(slot.get("x"), 0),
                        "y": _int(slot.get("y"), 0),
                        "width": _int(slot.get("width"), 100, minimum=1),
                        "height": _int(slot.get("height"), 100, minimum=1),
                    },
                }
            )

        canvas = structure.get("canvas") if isinstance(structure.get("canvas"), dict) else {}
        migrated = {
            "version": 2,
            "canvas": {
                "source_width": _int(canvas.get("width"), 750, minimum=1),
                "source_height": _int(canvas.get("height"), 1575, minimum=1),
                "target_width": _int(canvas.get("width"), 750, minimum=1),
                "target_height": _int(canvas.get("height"), 1575, minimum=1),
            },
            "zones": zones,
            "assets": structure.get("image_assets") or [],
            "meta": {
                "detected_at": datetime.now(timezone.utc).isoformat(),
                "needs_review": True,
                "strategy": "migrated-v1",
            },
        }
        return normalize_manifest_v2(migrated)

    return build_manifest_v2(structure, ocr_results=None, previous_manifest=None)


def _extract_main_secondary_zones(manifest: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    zones = manifest.get("zones") if isinstance(manifest.get("zones"), list) else []
    main = None
    secondary: list[dict[str, Any]] = []
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        zone_type = str(zone.get("type") or "").strip().lower()
        if zone_type == "main_text" and main is None:
            main = zone
        elif zone_type == "secondary_text":
            secondary.append(zone)
    secondary.sort(key=lambda item: (
        _int((item.get("bounds") or {}).get("y"), 0),
        _int((item.get("bounds") or {}).get("x"), 0),
    ))
    return main, secondary


def project_manifest_v2_to_legacy_zones(manifest: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_manifest_v2(manifest)
    canvas = normalized.get("canvas") if isinstance(normalized.get("canvas"), dict) else {}
    canvas_w = _int(canvas.get("target_width"), _int(canvas.get("source_width"), 750, minimum=1), minimum=1)
    canvas_h = _int(canvas.get("target_height"), _int(canvas.get("source_height"), 1575, minimum=1), minimum=1)

    zones = normalized.get("zones") if isinstance(normalized.get("zones"), list) else []
    image_zones: list[dict[str, Any]] = []
    for idx, zone in enumerate(zones):
        if not isinstance(zone, dict):
            continue
        if str(zone.get("type") or "").strip().lower() != "image":
            continue
        b = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
        image_zones.append(
            {
                "zone_index": idx,
                "x": _int(b.get("x"), 0),
                "y": _int(b.get("y"), 0),
                "width": _int(b.get("width"), max(1, int(canvas_w * 0.3)), minimum=1),
                "height": _int(b.get("height"), max(1, int(canvas_h * 0.3)), minimum=1),
            }
        )

    main, secondary = _extract_main_secondary_zones(normalized)
    main_bounds = (main or {}).get("bounds") if isinstance((main or {}).get("bounds"), dict) else {}
    main_style = (main or {}).get("style") if isinstance((main or {}).get("style"), dict) else {}
    main_replacement = (main or {}).get("replacement") if isinstance((main or {}).get("replacement"), dict) else {}
    main_font_file = str(main_replacement.get("font_file") or main_style.get("font_file") or "").strip() or None

    if not main_bounds:
        main_bounds = {
            "x": 0,
            "y": int(round(canvas_h * 0.44)),
            "width": canvas_w,
            "height": int(round(canvas_h * 0.12)),
        }

    secondary_slots: list[dict[str, Any]] = []
    secondary_defaults: dict[str, str] = {}
    for idx, zone in enumerate(secondary):
        bounds = zone.get("bounds") if isinstance(zone.get("bounds"), dict) else {}
        style = zone.get("style") if isinstance(zone.get("style"), dict) else {}
        replacement = zone.get("replacement") if isinstance(zone.get("replacement"), dict) else {}
        slot_id = _sanitize_id(zone.get("id"), "slot_secondary", idx)
        secondary_slots.append(
            {
                "slot_id": slot_id,
                "label": f"Secondary Text {idx + 1}",
                "source_type": zone.get("source_type") or "ocr_image",
                "x": _int(bounds.get("x"), 0),
                "y": _int(bounds.get("y"), 0),
                "width": _int(bounds.get("width"), 60, minimum=1),
                "height": _int(bounds.get("height"), 20, minimum=1),
                "enabled": bool(zone.get("editable", True)),
                "mask_original": True,
                "text_align": _normalize_align(style.get("align"), "center"),
                "font_family": str(style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
                "font_weight": str(style.get("font_weight") or "700"),
                "font_size": _int(style.get("font_size"), 24, minimum=8),
                "text_color": _hex(style.get("fill"), "#111111"),
                "text_effect": "none",
                "text_effect_color": "#000000",
                "text_effect_offset_x": 2,
                "text_effect_offset_y": 2,
                "text_effect_blur": 0,
                "max_lines": 2,
                "uppercase": False,
                "default_text": str(zone.get("text") or ""),
                "custom_font_file": str(replacement.get("font_file") or style.get("font_file") or "").strip() or None,
            }
        )
        secondary_defaults[slot_id] = str(replacement.get("text") if replacement.get("text") is not None else zone.get("text") or "")

    text_zone = {
        "x": _int(main_bounds.get("x"), 0),
        "y": _int(main_bounds.get("y"), int(round(canvas_h * 0.44))),
        "width": _int(main_bounds.get("width"), canvas_w, minimum=1),
        "height": _int(main_bounds.get("height"), int(round(canvas_h * 0.12)), minimum=1),
        "props": {
            "border_color": None,
            "border_width": 4,
            "text_color": _hex(main_style.get("fill"), "#111111"),
            "text_align": _normalize_align(main_style.get("align"), "center"),
            "font_family": str(main_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
            "text_effect": "none",
            "text_effect_color": "#000000",
            "text_effect_offset_x": 2,
            "text_effect_offset_y": 2,
            "text_effect_blur": 0,
            "text_zone_bg_color": "#ffffff",
            "custom_font_file": main_font_file,
            "secondary_text_slots": secondary_slots,
            "secondary_text_defaults": secondary_defaults,
            "manifest_main_replacement_text": str(main_replacement.get("text") or main.get("text") if isinstance(main, dict) else ""),
            "manifest_main_replacement_font": str(main_replacement.get("font_family") or main_style.get("font_family") or '"Poppins", "Segoe UI", Arial, sans-serif'),
            "manifest_main_replacement_font_file": main_font_file,
        },
    }

    return {
        "canvas": {"width": canvas_w, "height": canvas_h},
        "image_zones": image_zones,
        "text_zone": text_zone,
    }


def parse_ocr_results(payload: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in payload or []:
        if not isinstance(row, dict):
            continue
        candidate_id = str(row.get("candidate_id") or "").strip()
        if not candidate_id:
            continue
        text = str(row.get("text") or "").strip()
        confidence = float(row.get("confidence") or 0.0)
        if confidence > 1.0:
            confidence = confidence / 100.0
        confidence = max(0.0, min(1.0, confidence))
        result[candidate_id] = {
            "text": text,
            "confidence": confidence,
        }
    return result


def orchestrate_detection_manifest(
    svg_content: str,
    *,
    existing_manifest: dict[str, Any] | None = None,
    ocr_payload: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Parse structure + OCR rows and return (manifest_v2, structure)."""
    structure = parse_svg_structure(svg_content)
    previous = migrate_manifest_to_v2(existing_manifest, structure)
    parsed_ocr = parse_ocr_results(ocr_payload)
    manifest = build_manifest_v2(structure, ocr_results=parsed_ocr, previous_manifest=previous)
    return normalize_manifest_v2(manifest), structure
