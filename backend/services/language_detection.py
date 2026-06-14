"""AI-first website language detection."""

from __future__ import annotations

import asyncio
import re

from bs4 import BeautifulSoup

from services.ai_generation import DEFAULT_OPENAI_MODEL, LANGUAGE_OPTIONS, call_model
from services.remote_fetch import MAX_HTML_BYTES, fetch_remote


def extract_language_sample(html: str, limit: int = 6000) -> str:
    """Extract a compact visible-text sample suitable for language classification."""
    soup = BeautifulSoup(html or "", "html.parser")
    for element in soup(["script", "style", "noscript", "svg"]):
        element.decompose()
    return " ".join(soup.stripped_strings)[:limit]


def normalize_ai_language(value: str | None) -> str | None:
    """Accept only a supported language returned by the model."""
    response = re.sub(r"[^A-Za-z ]+", " ", str(value or "")).strip().casefold()
    if not response:
        return None
    supported = {language.casefold(): language for language in LANGUAGE_OPTIONS}
    if response in supported:
        return supported[response]
    matches = [
        language
        for key, language in supported.items()
        if re.search(rf"\b{re.escape(key)}\b", response)
    ]
    return matches[0] if len(matches) == 1 else None


def classify_website_language(url: str, website_name: str, sample: str) -> str | None:
    """Ask the configured OpenAI model for one supported language name."""
    allowed = ", ".join(LANGUAGE_OPTIONS)
    prompt = (
        "Identify the primary language used by this website. "
        "Return exactly one language name from the allowed list and nothing else.\n"
        f"Allowed languages: {allowed}\n"
        f"Website name: {website_name or 'Unknown'}\n"
        f"Website URL: {url}\n"
        f"Homepage text sample: {sample or 'Unavailable'}"
    )
    result = call_model(
        prompt,
        model=DEFAULT_OPENAI_MODEL,
        temperature=0,
        max_tokens=12,
    )
    return normalize_ai_language(result)


async def detect_website_language(url: str, website_name: str = "") -> str | None:
    """Fetch a bounded sample, then use one OpenAI call to classify its language."""
    sample = ""
    try:
        response = await fetch_remote(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; PinterestTool/1.0)"},
            timeout=8.0,
            max_bytes=MAX_HTML_BYTES,
        )
        if "html" in response.headers.get("content-type", "").lower():
            sample = extract_language_sample(response.text)
    except Exception:
        sample = ""

    return await asyncio.to_thread(
        classify_website_language,
        url,
        website_name,
        sample,
    )
