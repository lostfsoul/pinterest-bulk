"""Palette helpers for preview and pin rendering."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import requests


def normalize_hex_color(value: str | None, default: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return default
    if not raw.startswith("#"):
        raw = f"#{raw}"
    if len(raw) == 4:
        raw = "#" + "".join(ch * 2 for ch in raw[1:])
    if len(raw) != 7:
        return default
    try:
        int(raw[1:], 16)
        return raw.lower()
    except ValueError:
        return default


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    normalized = normalize_hex_color(value, "#000000")
    return (
        int(normalized[1:3], 16),
        int(normalized[3:5], 16),
        int(normalized[5:7], 16),
    )


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[max(0, min(255, int(channel))) for channel in rgb])


def _mix_rgb(
    start: tuple[int, int, int],
    end: tuple[int, int, int],
    ratio: float,
) -> tuple[int, int, int]:
    amount = max(0.0, min(1.0, ratio))
    return tuple(
        int(round(start[index] + (end[index] - start[index]) * amount))
        for index in range(3)
    )


def _luminance(rgb: tuple[int, int, int]) -> float:
    def channel(value: int) -> float:
        scaled = value / 255
        if scaled <= 0.03928:
            return scaled / 12.92
        return ((scaled + 0.055) / 1.055) ** 2.4

    red, green, blue = rgb
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def _contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    lighter = max(_luminance(a), _luminance(b))
    darker = min(_luminance(a), _luminance(b))
    return (lighter + 0.05) / (darker + 0.05)


def derive_palette_from_hex(base_color: str) -> dict[str, str]:
    """Create a readable text palette from a dominant image color."""
    base_rgb = _hex_to_rgb(base_color)
    base_luminance = _luminance(base_rgb)
    white = (255, 255, 255)
    black = (17, 24, 39)

    surface_mix = 0.78 if base_luminance < 0.55 else 0.58
    surface_rgb = _mix_rgb(base_rgb, white, surface_mix)

    dark_candidate = _mix_rgb(base_rgb, black, 0.78)
    light_candidate = _mix_rgb(base_rgb, white, 0.9)
    text_rgb = (
        dark_candidate
        if _contrast_ratio(dark_candidate, surface_rgb) >= _contrast_ratio(light_candidate, surface_rgb)
        else light_candidate
    )
    if _contrast_ratio(text_rgb, surface_rgb) < 4.2:
        text_rgb = black if _contrast_ratio(black, surface_rgb) >= _contrast_ratio(white, surface_rgb) else white

    effect_target = white if _luminance(text_rgb) < 0.45 else black
    effect_rgb = _mix_rgb(base_rgb, effect_target, 0.45)
    if _contrast_ratio(effect_rgb, text_rgb) < 1.25:
        effect_rgb = effect_target

    return {
        "background": _rgb_to_hex(surface_rgb),
        "text": _rgb_to_hex(text_rgb),
        "effect": _rgb_to_hex(effect_rgb),
    }


def sample_image_palette(
    image_url: str | None,
    *,
    referer: str | None = None,
    timeout: int = 15,
) -> dict[str, str] | None:
    """Download an image and derive a lightweight palette from it."""
    if not image_url:
        return None

    try:
        from PIL import Image
    except Exception:
        return None

    try:
        response = requests.get(
            image_url,
            timeout=timeout,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; PinterestCSVTool/1.0)",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": referer or "",
            },
        )
        response.raise_for_status()
        with Image.open(BytesIO(response.content)) as image:
            sampled = image.convert("RGB")
            sampled.thumbnail((24, 24))
            pixels = list(sampled.getdata())
            if not pixels:
                return None
            average = tuple(
                int(round(sum(pixel[index] for pixel in pixels) / len(pixels)))
                for index in range(3)
            )
            return derive_palette_from_hex(_rgb_to_hex(average))
    except Exception:
        return None


def resolve_palette_settings(
    base_settings: dict[str, Any],
    *,
    image_url: str | None = None,
    referer: str | None = None,
) -> dict[str, Any]:
    """Resolve palette mode into concrete render colors."""
    resolved = dict(base_settings)
    palette_mode = (resolved.get("palette_mode") or "").strip().lower()
    current_background = normalize_hex_color(resolved.get("text_zone_bg_color"), "#ffffff")
    current_text = normalize_hex_color(resolved.get("text_color"), "#000000")
    current_effect = normalize_hex_color(resolved.get("text_effect_color"), "#000000")

    if palette_mode == "brand":
        resolved["text_zone_bg_color"] = normalize_hex_color(
            resolved.get("brand_palette_background_color"),
            current_background,
        )
        resolved["text_color"] = normalize_hex_color(
            resolved.get("brand_palette_text_color"),
            current_text,
        )
        resolved["text_effect_color"] = normalize_hex_color(
            resolved.get("brand_palette_effect_color"),
            current_effect,
        )
        return resolved

    if palette_mode == "manual":
        resolved["text_zone_bg_color"] = normalize_hex_color(
            resolved.get("manual_palette_background_color"),
            current_background,
        )
        resolved["text_color"] = normalize_hex_color(
            resolved.get("manual_palette_text_color"),
            current_text,
        )
        resolved["text_effect_color"] = normalize_hex_color(
            resolved.get("manual_palette_effect_color"),
            current_effect,
        )
        return resolved

    if palette_mode == "auto":
        palette = sample_image_palette(image_url, referer=referer)
        if palette:
            resolved["text_zone_bg_color"] = palette["background"]
            resolved["text_color"] = palette["text"]
            resolved["text_effect_color"] = palette["effect"]
            return resolved

    resolved["text_zone_bg_color"] = current_background
    resolved["text_color"] = current_text
    resolved["text_effect_color"] = current_effect
    return resolved
