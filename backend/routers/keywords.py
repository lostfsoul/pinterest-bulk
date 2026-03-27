"""
Keyword CSV upload router.
"""
import csv
import io
import re
from collections import defaultdict
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Page, PageKeyword, ImportLog, Website
from schemas import (
    KeywordUploadResponse,
    KeywordStatusResponse,
    KeywordEntryResponse,
    KeywordEntryUpdate,
)
from services.sitemap import clean_url

router = APIRouter()

MONTH_ALIASES = {
    "1": "january",
    "01": "january",
    "january": "january",
    "jan": "january",
    "2": "february",
    "02": "february",
    "february": "february",
    "feb": "february",
    "3": "march",
    "03": "march",
    "march": "march",
    "mar": "march",
    "4": "april",
    "04": "april",
    "april": "april",
    "apr": "april",
    "5": "may",
    "05": "may",
    "may": "may",
    "6": "june",
    "06": "june",
    "june": "june",
    "jun": "june",
    "7": "july",
    "07": "july",
    "july": "july",
    "jul": "july",
    "8": "august",
    "08": "august",
    "august": "august",
    "aug": "august",
    "9": "september",
    "09": "september",
    "september": "september",
    "sep": "september",
    "sept": "september",
    "10": "october",
    "october": "october",
    "oct": "october",
    "11": "november",
    "november": "november",
    "nov": "november",
    "12": "december",
    "december": "december",
    "dec": "december",
}

SEASON_ALIASES = {
    "spring": "spring",
    "summer": "summer",
    "autumn": "autumn",
    "fall": "autumn",
    "winter": "winter",
}


def normalize_period(period_type: str | None, period_value: str | None) -> tuple[str, str | None]:
    """Normalize period fields from CSV."""
    normalized_type = (period_type or "always").strip().lower()
    if not normalized_type:
        normalized_type = "always"

    if normalized_type not in {"always", "month", "season"}:
        raise ValueError("period_type must be one of: always, month, season")

    if normalized_type == "always":
        return "always", None

    value = (period_value or "").strip().lower()
    if not value:
        raise ValueError("period_value is required when period_type is month or season")

    value = re.sub(r"\s+", " ", value)
    if normalized_type == "month":
        mapped = MONTH_ALIASES.get(value)
        if not mapped:
            raise ValueError(f"Unsupported month value: {period_value}")
        return "month", mapped

    mapped = SEASON_ALIASES.get(value)
    if not mapped:
        raise ValueError(f"Unsupported season value: {period_value}")
    return "season", mapped


def split_keywords(value: str) -> list[str]:
    """Split and normalize comma-separated keywords."""
    result: list[str] = []
    for item in value.split(","):
        keyword = item.strip()
        if keyword:
            result.append(keyword)
    return result


