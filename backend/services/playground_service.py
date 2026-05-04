"""Business logic for Playground settings, data sources, and preview metadata."""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import unquote, urljoin, urlparse
from pathlib import Path

import httpx
try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - fallback when optional dependency is missing
    BeautifulSoup = None

from sqlalchemy.orm import Session, joinedload

from models import CustomFont, Page, SEOKeyword, Template, Website
from services.ai_generation import DEFAULT_OPENAI_MODEL, call_model
from routers.images import extract_main_content, is_wordpress_content_image


PROMPT_STYLE_TEXT: dict[str, str] = {
    "engaging": (
        "Write an engaging Pinterest title and description with emotional hooks and clear benefit."
    ),
    "informative": (
        "Write a clear, informative Pinterest title and description focused on practical value."
    ),
    "question": (
        "Write a curiosity-driven Pinterest title as a question and a helpful answer-oriented description."
    ),
    "question_based": (
        "Write a curiosity-driven Pinterest title as a question and a helpful answer-oriented description."
    ),
    "listicle": (
        "Write a listicle-style Pinterest title and description with concise, scannable points."
    ),
    "listicle_style": (
        "Write a listicle-style Pinterest title and description with concise, scannable points."
    ),
    "ecommerce": (
        "Write conversion-focused Pinterest copy that highlights product value and intent to buy."
    ),
    "ecommerce_product": (
        "Write conversion-focused Pinterest copy that highlights product value and intent to buy."
    ),
}

_SCRAPE_CACHE_TTL_SECONDS = 300
_SCRAPE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_FONT_STORAGE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "fonts"


def _normalize_prompt_style(style: str | None) -> str:
    raw = str(style or "informative").strip().lower()
    aliases = {
        "question-based": "question",
        "question_based": "question",
        "listicle style": "listicle",
        "listicle_style": "listicle",
        "e-commerce product": "ecommerce",
        "ecommerce_product": "ecommerce",
    }
    return aliases.get(raw, raw if raw in PROMPT_STYLE_TEXT else "informative")


