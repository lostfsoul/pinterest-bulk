"""Utilities for grouping resized variants of the same source image."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from typing import TypeVar
from urllib.parse import urlparse


T = TypeVar("T")


def canonical_image_url_key(image_url: str) -> str:
    """Return a stable key shared by an original image and its resized variants."""
    parsed = urlparse(image_url)
    path = parsed.path.lower()
    path = re.sub(
        r"-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|gif|avif)$)",
        "",
        path,
    )
    return f"{parsed.netloc.lower()}{path}"


def image_variant_score(image_url: str) -> int:
    """Prefer original URLs over resized variants, then the largest variant."""
    path = urlparse(image_url).path.lower()
    size_match = re.search(
        r"-(\d{2,5})x(\d{2,5})(?=\.(?:jpe?g|png|webp|gif|avif)$)",
        path,
    )
    if not size_match:
        return 10_000_000_000
    return int(size_match.group(1)) * int(size_match.group(2))


def dedupe_image_variants(
    items: Iterable[T],
    url_getter: Callable[[T], str | None],
) -> list[T]:
    """Keep the best URL from each image family while preserving family order."""
    positions: dict[str, int] = {}
    unique_items: list[T] = []

    for item in items:
        url = (url_getter(item) or "").strip()
        if not url:
            continue
        key = canonical_image_url_key(url)
        existing_index = positions.get(key)
        if existing_index is None:
            positions[key] = len(unique_items)
            unique_items.append(item)
            continue

        existing_url = (url_getter(unique_items[existing_index]) or "").strip()
        if image_variant_score(url) > image_variant_score(existing_url):
            unique_items[existing_index] = item

    return unique_items


def dedupe_image_urls(urls: Iterable[str]) -> list[str]:
    return dedupe_image_variants(urls, lambda url: url)