@router.post("/upload", response_model=KeywordUploadResponse)
async def upload_keywords_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload keyword CSV file.

    Expected CSV format:
    - First row: headers (url, keywords) or (article_url, keywords)
    - Subsequent rows: url and comma-separated keywords
    """
    if not file.filename.endswith(('.csv', '.CSV')):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    # Read and parse CSV
    content = await file.read()
    csv_text = content.decode('utf-8-sig')  # Handle BOM

    f = io.StringIO(csv_text)
    reader = csv.DictReader(f)

    # Normalize headers
    fieldnames = reader.fieldnames or []
    header_map = {h.lower().strip(): h for h in fieldnames}

    # Find url and keywords columns
    url_col = next((header_map.get(h) for h in ("url", "article_url", "article url") if header_map.get(h)), None)
    keywords_col = next((header_map.get(h) for h in ("keywords", "keyword", "tags") if header_map.get(h)), None)
    period_type_col = next(
        (header_map.get(h) for h in ("period_type", "period type", "type") if header_map.get(h)),
        None,
    )
    period_value_col = next(
        (header_map.get(h) for h in ("period_value", "period value", "month", "season") if header_map.get(h)),
        None,
    )

    if not url_col or not keywords_col:
        raise HTTPException(
            status_code=400,
            detail="CSV must have 'url' and 'keywords' columns"
        )

    # Process rows
    total_rows = 0
    matched_pages = 0
    unmatched_urls: List[str] = []
    duplicates_skipped = 0
    errors: List[str] = []
    matched_page_ids: set[int] = set()
    keyword_sets: dict[tuple[int, str, str | None], set[str]] = defaultdict(set)
    keyword_sets_folded: dict[tuple[int, str, str | None], set[str]] = defaultdict(set)

    # Get all existing pages
    pages = db.query(Page).all()
    url_to_page = {clean_url(p.url): p for p in pages}

    for row in reader:
        total_rows += 1

        try:
            raw_url = row.get(url_col, '').strip()
            keywords_str = row.get(keywords_col, '').strip()
            period_type = row.get(period_type_col, "").strip() if period_type_col else "always"
            period_value = row.get(period_value_col, "").strip() if period_value_col else None

            if not raw_url:
                errors.append(f"Row {total_rows}: Empty URL")
                continue

            normalized_url = clean_url(raw_url)

            # Find matching page
            page = url_to_page.get(normalized_url)
            if not page:
                # Try exact match
                page = next((p for p in pages if p.url == raw_url), None)

            if not page:
                unmatched_urls.append(raw_url)
                continue

            normalized_type, normalized_value = normalize_period(period_type, period_value)
            incoming_keywords = split_keywords(keywords_str)

            bucket = keyword_sets[(page.id, normalized_type, normalized_value)]
            bucket_folded = keyword_sets_folded[(page.id, normalized_type, normalized_value)]
            for keyword in incoming_keywords[:10]:
                keyword_folded = keyword.casefold()
                if keyword_folded in bucket_folded:
                    duplicates_skipped += 1
                    continue
                bucket.add(keyword)
                bucket_folded.add(keyword_folded)

            matched_page_ids.add(page.id)

        except Exception as e:
            errors.append(f"Row {total_rows}: {str(e)}")

    for page_id in matched_page_ids:
        db.query(PageKeyword).filter(PageKeyword.page_id == page_id).delete()

    inserted = 0
    for (page_id, normalized_type, normalized_value), keywords in keyword_sets.items():
        for keyword in list(keywords)[:10]:
            db.add(
                PageKeyword(
                    page_id=page_id,
                    keyword=keyword,
                    period_type=normalized_type,
                    period_value=normalized_value,
                )
            )
            inserted += 1
    matched_pages = len(matched_page_ids)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # Log the import
    import_log = ImportLog(
        type="keywords",
        items_count=total_rows,
        success_count=matched_pages,
        error_count=len(errors),
        details={
            "unmatched_urls": unmatched_urls[:20],
            "errors": errors[:10],
            "inserted_keywords": inserted,
        }
    )
    db.add(import_log)
    db.commit()

    return KeywordUploadResponse(
        total_rows=total_rows,
        matched_pages=matched_pages,
        unmatched_urls=unmatched_urls[:50],  # Limit in response
        duplicates_skipped=duplicates_skipped,
        errors=errors[:10]
    )


@router.get("")
def get_keywords_status(db: Session = Depends(get_db)) -> KeywordStatusResponse:
    """Get keyword import status."""
    total_pages = db.query(Page).count()
    pages_with_keywords = (
        db.query(PageKeyword.page_id)
        .distinct()
        .count()
    )
    total_keywords = db.query(PageKeyword).count()
    by_period_type = {
        period_type: count
        for period_type, count in (
            db.query(PageKeyword.period_type, func.count(PageKeyword.id))
            .group_by(PageKeyword.period_type)
            .all()
        )
    }

    return KeywordStatusResponse(
        total_pages=total_pages,
        pages_with_keywords=pages_with_keywords,
        total_keywords=total_keywords,
        coverage_percent=round(
            (pages_with_keywords / total_pages * 100) if total_pages > 0 else 0, 1
        ),
        by_period_type=by_period_type,
    )


@router.get("/entries", response_model=list[KeywordEntryResponse])
def list_keyword_entries(
    website_id: int | None = None,
    period_type: str | None = Query(default=None, pattern="^(always|month|season)$"),
    search: str | None = None,
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """List keyword entries with page metadata for management UI."""
    query = (
        db.query(
            PageKeyword.id,
            PageKeyword.page_id,
            PageKeyword.keyword,
            PageKeyword.period_type,
            PageKeyword.period_value,
            Page.website_id,
            Website.name.label("website_name"),
            Page.title.label("page_title"),
            Page.url.label("page_url"),
        )
        .join(Page, Page.id == PageKeyword.page_id)
        .join(Website, Website.id == Page.website_id)
        .order_by(PageKeyword.id.desc())
    )

    if website_id is not None:
        query = query.filter(Page.website_id == website_id)
    if period_type:
        query = query.filter(PageKeyword.period_type == period_type)
    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(
            PageKeyword.keyword.ilike(search_term)
            | Page.title.ilike(search_term)
            | Page.url.ilike(search_term)
        )

    rows = query.limit(limit).all()
    return [
        KeywordEntryResponse(
            id=row.id,
            page_id=row.page_id,
            website_id=row.website_id,
            website_name=row.website_name,
            page_title=row.page_title,
            page_url=row.page_url,
            keyword=row.keyword,
            period_type=row.period_type,
            period_value=row.period_value,
        )
        for row in rows
    ]


@router.patch("/entries/{entry_id}", response_model=KeywordEntryResponse)
def update_keyword_entry(
    entry_id: int,
    payload: KeywordEntryUpdate,
    db: Session = Depends(get_db),
):
    """Update a keyword entry."""
    entry = db.query(PageKeyword).filter(PageKeyword.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Keyword entry not found")

    normalized_type, normalized_value = normalize_period(payload.period_type, payload.period_value)
    keyword = payload.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="Keyword cannot be empty")

    entry.keyword = keyword
    entry.period_type = normalized_type
    entry.period_value = normalized_value
    db.commit()

    row = (
        db.query(
            PageKeyword.id,
            PageKeyword.page_id,
            PageKeyword.keyword,
            PageKeyword.period_type,
            PageKeyword.period_value,
            Page.website_id,
            Website.name.label("website_name"),
            Page.title.label("page_title"),
            Page.url.label("page_url"),
        )
        .join(Page, Page.id == PageKeyword.page_id)
        .join(Website, Website.id == Page.website_id)
        .filter(PageKeyword.id == entry_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Keyword entry not found after update")

    return KeywordEntryResponse(
        id=row.id,
        page_id=row.page_id,
        website_id=row.website_id,
        website_name=row.website_name,
        page_title=row.page_title,
        page_url=row.page_url,
        keyword=row.keyword,
        period_type=row.period_type,
        period_value=row.period_value,
    )


@router.delete("/entries/{entry_id}", status_code=204)
def delete_keyword_entry(
    entry_id: int,
    db: Session = Depends(get_db),
):
    """Delete a keyword entry."""
    entry = db.query(PageKeyword).filter(PageKeyword.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Keyword entry not found")

    db.delete(entry)
    db.commit()