def _clean_text(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip()


def _truncate(value: str, limit: int) -> str:
    text = _clean_text(value)
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _build_ai_preview_content(
    *,
    title_base: str,
    page_url: str,
    ai_settings: dict[str, Any],
) -> dict[str, str]:
    style = _normalize_prompt_style(ai_settings.get("promptStyle"))
    language = _clean_text(ai_settings.get("language")) or "English"
    custom_prompt = _clean_text(ai_settings.get("customPrompt"))
    prompt_enabled = bool(ai_settings.get("promptEnabled", True))
    active_prompt = custom_prompt if (prompt_enabled and custom_prompt) else PROMPT_STYLE_TEXT.get(style, "")

    words = title_base.split()
    compact_title = " ".join(words[:10]).strip() or title_base
    style_title = {
        "engaging": f"Irresistible {compact_title} You Will Want To Save",
        "informative": f"{compact_title} Recipe Guide With Practical Tips",
        "question": f"How Do You Make {compact_title} At Home?",
        "listicle": f"{compact_title}: 7 Tips For Better Results",
        "ecommerce": f"{compact_title} Everyone Is Saving Right Now",
    }.get(style, compact_title)
    title = _truncate(style_title, 100)

    description_seed = {
        "engaging": (
            f"Make {title_base} with confidence using simple steps and strong flavor balance. "
            "Save this pin for your next cooking day."
        ),
        "informative": (
            f"Learn the method for {title_base} with clear ingredient flow, timing, and prep guidance. "
            "Use this as a reliable reference."
        ),
        "question": (
            f"Want a repeatable way to prepare {title_base}? This pin breaks down what to use, "
            "what to avoid, and how to get consistent results."
        ),
        "listicle": (
            f"Use this quick list to improve {title_base}: ingredient balance, timing, bake control, "
            "texture checks, and serving ideas."
        ),
        "ecommerce": (
            f"Get better {title_base} outcomes with a practical process and smart prep steps. "
            "Save now and come back when you are ready to cook."
        ),
    }.get(style, f"Save this pin for {title_base} and revisit the full method when needed.")

    description = _truncate(description_seed, 500)
    alt_text = _truncate(
        f"{title_base} preview image for Pinterest in {language}.",
        180,
    )
    return {
        "title": title,
        "description": description,
        "alt_text": alt_text,
    }


def _resolve_template_title_mode(
    *,
    title_base: str,
    ai_settings: dict[str, Any],
    fallback_title: str,
) -> str:
    mode = _clean_text(ai_settings.get("templateTitleMode") or ai_settings.get("template_title_mode")).lower() or "prompt"
    if mode == "original":
        return _truncate(title_base, 100)

    prompt_template = _clean_text(
        ai_settings.get("templateTitlePrompt")
        or ai_settings.get("template_title_prompt")
    )
    if mode == "prompt" and prompt_template:
        prompt_seed = prompt_template.replace("{{title}}", title_base)
        prompt = (
            "Return one Pinterest title only (plain text, no quotes), max 100 chars.\n"
            f"Instruction: {prompt_seed}\n"
            f"Base title: {title_base}\n"
        )
        raw = call_model(prompt, model=DEFAULT_OPENAI_MODEL, temperature=0.4, max_tokens=120)
        value = _clean_text(raw)
        if value:
            first_line = value.splitlines()[0]
            return _truncate(first_line, 100)

    return _truncate(fallback_title or title_base, 100)


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = text[start : end + 1]
    try:
        import json
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def generate_ai_preview_content(
    db: Session,
    website_id: int,
    page_url: str,
    ai_settings_override: dict[str, Any] | None = None,
) -> dict[str, str]:
    page = (
        db.query(Page)
        .options(joinedload(Page.website))
        .filter(Page.website_id == website_id, Page.url == page_url)
        .first()
    )
    if not page:
        raise ValueError("Page not found")

    settings = page.website.generation_settings if page.website and isinstance(page.website.generation_settings, dict) else {}
    playground_settings = settings.get("playground") if isinstance(settings.get("playground"), dict) else {}
    stored_ai_settings = playground_settings.get("ai_settings") if isinstance(playground_settings.get("ai_settings"), dict) else {}
    ai_settings = ai_settings_override if isinstance(ai_settings_override, dict) else stored_ai_settings

    title_base = (page.title or page.url).strip()
    language = _clean_text(ai_settings.get("language")) or "English"
    custom_prompt = _clean_text(ai_settings.get("customPrompt"))
    prompt_enabled = bool(ai_settings.get("promptEnabled", True))
    style = _normalize_prompt_style(ai_settings.get("promptStyle"))
    style_prompt = PROMPT_STYLE_TEXT.get(style, PROMPT_STYLE_TEXT["informative"])
    active_prompt = custom_prompt if (prompt_enabled and custom_prompt) else style_prompt

    keyword_row = db.query(SEOKeyword).filter(SEOKeyword.url == page.url).first()
    keywords = _clean_text(keyword_row.keywords if keyword_row else "")
    fallback = _build_ai_preview_content(
        title_base=title_base,
        page_url=page.url,
        ai_settings=ai_settings,
    )

    prompt = (
        "Generate Pinterest metadata as strict JSON with keys: "
        "title, description, alt_text.\n"
        f"Language: {language}\n"
        "Requirements:\n"
        "- title max 100 chars\n"
        "- description max 500 chars\n"
        "- alt_text max 180 chars\n"
        "- no markdown\n"
        "- no extra keys\n\n"
        f"Content brief: {active_prompt}\n"
        f"Page title: {title_base}\n"
        f"Page URL: {page.url}\n"
        f"Keywords: {keywords}\n"
    )

    raw = call_model(prompt, model=DEFAULT_OPENAI_MODEL, temperature=0.4, max_tokens=350)
    parsed = _extract_json_object(raw or "")
    if not parsed:
        parsed_payload = fallback
    else:
        parsed_payload = {
            "title": _truncate(str(parsed.get("title") or fallback["title"]), 100),
            "description": _truncate(str(parsed.get("description") or fallback["description"]), 500),
            "alt_text": _truncate(str(parsed.get("alt_text") or fallback["alt_text"]), 180),
        }

    parsed_payload["title"] = _resolve_template_title_mode(
        title_base=title_base,
        ai_settings=ai_settings,
        fallback_title=parsed_payload.get("title") or fallback.get("title") or title_base,
    )
    return parsed_payload


def _normalize_url(raw_url: str) -> str:
    value = (raw_url or "").strip()
    if not value:
        return ""
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    return value


def _extract_content_length(headers: dict[str, str]) -> int:
    raw = headers.get("content-length") or headers.get("Content-Length") or "0"
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _is_hidden_image_tag(img: Any) -> bool:
    attrs = " ".join(
        str(value)
        for value in [
            img.get("class") or "",
            img.get("style") or "",
            img.get("loading") or "",
            img.get("aria-hidden") or "",
            img.get("hidden") or "",
        ]
    ).lower()
    return any(
        marker in attrs
        for marker in [
            "display:none",
            "display: none",
            "visibility:hidden",
            "visibility: hidden",
            "hidden",
            "lazy-hidden",
            "screen-reader",
        ]
    )


def _best_img_src(img: Any) -> str:
    for attr in ("data-src", "data-lazy-src", "src"):
        value = str(img.get(attr) or "").strip()
        if value and not value.startswith("data:"):
            return value
    srcset = str(img.get("srcset") or img.get("data-srcset") or "").strip()
    if srcset:
        candidates = [part.strip().split(" ")[0] for part in srcset.split(",") if part.strip()]
        if candidates:
            return candidates[-1]
    return ""


def _text_tokens(value: str | None) -> set[str]:
    stopwords = {
        "the", "and", "for", "with", "from", "this", "that", "your", "you",
        "recipe", "recipes", "easy", "best", "homemade", "simple", "quick",
        "how", "make", "made", "guide", "food", "image", "photo", "jpg",
        "jpeg", "png", "webp", "scaled", "copy",
    }
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in str(value or ""))
    return {token for token in cleaned.split() if len(token) >= 3 and token not in stopwords}


