"""
Keyword CSV upload router.
"""
import csv
import io
import re
from collections import defaultdict
from typing import List

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Page, SEOKeyword, ImportLog, Website, WebsiteTrendKeyword
from schemas import (
    KeywordUploadResponse,
    TrendKeywordUploadResponse,
    KeywordStatusResponse,
    KeywordEntryResponse,
    KeywordEntryUpdate,
)
from services.sitemap import clean_url
from services.trend_ranking import (
    _build_page_ranking_text,
    _collect_active_trends,
    _score_lexical,
    _tokenize,
)

router = APIRouter()

MONTH_ALIASES = {
    "jan": "january",
    "january": "january",
    "feb": "february",
    "february": "february",
    "mar": "march",
    "march": "march",
    "apr": "april",
    "april": "april",
    "may": "may",
    "jun": "june",
    "june": "june",
    "jul": "july",
    "july": "july",
    "aug": "august",
    "august": "august",
    "sep": "september",
    "sept": "september",
    "september": "september",
    "oct": "october",
    "october": "october",
    "nov": "november",
    "november": "november",
    "dec": "december",
    "december": "december",
}

SEASON_ALIASES = {
    "spring": "spring",
    "summer": "summer",
    "autumn": "autumn",
    "fall": "autumn",
    "winter": "winter",
}


def _normalize_trend_period(period_type: str | None, period_value: str | None) -> tuple[str, str | None]:
    normalized_type = (period_type or "always").strip().lower()
    if normalized_type not in {"always", "month", "season"}:
        raise ValueError("period_type must be one of: always, month, season")
    if normalized_type == "always":
        return "always", None

    normalized_value = re.sub(r"\s+", " ", (period_value or "").strip().lower())
    if not normalized_value:
        raise ValueError("period_value is required when period_type is month or season")
    if normalized_type == "month":
        mapped = MONTH_ALIASES.get(normalized_value)
        if not mapped:
            raise ValueError(f"Unsupported month value: {period_value}")
        return "month", mapped

    mapped = SEASON_ALIASES.get(normalized_value)
    if not mapped:
        raise ValueError(f"Unsupported season value: {period_value}")
    return "season", mapped


def split_keywords(value: str) -> list[str]:
    """Split and normalize comma-separated keywords."""
    result: list[str] = []
    seen: set[str] = set()
    for item in value.split(","):
        keyword = item.strip()
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(keyword)
    return result


@router.post("/upload", response_model=KeywordUploadResponse)
async def upload_keywords_csv(
    file: UploadFile = File(...),
    website_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
):
    """Upload keyword CSV file with columns: url, keywords."""
    if not file.filename.endswith((".csv", ".CSV")):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    if website_id is not None:
        website = db.query(Website).filter(Website.id == website_id).first()
        if not website:
            raise HTTPException(status_code=404, detail="Website not found")

    content = await file.read()
    csv_text = content.decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(csv_text))
    fieldnames = reader.fieldnames or []
    header_map = {h.lower().strip(): h for h in fieldnames}

    url_col = next((header_map.get(h) for h in ("url", "article_url", "article url") if header_map.get(h)), None)
    keywords_col = next((header_map.get(h) for h in ("keywords", "keyword", "tags") if header_map.get(h)), None)
    if not url_col or not keywords_col:
        raise HTTPException(status_code=400, detail="CSV must have 'url' and 'keywords' columns")

    pages_query = db.query(Page)
    if website_id is not None:
        pages_query = pages_query.filter(Page.website_id == website_id)
    pages = pages_query.all()
    url_to_page = {clean_url(page.url): page for page in pages}

    total_rows = 0
    unmatched_urls: List[str] = []
    duplicates_skipped = 0
    errors: List[str] = []
    matched_urls: set[str] = set()
    keyword_sets: dict[str, list[str]] = defaultdict(list)
    keyword_sets_folded: dict[str, set[str]] = defaultdict(set)

    for row in reader:
        total_rows += 1
        try:
            raw_url = (row.get(url_col) or "").strip()
            keywords_str = (row.get(keywords_col) or "").strip()

            if not raw_url:
                errors.append(f"Row {total_rows}: Empty URL")
                continue

            normalized_url = clean_url(raw_url)
            page = url_to_page.get(normalized_url)
            if not page:
                page = next((p for p in pages if p.url == raw_url), None)
            if not page:
                unmatched_urls.append(raw_url)
                continue

            matched_urls.add(page.url)
            incoming_keywords = split_keywords(keywords_str)
            for keyword in incoming_keywords:
                key = keyword.casefold()
                if key in keyword_sets_folded[page.url]:
                    duplicates_skipped += 1
                    continue
                keyword_sets_folded[page.url].add(key)
                keyword_sets[page.url].append(keyword)

        except Exception as error:
            errors.append(f"Row {total_rows}: {error}")

    inserted = 0
    for url in matched_urls:
        keywords = keyword_sets.get(url, [])[:50]
        normalized = ", ".join(keywords)
        existing = db.query(SEOKeyword).filter(SEOKeyword.url == url).first()
        if existing:
            existing.keywords = normalized
        else:
            db.add(SEOKeyword(url=url, keywords=normalized))
        inserted += 1

    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {error}")

    import_log = ImportLog(
        type="keywords",
        items_count=total_rows,
        success_count=len(matched_urls),
        error_count=len(errors),
        details={
            "unmatched_urls": unmatched_urls[:20],
            "errors": errors[:10],
            "upserted_urls": inserted,
        },
    )
    db.add(import_log)
    db.commit()

    return KeywordUploadResponse(
        total_rows=total_rows,
        matched_pages=len(matched_urls),
        unmatched_urls=unmatched_urls[:50],
        duplicates_skipped=duplicates_skipped,
        errors=errors[:10],
    )


