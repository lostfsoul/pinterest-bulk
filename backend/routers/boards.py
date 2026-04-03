"""
Boards router for CSV export board naming and assignment.
"""
import re
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import AIPromptPreset, AISettings, Board, Page, PageKeyword, Website
from schemas import (
    BoardCreate,
    BoardResponse,
    BoardSuggestRequest,
    BoardSuggestResponse,
    BoardUpdate,
)

router = APIRouter()


def _normalize_source_page_ids(source_page_ids: list[int] | None) -> list[int] | None:
    if not source_page_ids:
        return None
    result: list[int] = []
    seen: set[int] = set()
    for page_id in source_page_ids:
        value = int(page_id)
        if value <= 0 or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result or None


@router.get("", response_model=list[BoardResponse])
def list_boards(website_id: int, db: Session = Depends(get_db)):
    """List boards for a website."""
    return (
        db.query(Board)
        .filter(Board.website_id == website_id)
        .order_by(Board.priority.desc(), Board.created_at.asc())
        .all()
    )


@router.post("", response_model=BoardResponse)
def create_board(payload: BoardCreate, db: Session = Depends(get_db)):
    """Create a board record."""
    website = db.query(Website).filter(Website.id == payload.website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    board = Board(
        website_id=payload.website_id,
        name=payload.name.strip(),
        source_type=payload.source_type,
        keywords=(payload.keywords or "").strip() or None,
        source_page_ids=_normalize_source_page_ids(payload.source_page_ids),
        priority=payload.priority,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.patch("/{board_id}", response_model=BoardResponse)
def update_board(board_id: int, payload: BoardUpdate, db: Session = Depends(get_db)):
    """Update a board record."""
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    if payload.name is not None:
        board.name = payload.name.strip()
    if payload.keywords is not None:
        board.keywords = (payload.keywords or "").strip() or None
    if payload.source_page_ids is not None:
        board.source_page_ids = _normalize_source_page_ids(payload.source_page_ids)
    if payload.priority is not None:
        board.priority = payload.priority
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}", status_code=204)
def delete_board(board_id: int, db: Session = Depends(get_db)):
    """Delete board."""
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    db.delete(board)
    db.commit()
    return None


def _tokenize(text: str | None) -> list[str]:
    if not text:
        return []
    cleaned = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return [tok for tok in cleaned.split() if len(tok) > 2]


STOP_TOKENS = {
    "recipe", "recipes", "easy", "best", "quick", "simple", "tips", "idea", "ideas",
    "blog", "post", "home", "page", "category", "tag", "index", "creative", "trash",
    "pan", "de", "la", "el", "los", "las", "for", "with", "and", "the", "from", "your",
}

GENERIC_SECTIONS = {"post", "page", "category", "tag", "author", "uncategorized", "unknown"}


def _sanitize_board_name(name: str | None) -> str:
    if not name:
        return ""
    cleaned = re.sub(r"\s+", " ", name).strip(" -0123456789.")
    return cleaned[:60].strip()


def _extract_slug_topic(url: str | None) -> str | None:
    if not url:
        return None
    parts = [p for p in (url or "").split("/") if p]
    if len(parts) < 2:
        return None
    slug = parts[-1].lower()
    slug = re.sub(r"[^a-z0-9-]+", "", slug).strip("-")
    if not slug:
        return None
    tokens = [tok for tok in slug.split("-") if tok and tok not in STOP_TOKENS]
    if not tokens:
        return None
    return " ".join(tokens[:3]).title()


def _extract_topics(pages: list[Page], keywords: list[PageKeyword]) -> list[str]:
    score = Counter()

    for page in pages:
        section = (page.section or "").strip().lower()
        if section and section not in GENERIC_SECTIONS:
            score[section] += 5

        slug_topic = _extract_slug_topic(page.url)
        if slug_topic:
            score[slug_topic.lower()] += 3

        for token in _tokenize(page.title):
            if token in STOP_TOKENS:
                continue
            score[token] += 1

    for item in keywords:
        weight = 4 if item.keyword_role == "selection" else 2
        for token in _tokenize(item.keyword):
            if token in STOP_TOKENS:
                continue
            score[token] += weight

    topics: list[str] = []
    for token, _ in score.most_common(40):
        label = token.replace("-", " ").strip().title()
        if len(label) < 3:
            continue
        if label.lower() in {t.lower() for t in topics}:
            continue
        topics.append(label)
    return topics


def _build_board_candidates(topics: list[str], website_name: str) -> list[str]:
    if not topics:
        return [
            f"{website_name} Recipes",
            f"{website_name} Meal Ideas",
            "Seasonal Recipes",
        ]

    candidates: list[str] = []
    drink_words = {"drink", "latte", "coffee", "tea", "lemonade", "smoothie", "juice", "cocktail"}

    for topic in topics:
        topic_words = set(_tokenize(topic))
        if topic_words & drink_words:
            candidates.append(f"{topic} Drinks")
        else:
            candidates.append(f"{topic} Recipes")
        candidates.append(f"{topic} Ideas")

    deduped: list[str] = []
    seen: set[str] = set()
    for name in candidates:
        normalized = _sanitize_board_name(name)
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)
    return deduped