def _image_url_tokens(image_url: str) -> set[str]:
    parsed = urlparse(image_url)
    filename = unquote(parsed.path.rsplit("/", 1)[-1])
    return _text_tokens(filename.replace("-", " ").replace("_", " "))


def _image_relevance_score(image_url: str, page_url: str, title: str) -> int:
    title_tokens = _text_tokens(title)
    page_tokens = _text_tokens(urlparse(page_url).path.replace("-", " ").replace("_", " "))
    image_tokens = _image_url_tokens(image_url)
    if not image_tokens:
        return 0
    return (len(image_tokens & title_tokens) * 3) + len(image_tokens & page_tokens)


def _has_bad_image_ancestor(img: Any) -> bool:
    bad_markers = [
        "related", "recommend", "recommended", "popular", "trending", "more-post",
        "more_post", "you-may", "you_may", "also-like", "also_like", "similar",
        "sidebar", "widget", "footer", "header", "nav", "menu", "comment",
        "author", "bio", "share", "social", "newsletter", "signup", "ad-",
        " advert", "advertisement", "promo", "carousel", "swiper", "slick",
        "roundup", "archive", "category-list", "post-grid", "card-grid",
    ]
    parent = img
    depth = 0
    while parent is not None and depth < 8:
        attrs = " ".join(
            str(value)
            for value in [
                parent.get("class") or "",
                parent.get("id") or "",
                parent.get("role") or "",
                parent.get("aria-label") or "",
                parent.name or "",
            ]
        ).lower()
        if any(marker in attrs for marker in bad_markers):
            return True
        parent = parent.parent
        depth += 1
    return False


async def _looks_large_enough(url: str, client: httpx.AsyncClient) -> bool:
    try:
        response = await client.head(url, timeout=4.0, follow_redirects=True)
        if response.status_code >= 400:
            return False
        content_length = _extract_content_length(dict(response.headers))
        if content_length > 0 and content_length < 8_000:
            return False
        return True
    except Exception:
        return False


