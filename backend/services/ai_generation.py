"""
AI generation service with placeholder support for titles, descriptions, and board names.
"""
import os
import re
from typing import Any

import httpx

MAX_PIN_TITLE_LENGTH = 100
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"

AVAILABLE_PLACEHOLDERS = [
    {"name": "title", "description": "Page title"},
    {"name": "description", "description": "Page meta description"},
    {"name": "keywords", "description": "Comma-separated keywords"},
    {"name": "url", "description": "Full page URL"},
    {"name": "website_name", "description": "Website name"},
    {"name": "section", "description": "Page section/category"},
]

LANGUAGE_OPTIONS = [
    "English",
    "Spanish",
    "French",
    "German",
    "Portuguese",
    "Italian",
    "Dutch",
    "Polish",
    "Japanese",
    "Korean",
    "Chinese",
    "Arabic",
    "Hindi",
]


def clean_whitespace(value: str | None) -> str:
    """Collapse repeated whitespace."""
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_keywords(keywords: list[str], limit: int = 10) -> list[str]:
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


def substitute_placeholders(
    template: str,
    context: dict[str, Any],
) -> str:
    """Replace {{placeholder}} in template with values from context."""
    result = template

    # Build keyword string
    keywords_list = context.get("keywords", [])
    if isinstance(keywords_list, list):
        keywords_str = ", ".join(normalize_keywords(keywords_list))
    else:
        keywords_str = str(keywords_list or "")

    # Build website name from URL if not provided
    website_name = context.get("website_name", "")
    if not website_name and context.get("url"):
        try:
            from urllib.parse import urlparse
            parsed = urlparse(context["url"])
            website_name = parsed.netloc.replace("www.", "").split(".")[0] or ""
        except Exception:
            website_name = ""

    substitutions = {
        "title": clean_whitespace(context.get("title")) or "",
        "description": clean_whitespace(context.get("description")) or "",
        "keywords": keywords_str,
        "url": context.get("url", ""),
        "website_name": website_name,
        "section": clean_whitespace(context.get("section")) or "",
    }

    for placeholder, value in substitutions.items():
        # Replace various placeholder formats: {{ placeholder }}, {{placeholder}}, etc.
        p1 = "{{ " + placeholder + " }}"
        p2 = "{{ " + placeholder + "}}"
        p3 = "{{"+ placeholder + " }}"
        p4 = "{{"+ placeholder + "}}"
        for pattern in [p1, p2, p3, p4]:
            result = result.replace(pattern, str(value))

    return result


def call_openai(
    prompt: str,
    model: str = DEFAULT_OPENAI_MODEL,
    temperature: float = 0.4,
    max_tokens: int | None = None,
) -> str | None:
    """Call OpenAI API and return the response content."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30"))
    payload: dict[str, Any] = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt},
        ],
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens

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
        content = data["choices"][0]["message"]["content"]
        return content
    except Exception as exc:
        print(f"OpenAI API call failed: {exc}")
        return None


def generate_with_preset(
    preset: dict[str, Any],
    context: dict[str, Any],
) -> str | None:
    """Generate content using a prompt preset and page context."""
    template = preset.get("prompt_template", "")
    if not template:
        return None

    model = preset.get("model", DEFAULT_OPENAI_MODEL)
    temperature = preset.get("temperature", 0.4)
    max_tokens = preset.get("max_tokens")
    language = preset.get("language", "English")

    # Inject language instruction into prompt
    prompt = substitute_placeholders(template, context)
    if language and language != "English":
        prompt = f"[Generate content in {language}]\n\n{prompt}"

    result = call_openai(prompt, model=model, temperature=temperature, max_tokens=max_tokens)
    return result.strip() if result else None


def generate_title_variants(
    page_title: str | None,
    keywords: list[str],
    count: int,
    preset: dict[str, Any] | None = None,
    website_name: str = "",
    url: str = "",
    section: str = "",
    description: str = "",
) -> list[str]:
    """Generate multiple title variants using AI or fallback."""
    context = {
        "title": page_title,
        "keywords": keywords,
        "website_name": website_name,
        "url": url,
        "section": section,
        "description": description,
    }

    if preset:
        result = generate_with_preset(preset, context)
        if result:
            lines = [line.strip() for line in result.splitlines() if line.strip()]
            titles = [line.strip(" -0123456789.").strip() for line in lines]
            return [t for t in titles if t][:count]

    # Fallback: generate using default method
    return _build_fallback_titles(page_title, keywords, count)


def generate_description(
    page_title: str | None,
    keywords: list[str],
    preset: dict[str, Any] | None = None,
    website_name: str = "",
    url: str = "",
    section: str = "",
    description: str = "",
) -> str | None:
    """Generate a description using AI preset or fallback."""
    context = {
        "title": page_title,
        "keywords": keywords,
        "website_name": website_name,
        "url": url,
        "section": section,
        "description": description,
    }

    if preset:
        return generate_with_preset(preset, context)

    # Fallback: simple concatenation
    parts = []
    if page_title:
        parts.append(page_title)
    if keywords:
        parts.append(f"Keywords: {', '.join(normalize_keywords(keywords, 5))}")
    if url:
        parts.append("Read more at the link below.")
    return "\n\n".join(parts) if parts else None


def generate_board_name(
    page_title: str | None,
    keywords: list[str],
    preset: dict[str, Any] | None = None,
    website_name: str = "",
    url: str = "",
    section: str = "",
    description: str = "",
) -> str | None:
    """Generate a board name using AI preset or fallback."""
    context = {
        "title": page_title,
        "keywords": keywords,
        "website_name": website_name,
        "url": url,
        "section": section,
        "description": description,
    }

    if preset:
        result = generate_with_preset(preset, context)
        if result:
            # Take first line and clean it up
            lines = [line.strip() for line in result.splitlines() if line.strip()]
            if lines:
                board = lines[0].strip(" -0123456789.").strip()
                if len(board) > 50:
                    board = board[:50].rsplit(" ", 1)[0].strip()
                return board
    return None


def _build_fallback_titles(
    page_title: str | None,
    keywords: list[str],
    count: int,
) -> list[str]:
    """Build deterministic fallback titles."""
    title = clean_whitespace(page_title)
    keyword_list = normalize_keywords(keywords, limit=8)

    if count <= 0:
        return []
    if not title and not keyword_list:
        return []
    if not keyword_list:
        return [title] * count if title else []

    candidates: list[str] = []
    if title:
        candidates.append(title)
        for keyword in keyword_list[:3]:
            candidates.extend([
                f"{keyword} - {title}",
                f"{title} - {keyword}",
            ])

    if not candidates:
        candidates = keyword_list[:count]

    # Dedupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        lower = c.casefold()
        if lower not in seen:
            seen.add(lower)
            unique.append(c)

    while len(unique) < count:
        unique.append(unique[len(unique) % len(unique)])

    return unique[:count]