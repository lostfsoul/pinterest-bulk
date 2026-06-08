"""
Trend keyword ranking for page selection.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Iterable

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
    period_type: str
    period_value: str | None


@dataclass
class RankedPageEntry:
    page: Page
    original_index: int
    text: str
    tokens: set[str]
    score: float
    lexical_score: float
    matched_keywords: list[str]
    priority_bucket: str
    matched_words: list[str]


def _normalize_text(value: str | None) -> str:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_token(token: str) -> str:
    """Normalize lightweight plural variants for title/keyword matching."""
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _tokenize(value: str | None) -> set[str]:
    return {_normalize_token(token) for token in _normalize_text(value).split() if token}


def _derive_active_period(now: datetime | None = None) -> tuple[str, str | None]:
    moment = now or datetime.now(UTC)
    active_month = moment.strftime("%B").lower()
    active_season = SEASON_BY_MONTH.get(active_month)
    return active_month, active_season


def _build_page_ranking_text(page: Page, seo_keywords: list[str] | None = None) -> str:
    """Return the text used for trend matching.

    Trend scheduling intentionally uses article titles only. SEO keywords are
    content-generation hints and must not create seasonal/month matches.
    """
    return _normalize_text(page.title)


def _collect_active_trends(
    trend_rows: Iterable[WebsiteTrendKeyword],
    *,
    now: datetime | None = None,
    period_type: str | None = None,
) -> list[ActiveTrendKeyword]:
    active_month, active_season = _derive_active_period(now)
    active: list[ActiveTrendKeyword] = []
    for row in trend_rows:
        keyword = (row.keyword or "").strip()
        if not keyword:
            continue
        row_period_type = (row.period_type or "always").strip().lower()
        period_value = (row.period_value or "").strip().lower()
        if period_type is not None and row_period_type != period_type:
            continue

        is_active = False
        if row_period_type == "month":
            is_active = period_value == active_month
        elif row_period_type == "season":
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
                period_type=row_period_type,
                period_value=period_value or None,
            )
        )
    return active


def _score_lexical(
    page_text: str,
    page_tokens: set[str],
    trends: list[ActiveTrendKeyword],
) -> tuple[float, list[str]]:
    """Score valid phrase matches against a title token set.

    A single shared word is intentionally rejected. A full phrase/token match is
    stronger than a two-word partial match, and trend weight is the multiplier.
    """
    if not trends:
        return 0.0, []

    best_score = 0.0
    matched_keywords: list[str] = []
    for trend in trends:
        if trend.weight <= 0:
            continue
        overlap = len(page_tokens & trend.tokens)
        if overlap < min(2, len(trend.tokens)):
            continue
        coverage = overlap / max(1, len(trend.tokens))
        exact_bonus = 0.25 if trend.normalized_keyword in page_text else 0.0
        local_score = (coverage + exact_bonus) * trend.weight
        if local_score > 0:
            matched_keywords.append(trend.keyword)
            best_score = max(best_score, local_score)

    return best_score, matched_keywords


def score_title_against_trends(
    title: str | None,
    trends: list[ActiveTrendKeyword],
) -> tuple[float, list[str], list[str]]:
    page_text = _normalize_text(title)
    page_tokens = _tokenize(page_text)
    score, matched_keywords = _score_lexical(page_text, page_tokens, trends)
    matched_words: set[str] = set()
    for trend in trends:
        if trend.keyword in matched_keywords:
            matched_words.update(page_tokens & trend.tokens)
    return score, matched_keywords, sorted(matched_words)


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
    """Rank pages by month, season, then evergreen fallback.

    SEO keywords and URL data are deliberately ignored for matching so uploaded
    SEO hints cannot force a page into a seasonal trend bucket.
    """
    if not pages:
        return [], {"ranking_applied": False, "reason": "no_pages"}

    month_trends_by_website: dict[int, list[ActiveTrendKeyword]] = {}
    season_trends_by_website: dict[int, list[ActiveTrendKeyword]] = {}
    any_active_trends = False
    for website_id in {page.website_id for page in pages}:
        trend_settings = _read_website_trend_settings(generation_settings_by_website.get(website_id, {}))
        website_enabled = bool(trend_settings.get("enabled", True))
        rows = trend_keywords_by_website.get(website_id, [])
        month_active = _collect_active_trends(rows, period_type="month") if website_enabled else []
        season_active = _collect_active_trends(rows, period_type="season") if website_enabled else []
        month_trends_by_website[website_id] = month_active
        season_trends_by_website[website_id] = season_active
        if month_active or season_active:
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

    selected_entries: list[RankedPageEntry] = []
    selected_page_ids: set[int] = set()

    def collect_bucket(bucket: str, trends_by_website: dict[int, list[ActiveTrendKeyword]]) -> None:
        bucket_entries: list[RankedPageEntry] = []
        for index, page in enumerate(pages):
            if page.id in selected_page_ids:
                continue
            page_text = _build_page_ranking_text(page)
            page_tokens = _tokenize(page_text)
            active_trends = trends_by_website.get(page.website_id, [])
            score, matched_keywords = _score_lexical(page_text, page_tokens, active_trends)
            if score <= 0:
                continue
            matched_words: set[str] = set()
            for trend in active_trends:
                if trend.keyword in matched_keywords:
                    matched_words.update(page_tokens & trend.tokens)
            bucket_entries.append(
                RankedPageEntry(
                    page=page,
                    original_index=index,
                    text=page_text,
                    tokens=page_tokens,
                    score=score,
                    lexical_score=score,
                    matched_keywords=matched_keywords,
                    priority_bucket=bucket,
                    matched_words=sorted(matched_words),
                )
            )
        bucket_entries.sort(key=lambda item: (-item.score, item.original_index))
        for entry in bucket_entries:
            selected_entries.append(entry)
            selected_page_ids.add(entry.page.id)

    collect_bucket("month", month_trends_by_website)
    collect_bucket("season", season_trends_by_website)

    for index, page in enumerate(pages):
        if page.id in selected_page_ids:
            continue
        page_text = _build_page_ranking_text(page)
        page_tokens = _tokenize(page_text)
        selected_entries.append(
            RankedPageEntry(
                page=page,
                original_index=index,
                text=page_text,
                tokens=page_tokens,
                score=0.0,
                lexical_score=0.0,
                matched_keywords=[],
                priority_bucket="evergreen",
                matched_words=[],
            )
        )

    selected_entries = selected_entries[:top_n]

    return [item.page for item in selected_entries], {
        "ranking_applied": True,
        "reason": "priority_trend_pipeline",
        "total_candidates": len(pages),
        "selected_count": len(selected_entries),
        "top_n": top_n,
        "matching_source": "title",
        "ignored_period_types": ["always"],
        "page_scores": [
            {
                "page_id": item.page.id,
                "score": round(item.score, 4),
                "bucket": item.priority_bucket,
                "matched_trends": item.matched_keywords[:5],
                "matched_words": item.matched_words[:10],
            }
            for item in selected_entries
        ],
    }