async def scrape_page_images(url: str) -> dict[str, Any]:
    normalized_url = _normalize_url(url)
    if not normalized_url:
        return {"images": [], "title": "", "description": ""}

    cached = _SCRAPE_CACHE.get(normalized_url)
    now = time.time()
    if cached and now - cached[0] < _SCRAPE_CACHE_TTL_SECONDS:
        return cached[1]

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; PinterestCSVTool/1.0; +https://github.com/pinterest-csv-tool)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=30.0) as client:
        response = await client.get(normalized_url)
        response.raise_for_status()
        html = response.text
        og_title = ""
        og_desc = ""
        og_image = ""
        title = ""
        description = ""
        image_candidates: list[dict[str, Any]] = []

        if BeautifulSoup is not None:
            soup = BeautifulSoup(html, "html.parser")

            og_title_node = soup.find("meta", attrs={"property": "og:title"})
            if og_title_node and og_title_node.get("content"):
                og_title = str(og_title_node.get("content")).strip()

            og_desc_node = soup.find("meta", attrs={"property": "og:description"})
            if og_desc_node and og_desc_node.get("content"):
                og_desc = str(og_desc_node.get("content")).strip()

            og_image_node = soup.find("meta", attrs={"property": "og:image"})
            if og_image_node and og_image_node.get("content"):
                og_image = str(og_image_node.get("content")).strip()

            title = og_title
            if not title:
                h1 = soup.find("h1")
                if h1:
                    title = h1.get_text(" ", strip=True)
            if not title and soup.title:
                title = soup.title.get_text(" ", strip=True)

            description = og_desc
            if not description:
                meta_desc = soup.find("meta", attrs={"name": "description"})
                if meta_desc and meta_desc.get("content"):
                    description = str(meta_desc.get("content")).strip()
            if not description:
                p = soup.find("p")
                if p:
                    description = p.get_text(" ", strip=True)

            main_soup = BeautifulSoup(extract_main_content(html), "html.parser")

            seen: set[str] = set()
            for img in main_soup.find_all("img"):
                if _is_hidden_image_tag(img):
                    continue
                if _has_bad_image_ancestor(img):
                    continue
                src = _best_img_src(img)
                if not src:
                    continue
                absolute = urljoin(normalized_url, src)
                if absolute in seen:
                    continue
                seen.add(absolute)
                width_raw = img.get("width")
                height_raw = img.get("height")
                try:
                    width = int(width_raw) if width_raw is not None else 0
                except (TypeError, ValueError):
                    width = 0
                try:
                    height = int(height_raw) if height_raw is not None else 0
                except (TypeError, ValueError):
                    height = 0
                if width and width < 200:
                    continue
                if height and height < 200:
                    continue
                parent = img.find_parent(["figure", "div", "p", "span"])
                parent_classes = " ".join(parent.get("class", [])) if parent else ""
                img_tag = str(img)
                is_content_image = is_wordpress_content_image(parent_classes, img_tag)
                relevance_score = _image_relevance_score(absolute, normalized_url, title)
                image_candidates.append({
                    "url": absolute,
                    "width": width,
                    "height": height,
                    "is_content_image": is_content_image,
                    "relevance_score": relevance_score,
                    "score": (width * height) + (1_000_000 if is_content_image else 0) + (relevance_score * 2_000_000),
                })
        else:
            import re

            def _meta(prop: str) -> str:
                pattern = rf'<meta[^>]+(?:property|name)=["\']{prop}["\'][^>]*content=["\']([^"\']+)["\']'
                match = re.search(pattern, html, flags=re.IGNORECASE)
                return match.group(1).strip() if match else ""

            og_title = _meta("og:title")
            og_desc = _meta("og:description")
            og_image = _meta("og:image")

            h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", html, flags=re.IGNORECASE | re.DOTALL)
            title_match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
            p_match = re.search(r"<p[^>]*>(.*?)</p>", html, flags=re.IGNORECASE | re.DOTALL)
            title = og_title or (h1_match.group(1) if h1_match else "") or (title_match.group(1) if title_match else "")
            description = og_desc or _meta("description") or (p_match.group(1) if p_match else "")
            title = _clean_text(re.sub(r"<[^>]+>", " ", title))
            description = _clean_text(re.sub(r"<[^>]+>", " ", description))

            seen: set[str] = set()
            for src in re.findall(r"<img[^>]+src=[\"']([^\"']+)[\"']", html, flags=re.IGNORECASE):
                absolute = urljoin(normalized_url, src.strip())
                if not absolute or absolute in seen:
                    continue
                seen.add(absolute)
                image_candidates.append({"url": absolute, "width": 0, "height": 0, "score": 0})

        relevant_candidates = [
            item for item in image_candidates
            if item.get("relevance_score", 0) > 0 or item.get("is_content_image")
        ]
        image_candidates = relevant_candidates or image_candidates
        image_candidates.sort(key=lambda item: item["score"], reverse=True)

        images: list[str] = []
        if og_image and not image_candidates:
            og_abs = urljoin(normalized_url, og_image)
            if await _looks_large_enough(og_abs, client):
                images.append(og_abs)

        head_checks = 0
        for candidate in image_candidates:
            if len(images) >= 10:
                break
            candidate_url = str(candidate["url"])
            if candidate_url in images:
                continue
            if candidate.get("width", 0) >= 200:
                images.append(candidate_url)
                continue
            if head_checks >= 8:
                break
            head_checks += 1
            if await _looks_large_enough(candidate_url, client):
                images.append(candidate_url)

        payload = {
            "images": images[:10],
            "title": title or normalized_url,
            "description": description or "",
        }
        _SCRAPE_CACHE[normalized_url] = (now, payload)
        return payload


