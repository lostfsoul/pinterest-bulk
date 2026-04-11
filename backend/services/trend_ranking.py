"""
Trend keyword ranking for page selection.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable
from urllib.parse import urlparse

from models import Page, WebsiteTrendKeyword


SEASON_BY_MONTH = {
    "january": "winter",
    "february": "winter",
    "march": "spring",
    "april": "spring",
    "may": "spring",
    "june": "summer",
    "july": "summer",
    "august": "summer",
    "september": "autumn",
    "october": "autumn",
    "november": "autumn",
    "december": "winter",
}


@dataclass
class ActiveTrendKeyword:
    keyword: str
    normalized_keyword: str
    tokens: set[str]
    weight: float


@dataclass
class RankedPageEntry:
    page: Page
    original_index: int
    text: str
    tokens: set[str]
    score: float
    lexical_score: float
    matched_keywords: list[str]


def _normalize_text(value: str | None) -> str:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokenize(value: str | None) -> set[str]:
    return {token for token in _normalize_text(value).split() if token}


def _slug_from_url(url: str | None) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        slug = parsed.path.rstrip("/").split("/")[-1]
        return _normalize_text(slug)
    except Exception:
        return _normalize_text(url)


def _derive_active_period(now: datetime | None = None) -> tuple[str, str | None]:
    moment = now or datetime.utcnow()
    active_month = moment.strftime("%B").lower()
    active_season = SEASON_BY_MONTH.get(active_month)
    return active_month, active_season


def _build_page_ranking_text(page: Page, seo_keywords: list[str]) -> str:
    parts = [
        _normalize_text(page.title),
        _normalize_text(page.section),
        _slug_from_url(page.url),
        _normalize_text(" ".join(seo_keywords)),
    ]
    return " ".join(part for part in parts if part).strip()


def _collect_active_trends(
    trend_rows: Iterable[WebsiteTrendKeyword],
    *,
    now: datetime | None = None,
) -> list[ActiveTrendKeyword]:
    active_month, active_season = _derive_active_period(now)
    active: list[ActiveTrendKeyword] = []
    for row in trend_rows:
        keyword = (row.keyword or "").strip()
        if not keyword:
            continue
        period_type = (row.period_type or "always").strip().lower()
        period_value = (row.period_value or "").strip().lower()

        is_active = period_type == "always"
        if period_type == "month":
            is_active = period_value == active_month
        elif period_type == "season":
            is_active = bool(active_season and period_value == active_season)

        if not is_active:
            continue
        normalized_keyword = _normalize_text(keyword)
        tokens = _tokenize(keyword)
        if not normalized_keyword or not tokens:
            continue
        weight = float(row.weight if row.weight is not None else 1.0)
        active.append(
            ActiveTrendKeyword(
                keyword=keyword,
                normalized_keyword=normalized_keyword,
                tokens=tokens,
                weight=max(0.0, weight),
            )
        )
    return active


def _score_lexical(page_text: str, page_tokens: set[str], trends: list[ActiveTrendKeyword]) -> tuple[float, list[str]]:
    if not trends:
        return 0.0, []

    total_weight = 0.0
    weighted_score = 0.0
    matched_keywords: list[str] = []
    for trend in trends:
        if trend.weight <= 0:
            continue
        total_weight += trend.weight
        overlap = len(page_tokens & trend.tokens)
        overlap_ratio = overlap / max(1, len(trend.tokens))
        exact_bonus = 1.0 if trend.normalized_keyword in page_text else 0.0
        local_score = max(overlap_ratio, exact_bonus)
        if local_score > 0:
            matched_keywords.append(trend.keyword)
        weighted_score += trend.weight * local_score

    if total_weight <= 0:
        return 0.0, []
    return weighted_score / total_weight, matched_keywords


def _score_semantic(
    entries: list[RankedPageEntry],
    trends: list[ActiveTrendKeyword],
    *,
    enabled: bool,
) -> dict[int, float]:
    if not enabled or not trends or not entries:
        return {}

    # Placeholder hook for future embedding integration.
    provider = (os.getenv("TREND_SEMANTIC_PROVIDER", "") or "").strip().lower()
    if provider not in {"openai", "local"}:
        return {}

    return {}


def _jaccard_similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = len(a | b)
    if union == 0:
        return 0.0
    return len(a & b) / union


def _select_with_diversity(
    ranked_entries: list[RankedPageEntry],
    *,
    top_n: int,
    diversity_penalty: float,
) -> list[RankedPageEntry]:
    if top_n <= 0 or not ranked_entries:
        return []

    selected: list[RankedPageEntry] = []
    remaining = ranked_entries[:]
    while remaining and len(selected) < top_n:
        best_index = 0
        best_adjusted = -1.0
        for index, entry in enumerate(remaining):
            similarity_penalty = 0.0
            if selected:
                similarity_penalty = max(
                    _jaccard_similarity(entry.tokens, chosen.tokens)
                    for chosen in selected
                )
            adjusted = entry.score - (diversity_penalty * similarity_penalty)
            if adjusted > best_adjusted:
                best_adjusted = adjusted
                best_index = index
        selected.append(remaining.pop(best_index))
    return selected


def _read_website_trend_settings(settings: dict | None) -> dict:
    if not isinstance(settings, dict):
        return {}
    trend = settings.get("trend")
    if isinstance(trend, dict):
        return trend
    return {}


def rank_pages_for_trends(
    pages: list[Page],
    *,
    trend_keywords_by_website: dict[int, list[WebsiteTrendKeyword]],
    generation_settings_by_website: dict[int, dict],
    seo_keywords_by_url: dict[str, list[str]] | None = None,
    top_n_override: int | None = None,
    similarity_threshold_override: float | None = None,
    diversity_enabled_override: bool | None = None,
    diversity_penalty_override: float | None = None,
    semantic_enabled_override: bool | None = None,
) -> tuple[list[Page], dict]:
    """Rank and select pages based on active trend keywords."""
    if not pages:
        return [], {"ranking_applied": False, "reason": "no_pages"}

    active_trends_by_website: dict[int, list[ActiveTrendKeyword]] = {}
    any_active_trends = False
    for website_id in {page.website_id for page in pages}:
        trend_settings = _read_website_trend_settings(generation_settings_by_website.get(website_id, {}))
        website_enabled = bool(trend_settings.get("enabled", True))
        active = _collect_active_trends(trend_keywords_by_website.get(website_id, [])) if website_enabled else []
        active_trends_by_website[website_id] = active
        if active:
            any_active_trends = True

    if not any_active_trends:
        return pages, {
            "ranking_applied": False,
            "reason": "no_active_trends",
            "total_candidates": len(pages),
            "selected_count": len(pages),
        }

    website_ids = {page.website_id for page in pages}
    single_website_id = next(iter(website_ids)) if len(website_ids) == 1 else None
    default_settings = _read_website_trend_settings(
        generation_settings_by_website.get(single_website_id, {}) if single_website_id is not None else {}
    )

    if top_n_override is not None:
        top_n = max(1, int(top_n_override))
    else:
        setting_top_n = int(default_settings.get("top_n", 0) or 0)
        top_n = setting_top_n if setting_top_n > 0 else len(pages)
    top_n = min(top_n, len(pages))

    if similarity_threshold_override is not None:
        threshold = max(0.0, min(1.0, float(similarity_threshold_override)))
    else:
        threshold = max(0.0, min(1.0, float(default_settings.get("similarity_threshold", 0.0) or 0.0)))

    if diversity_enabled_override is not None:
        diversity_enabled = bool(diversity_enabled_override)
    else:
        diversity_enabled = bool(default_settings.get("diversity_enabled", False))

    if diversity_penalty_override is not None:
        diversity_penalty = float(diversity_penalty_override)
    else:
        diversity_penalty = float(default_settings.get("diversity_penalty", 0.15) or 0.15)
    diversity_penalty = max(0.0, min(1.0, diversity_penalty))

    if semantic_enabled_override is not None:
        semantic_enabled = bool(semantic_enabled_override)
    else:
        semantic_enabled = bool(default_settings.get("semantic_enabled", False))

    ranked_entries: list[RankedPageEntry] = []
    seo_lookup = seo_keywords_by_url or {}
    for index, page in enumerate(pages):
        page_text = _build_page_ranking_text(page, seo_lookup.get(page.url, []))
        page_tokens = _tokenize(page_text)
        active_trends = active_trends_by_website.get(page.website_id, [])
        lexical_score, matched_keywords = _score_lexical(page_text, page_tokens, active_trends)
        ranked_entries.append(
            RankedPageEntry(
                page=page,
                original_index=index,
                text=page_text,
                tokens=page_tokens,
                score=lexical_score,
                lexical_score=lexical_score,
                matched_keywords=matched_keywords,
            )
        )

    semantic_scores = _score_semantic(
        ranked_entries,
        [item for items in active_trends_by_website.values() for item in items],
        enabled=semantic_enabled,
    )
    if semantic_scores:
        for entry in ranked_entries:
            semantic_score = semantic_scores.get(entry.page.id)
            if semantic_score is None:
                continue
            entry.score = (entry.lexical_score * 0.7) + (float(semantic_score) * 0.3)

    ranked_entries.sort(key=lambda item: (-item.score, item.original_index))
    threshold_pool = [item for item in ranked_entries if item.score >= threshold]
    if len(threshold_pool) >= top_n:
        candidate_pool = threshold_pool
    else:
        candidate_pool = ranked_entries

    if diversity_enabled:
        selected_entries = _select_with_diversity(
            candidate_pool,
            top_n=top_n,
            diversity_penalty=diversity_penalty,
        )
    else:
        selected_entries = candidate_pool[:top_n]

    return [item.page for item in selected_entries], {
        "ranking_applied": True,
        "reason": "active_trends",
        "total_candidates": len(pages),
        "selected_count": len(selected_entries),
        "top_n": top_n,
        "threshold": threshold,
        "diversity_enabled": diversity_enabled,
        "diversity_penalty": diversity_penalty,
        "semantic_enabled": semantic_enabled,
        "page_scores": [
            {
                "page_id": item.page.id,
                "score": round(item.score, 4),
                "matched_trends": item.matched_keywords[:5],
            }
            for item in selected_entries
        ],
    }
