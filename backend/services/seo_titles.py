"""
SEO title generation helpers for pin drafts.
"""
import os
import re
from typing import Iterable

import httpx


MAX_PIN_TITLE_LENGTH = 100
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


def clean_whitespace(value: str | None) -> str:
    """Collapse repeated whitespace."""
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_keywords(keywords: Iterable[str], limit: int = 5) -> list[str]:
    """Normalize and de-duplicate keywords while preserving order."""
    result: list[str] = []
    seen: set[str] = set()

    for keyword in keywords:
        normalized = clean_whitespace(keyword)
        if not normalized:
            continue
        lowered = normalized.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(normalized)
        if len(result) >= limit:
            break

    return result


def truncate_title(value: str, limit: int = MAX_PIN_TITLE_LENGTH) -> str:
    """Trim a title to Pinterest's limit without trailing punctuation noise."""
    collapsed = clean_whitespace(value)
    if len(collapsed) <= limit:
        return collapsed.strip(" -|,:")
    truncated = collapsed[:limit].rsplit(" ", 1)[0]
    if not truncated:
        truncated = collapsed[:limit]
    return truncated.strip(" -|,:")


def dedupe_titles(values: Iterable[str], limit: int) -> list[str]:
    """Normalize and deduplicate title candidates."""
    result: list[str] = []
    seen: set[str] = set()

    for value in values:
        title = truncate_title(value)
        if not title:
            continue
        lowered = title.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(title)
        if len(result) >= limit:
            break

    return result


def build_fallback_pin_title(page_title: str | None, keywords: Iterable[str]) -> str:
    """Build a deterministic SEO-ish title when AI is unavailable."""
    title = clean_whitespace(page_title)
    keyword_list = normalize_keywords(keywords, limit=3)

    if not title and keyword_list:
        return truncate_title(" - ".join(keyword_list))
    if not title:
        return ""

    lower_title = title.casefold()
    missing_keywords = [keyword for keyword in keyword_list if keyword.casefold() not in lower_title]
    if not missing_keywords:
        return truncate_title(title)

    merged = f"{missing_keywords[0]} - {title}"
    return truncate_title(merged)


def build_fallback_pin_title_variants(
    page_title: str | None,
    keywords: Iterable[str],
    count: int,
) -> list[str]:
    """Build multiple deterministic SEO title variants."""
    title = clean_whitespace(page_title)
    keyword_list = normalize_keywords(keywords, limit=8)

    if count <= 0:
        return []

    if not title and not keyword_list:
        return []

    if not keyword_list:
        return [truncate_title(title)] * count if title else []

    candidates: list[str] = []
    if title:
        candidates.append(build_fallback_pin_title(title, keyword_list))
        for keyword in keyword_list:
            keyword_lower = keyword.casefold()
            candidates.extend(
                [
                    f"{keyword} - {title}",
                    f"{title} - {keyword}",
                    f"{keyword}: {title}",
                ]
            )
            if "idea" not in keyword_lower and "ideas" not in keyword_lower:
                candidates.append(f"{keyword} ideas - {title}")
            if "recipe" not in keyword_lower and "recipes" not in keyword_lower:
                candidates.append(f"{keyword} recipes - {title}")
            if "inspiration" not in keyword_lower:
                candidates.append(f"{keyword} inspiration - {title}")
        for first in keyword_list:
            for second in keyword_list:
                if first == second:
                    continue
                candidates.append(f"{first} and {second} - {title}")
    else:
        candidates.extend(keyword_list)
        for first in keyword_list:
            for second in keyword_list:
                if first == second:
                    continue
                candidates.extend(
                    [
                        f"{first} - {second}",
                        f"{first} and {second}",
                    ]
                )

    unique_titles = dedupe_titles(candidates, count)
    if not unique_titles:
        return []

    while len(unique_titles) < count:
        unique_titles.append(unique_titles[len(unique_titles) % len(unique_titles)])

    return unique_titles[:count]


def call_openai_for_titles(page_title: str | None, keywords: Iterable[str], count: int) -> list[str]:
    """Call OpenAI and return raw title candidates."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return []

    normalized_title = clean_whitespace(page_title)
    keyword_list = normalize_keywords(keywords, limit=5)
    if not normalized_title and not keyword_list:
        return []

    model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "20"))
    payload = {
        "model": model,
        "temperature": 0.4,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write SEO-friendly Pinterest pin titles. "
                    f"Return exactly {count} distinct titles under 100 characters each. "
                    "Use natural English, title case, and include 1-3 relevant keywords naturally. "
                    "Do not use quotes, emojis, hashtags, or extra commentary. "
                    "Return one title per line and nothing else."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Article title: {normalized_title or 'N/A'}\n"
                    f"Keywords: {', '.join(keyword_list) or 'N/A'}\n"
                    "Create distinct Pinterest title variants for separate pin images."
                ),
            },
        ],
    }

    try:
        response = httpx.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        print(f"OpenAI SEO title generation failed: {exc}")
        return []

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return []

    lines = [line.strip(" -0123456789.").strip() for line in str(content).splitlines()]
    return [line for line in lines if line]


def generate_ai_pin_title(page_title: str | None, keywords: Iterable[str]) -> str | None:
    """Generate a concise Pinterest title using OpenAI when configured."""
    titles = dedupe_titles(call_openai_for_titles(page_title, keywords, 1), 1)
    return titles[0] if titles else None


def generate_ai_pin_title_variants(
    page_title: str | None,
    keywords: Iterable[str],
    count: int,
) -> list[str]:
    """Generate multiple distinct Pinterest titles using OpenAI when configured."""
    if count <= 0:
        return []

    ai_titles = dedupe_titles(call_openai_for_titles(page_title, keywords, count), count)
    if len(ai_titles) >= count:
        return ai_titles[:count]

    fallback_titles = build_fallback_pin_title_variants(page_title, keywords, count)
    combined = dedupe_titles([*ai_titles, *fallback_titles], count)
    if not combined:
        return []

    while len(combined) < count:
        source = fallback_titles or combined
        combined.append(source[len(combined) % len(source)])

    return combined[:count]