def _default_playground_settings() -> dict[str, Any]:
    return {
        "selected_templates": [],
        "default_template_id": None,
        "font_set": "font_combo_1",
        "font_color": "#1a1a1a",
        "title_scale": 1.0,
        "title_padding_x": 15,
        "line_height_multiplier": 1.0,
        "ai_settings": {
            "promptStyle": "informative",
            "customPrompt": "",
            "language": "English",
            "promptEnabled": True,
            "templateTitleMode": "original",
            "templateTitlePrompt": "Rewrite this Pinterest title based on {{title}} while keeping intent and clarity.",
        },
        "image_settings": {
            "fetchFromPage": True,
            "useHiddenImages": True,
            "ignoreSmallWidth": True,
            "minWidth": 200,
            "ignoreSmallHeight": False,
            "limitImagesPerPage": False,
            "allowedOrientations": ["portrait", "square", "landscape"],
            "useFeaturedImage": True,
            "uniqueImagePerPin": True,
            "ignoreImagesWithTextOverlay": False,
            "noDuplicateContent": False,
        },
        "display_settings": {
            "showFullImage": False,
        },
        "advanced_settings": {
            "enableImageValidation": True,
        },
    }


def list_pages(db: Session, website_id: int) -> list[dict[str, Any]]:
    pages = (
        db.query(Page)
        .options(joinedload(Page.images), joinedload(Page.website))
        .filter(Page.website_id == website_id, Page.is_enabled == True)  # noqa: E712
        .order_by(Page.created_at.desc())
        .all()
    )

    result: list[dict[str, Any]] = []
    for page in pages:
        images = [
            image.url
            for image in sorted(page.images, key=lambda item: item.id)
            if not image.is_excluded
        ]
        board_candidates: list[str] = []
        settings = page.website.generation_settings if page.website else {}
        if isinstance(settings, dict):
            ai = settings.get("ai")
            if isinstance(ai, dict) and isinstance(ai.get("board_candidates"), list):
                board_candidates = [
                    str(value).strip()
                    for value in ai.get("board_candidates")
                    if str(value).strip()
                ]
        result.append(
            {
                "id": page.id,
                "url": page.url,
                "title": page.title or page.url,
                "description": page.title or "",
                "alt_text": page.title or "",
                "board": board_candidates[0] if board_candidates else "General",
                "images": images,
            }
        )
    return result


def _template_image_count(template: Template) -> int:
    zones = template.zones or []
    count = len([zone for zone in zones if zone.zone_type == "image"])
    return max(1, count)


def list_templates(db: Session) -> list[dict[str, Any]]:
    templates = (
        db.query(Template)
        .options(joinedload(Template.zones))
        .order_by(Template.created_at.desc())
        .all()
    )
    return [
        {
            "id": template.id,
            "name": template.name,
            "path": template.filename,
            "image_count": _template_image_count(template),
            "thumbnail_url": f"/static/templates/{template.filename}",
        }
        for template in templates
    ]


def list_font_sets(db: Session) -> list[dict[str, str]]:
    preset_candidates = [
        ("font_combo_1", "Bebas Neue", "Poppins", "Bebas Neue", "builtin/BebasNeue-Regular.ttf"),
        ("font_combo_2", "Montserrat", "Poppins", "Montserrat", "builtin/Montserrat-Bold.ttf"),
        ("font_combo_3", "Oswald", "Poppins", "Oswald", "builtin/Oswald-Regular.ttf"),
        ("font_combo_4", "Poppins", "Montserrat", "Poppins", "builtin/Poppins-Bold.ttf"),
        ("font_combo_5", "Montserrat", "Oswald", "Montserrat", "builtin/Montserrat-Regular.ttf"),
        ("font_combo_6", "Poppins", "Oswald", "Poppins", "builtin/Poppins-Regular.ttf"),
    ]
    presets: list[dict[str, str]] = []
    for font_id, main, secondary, accent, font_file in preset_candidates:
        if not (_FONT_STORAGE_ROOT / font_file).exists():
            continue
        presets.append(
            {
                "id": font_id,
                "main": main,
                "secondary": secondary,
                "accent": accent,
                "font_file": font_file,
            }
        )
    custom_fonts = (
        db.query(CustomFont)
        .order_by(CustomFont.created_at.desc())
        .all()
    )
    for font in custom_fonts:
        presets.append(
            {
                "id": f"custom:{font.filename}",
                "main": font.family,
                "secondary": "Inter",
                "accent": font.family,
                "font_file": font.filename,
            }
        )
    return presets