@router.post("/trend/upload", response_model=TrendKeywordUploadResponse)
async def upload_trend_keywords_csv(
    website_id: int = Query(..., ge=1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload trend keyword CSV for a website.

    Required CSV header: keyword
    Optional headers: period_type, period_value, weight
    """
    if not file.filename or not file.filename.endswith((".csv", ".CSV")):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    content = await file.read()
    csv_text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(csv_text))
    fieldnames = reader.fieldnames or []
    header_map = {h.lower().strip(): h for h in fieldnames}

    keyword_col = next((header_map.get(h) for h in ("keyword", "trend_keyword", "trend keyword", "keywords") if header_map.get(h)), None)
    period_type_col = next((header_map.get(h) for h in ("period_type", "period type", "type") if header_map.get(h)), None)
    period_value_col = next((header_map.get(h) for h in ("period_value", "period value", "period") if header_map.get(h)), None)
    weight_col = next((header_map.get(h) for h in ("weight", "score", "priority") if header_map.get(h)), None)

    if not keyword_col:
        raise HTTPException(status_code=400, detail="CSV must have 'keyword' column")

    total_rows = 0
    inserted = 0
    updated = 0
    duplicates_skipped = 0
    errors: list[str] = []
    seen_keys: set[tuple[str, str, str | None]] = set()

    for row in reader:
        total_rows += 1
        try:
            keyword = str(row.get(keyword_col) or "").strip()
            if not keyword:
                errors.append(f"Row {total_rows}: Empty keyword")
                continue

            period_type_raw = str(row.get(period_type_col) or "always").strip() if period_type_col else "always"
            period_value_raw = str(row.get(period_value_col) or "").strip() if period_value_col else ""
            period_type, period_value = _normalize_trend_period(period_type_raw, period_value_raw)

            raw_weight = str(row.get(weight_col) or "1").strip() if weight_col else "1"
            try:
                weight = float(raw_weight)
            except ValueError:
                errors.append(f"Row {total_rows}: Invalid weight '{raw_weight}'")
                continue
            weight = max(0.0, min(10.0, weight))

            dedupe_key = (keyword.casefold(), period_type, (period_value or "").casefold() or None)
            if dedupe_key in seen_keys:
                duplicates_skipped += 1
                continue
            seen_keys.add(dedupe_key)

            existing = (
                db.query(WebsiteTrendKeyword)
                .filter(
                    WebsiteTrendKeyword.website_id == website_id,
                    WebsiteTrendKeyword.keyword == keyword,
                    WebsiteTrendKeyword.period_type == period_type,
                    WebsiteTrendKeyword.period_value == period_value,
                )
                .first()
            )
            if existing:
                existing.weight = weight
                updated += 1
            else:
                db.add(
                    WebsiteTrendKeyword(
                        website_id=website_id,
                        keyword=keyword,
                        period_type=period_type,
                        period_value=period_value,
                        weight=weight,
                    )
                )
                inserted += 1
        except ValueError as error:
            errors.append(f"Row {total_rows}: {error}")
        except Exception as error:
            errors.append(f"Row {total_rows}: {error}")

    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {error}")

    import_log = ImportLog(
        type="trend_keywords",
        items_count=total_rows,
        success_count=inserted + updated,
        error_count=len(errors),
        details={
            "website_id": website_id,
            "inserted": inserted,
            "updated": updated,
            "duplicates_skipped": duplicates_skipped,
            "errors": errors[:10],
        },
    )
    db.add(import_log)
    db.commit()

    return TrendKeywordUploadResponse(
        total_rows=total_rows,
        inserted=inserted,
        updated=updated,
        duplicates_skipped=duplicates_skipped,
        errors=errors[:10],
    )


@router.get("")
def get_keywords_status(
    website_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> KeywordStatusResponse:
    """Get keyword status."""
    pages_query = db.query(Page)
    if website_id is not None:
        pages_query = pages_query.filter(Page.website_id == website_id)
    pages = pages_query.all()
    total_pages = len(pages)
    page_urls = [page.url for page in pages]
    if not page_urls:
        return KeywordStatusResponse(
            total_pages=0,
            pages_with_keywords=0,
            total_keywords=0,
            coverage_percent=0,
        )

    rows = (
        db.query(SEOKeyword.keywords)
        .filter(SEOKeyword.url.in_(page_urls))
        .all()
    )

    pages_with_keywords = 0
    total_keywords = 0
    for (keywords_value,) in rows:
        tokens = [item.strip() for item in (keywords_value or "").split(",") if item.strip()]
        if tokens:
            pages_with_keywords += 1
            total_keywords += len(tokens)

    coverage_percent = round((pages_with_keywords / total_pages * 100) if total_pages > 0 else 0, 1)
    return KeywordStatusResponse(
        total_pages=total_pages,
        pages_with_keywords=pages_with_keywords,
        total_keywords=total_keywords,
        coverage_percent=coverage_percent,
    )


@router.get("/entries", response_model=list[KeywordEntryResponse])
def list_keyword_entries(
    website_id: int = Query(..., ge=1),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """List SEO keyword entries for a selected website."""
    rows = (
        db.query(SEOKeyword.url, SEOKeyword.keywords)
        .join(Page, Page.url == SEOKeyword.url)
        .filter(Page.website_id == website_id)
        .order_by(Page.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        KeywordEntryResponse(
            url=row.url,
            keywords=row.keywords,
        )
        for row in rows
    ]


@router.patch("/entries", response_model=KeywordEntryResponse)
def update_keyword_entry(
    payload: KeywordEntryUpdate,
    db: Session = Depends(get_db),
):
    """Update SEO keywords for a URL."""
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    keywords = split_keywords(payload.keywords)
    if not keywords:
        raise HTTPException(status_code=400, detail="Keywords cannot be empty")

    normalized_keywords = ", ".join(keywords)
    entry = db.query(SEOKeyword).filter(SEOKeyword.url == url).first()
    if entry:
        entry.keywords = normalized_keywords
    else:
        db.add(SEOKeyword(url=url, keywords=normalized_keywords))

    db.commit()
    return KeywordEntryResponse(url=url, keywords=normalized_keywords)


@router.delete("/entries", status_code=204)
def delete_keyword_entry(
    url: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Delete SEO keywords for a URL."""
    normalized_url = url.strip()
    if not normalized_url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    entry = db.query(SEOKeyword).filter(SEOKeyword.url == normalized_url).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Keyword entry not found")

    db.delete(entry)
    db.commit()


@router.get("/trend/match-preview")
def get_trend_match_preview(
    website_id: int = Query(..., ge=1),
    pages_per_keyword: int = Query(default=5, ge=1, le=20),
    min_score: float = Query(default=0.2, ge=0.0, le=10.0),
    db: Session = Depends(get_db),
):
    """Preview matching enabled pages for each active trend keyword."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    pages = (
        db.query(Page)
        .filter(Page.website_id == website_id, Page.is_enabled == True)  # noqa: E712
        .order_by(Page.created_at.desc())
        .all()
    )
    if not pages:
        return {"website_id": website_id, "items": []}

    seo_rows = db.query(SEOKeyword.url, SEOKeyword.keywords).filter(
        SEOKeyword.url.in_([page.url for page in pages])
    ).all()
    seo_map = {
        row.url: split_keywords(row.keywords or "")
        for row in seo_rows
    }

    trend_rows = (
        db.query(WebsiteTrendKeyword)
        .filter(WebsiteTrendKeyword.website_id == website_id)
        .order_by(WebsiteTrendKeyword.created_at.desc(), WebsiteTrendKeyword.id.desc())
        .all()
    )
    active_trends = _collect_active_trends(trend_rows)
    if not active_trends:
        return {"website_id": website_id, "items": []}

    page_vectors = []
    for page in pages:
        text = _build_page_ranking_text(page, seo_map.get(page.url, []))
        page_vectors.append((page, text, _tokenize(text)))

    items: list[dict] = []
    for trend in active_trends:
        matched_pages: list[dict] = []
        for page, text, tokens in page_vectors:
            score, _ = _score_lexical(text, tokens, [trend])
            if score < float(min_score):
                continue
            matched_pages.append(
                {
                    "page_id": page.id,
                    "url": page.url,
                    "title": page.title or page.url,
                    "score": round(float(score), 4),
                }
            )

        matched_pages.sort(key=lambda row: (-row["score"], row["url"]))
        items.append(
            {
                "keyword": trend.keyword,
                "weight": round(float(trend.weight), 4),
                "matched_count": len(matched_pages),
                "matched_pages": matched_pages[:pages_per_keyword],
            }
        )

    items.sort(key=lambda row: (-row["matched_count"], row["keyword"]))
    return {"website_id": website_id, "items": items}