@router.post("/suggest", response_model=BoardSuggestResponse)
def suggest_boards(payload: BoardSuggestRequest, db: Session = Depends(get_db)):
    """Suggest board names using AI settings/preset when available, fallback to token heuristics."""
    website = db.query(Website).filter(Website.id == payload.website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    page_query = db.query(Page).filter(Page.website_id == payload.website_id, Page.is_enabled == True)
    if payload.page_ids:
        page_query = page_query.filter(Page.id.in_(payload.page_ids))
    pages = page_query.all()
    from routers.pins import filter_pages_by_active_selection_keywords
    pages = filter_pages_by_active_selection_keywords(pages)
    page_ids = [p.id for p in pages]
    if not page_ids:
        return BoardSuggestResponse(
            website_id=payload.website_id,
            page_ids_used=[],
            suggestions=[],
        )
    keywords = (
        db.query(PageKeyword)
        .filter(PageKeyword.page_id.in_(page_ids))
        .all()
        if page_ids
        else []
    )

    ai_settings = db.query(AISettings).first()
    board_preset: AIPromptPreset | None = None
    if ai_settings and ai_settings.use_ai_by_default and ai_settings.default_board_preset_id:
        board_preset = db.query(AIPromptPreset).filter(AIPromptPreset.id == ai_settings.default_board_preset_id).first()

    suggestions: list[str] = []
    topics = _extract_topics(pages, keywords)
    topic_tokens = {tok for t in topics for tok in _tokenize(t)}
    if board_preset:
        from services.ai_generation import generate_board_name

        page_keywords_map: dict[int, list[str]] = {}
        for item in keywords:
            page_keywords_map.setdefault(item.page_id, []).append(item.keyword)

        language = ai_settings.default_language if ai_settings and ai_settings.default_language else "English"
        for page in pages[: max(payload.count * 3, payload.count)]:
            generated = generate_board_name(
                page_title=page.title,
                keywords=page_keywords_map.get(page.id, []),
                preset={
                    "prompt_template": board_preset.prompt_template,
                    "model": board_preset.model,
                    "temperature": board_preset.temperature,
                    "max_tokens": board_preset.max_tokens,
                    "language": language,
                },
                website_name=website.name,
                url=page.url,
                section=page.section or "",
                description="",
            )
            candidate = _sanitize_board_name(generated)
            # Keep AI candidate only when it matches extracted site topics.
            ai_tokens = set(_tokenize(candidate))
            if candidate and ai_tokens and (ai_tokens & topic_tokens) and candidate.lower() not in [s.lower() for s in suggestions]:
                suggestions.append(candidate)
            if len(suggestions) >= payload.count:
                break

    if len(suggestions) < payload.count:
        heuristic = _build_board_candidates(topics, website.name)
        for candidate in heuristic:
            if candidate.lower() not in [s.lower() for s in suggestions]:
                suggestions.append(candidate)
            if len(suggestions) >= payload.count:
                break

    return BoardSuggestResponse(
        website_id=payload.website_id,
        page_ids_used=page_ids,
        suggestions=suggestions[: payload.count],
    )