def get_settings(db: Session, website_id: int) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        return _default_playground_settings()
    settings = website.generation_settings if isinstance(website.generation_settings, dict) else {}
    draft = settings.get("playground")
    if not isinstance(draft, dict):
        return _default_playground_settings()

    merged = _default_playground_settings()
    merged.update({k: v for k, v in draft.items() if k in merged and not isinstance(merged[k], dict)})
    for key in ("ai_settings", "image_settings", "display_settings", "advanced_settings"):
        base = merged.get(key)
        incoming = draft.get(key)
        if isinstance(base, dict) and isinstance(incoming, dict):
            merged[key] = {**base, **incoming}
    return merged


def save_settings(db: Session, website_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise ValueError("Website not found")
    current = website.generation_settings if isinstance(website.generation_settings, dict) else {}
    merged_payload = _default_playground_settings()
    merged_payload.update({k: v for k, v in payload.items() if k in merged_payload and not isinstance(merged_payload[k], dict)})
    try:
        merged_payload["title_scale"] = max(0.7, min(1.6, float(merged_payload.get("title_scale", 1.0))))
    except (TypeError, ValueError):
        merged_payload["title_scale"] = 1.0
    try:
        merged_payload["title_padding_x"] = max(8, min(36, int(float(merged_payload.get("title_padding_x", 15)))))
    except (TypeError, ValueError):
        merged_payload["title_padding_x"] = 15
    try:
        merged_payload["line_height_multiplier"] = max(0.8, min(1.35, float(merged_payload.get("line_height_multiplier", 1.0))))
    except (TypeError, ValueError):
        merged_payload["line_height_multiplier"] = 1.0
    for key in ("ai_settings", "image_settings", "display_settings", "advanced_settings"):
        base = merged_payload.get(key)
        incoming = payload.get(key)
        if isinstance(base, dict) and isinstance(incoming, dict):
            merged_payload[key] = {**base, **incoming}

    website.generation_settings = {**current, "playground": merged_payload}
    db.commit()
    db.refresh(website)
    return merged_payload


def build_preview_metadata(
    db: Session,
    website_id: int,
    page_url: str,
    template_id: int,
    font_set_id: str | None,
    font_color: str | None,
    ai_settings_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    page = (
        db.query(Page)
        .options(joinedload(Page.images), joinedload(Page.website))
        .filter(Page.website_id == website_id, Page.url == page_url)
        .first()
    )
    if not page:
        raise ValueError("Page not found")

    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise ValueError("Template not found")

    available_images = [
        image.url
        for image in sorted(page.images, key=lambda item: item.id)
        if not image.is_excluded
    ]
    cover_image = available_images[0] if available_images else ""

    settings = page.website.generation_settings if page.website and isinstance(page.website.generation_settings, dict) else {}
    ai = settings.get("ai") if isinstance(settings.get("ai"), dict) else {}
    board_candidates = ai.get("board_candidates") if isinstance(ai.get("board_candidates"), list) else []
    board = str(board_candidates[0]).strip() if board_candidates else "General"

    title_base = (page.title or page.url).strip()
    playground_settings = settings.get("playground") if isinstance(settings.get("playground"), dict) else {}
    stored_ai_settings = playground_settings.get("ai_settings") if isinstance(playground_settings.get("ai_settings"), dict) else {}
    ai_settings = ai_settings_override if isinstance(ai_settings_override, dict) else stored_ai_settings
    ai_preview = _build_ai_preview_content(
        title_base=title_base,
        page_url=page.url,
        ai_settings=ai_settings,
    )
    ai_preview["title"] = _resolve_template_title_mode(
        title_base=title_base,
        ai_settings=ai_settings,
        fallback_title=ai_preview.get("title") or title_base,
    )

    return {
        "title": ai_preview["title"],
        "image_title": title_base,
        "description": ai_preview["description"],
        "alt_text": ai_preview["alt_text"],
        "board": board,
        "image_url": cover_image,
        "outbound_url": page.url,
        "template_name": template.name,
        "template_path": template.filename,
        "font_set_id": font_set_id,
        "font_color": font_color or "#1a1a1a",
    }
