"""
Keyword CSV upload router.
"""
import csv
import io
from collections import defaultdict
from typing import List

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Page, SEOKeyword, ImportLog
from schemas import (
    KeywordUploadResponse,
    KeywordStatusResponse,
    KeywordEntryResponse,
    KeywordEntryUpdate,
)
from services.sitemap import clean_url

router = APIRouter()


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
    db: Session = Depends(get_db),
):
    """Upload keyword CSV file with columns: url, keywords."""
    if not file.filename.endswith((".csv", ".CSV")):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()
    csv_text = content.decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(csv_text))
    fieldnames = reader.fieldnames or []
    header_map = {h.lower().strip(): h for h in fieldnames}

    url_col = next((header_map.get(h) for h in ("url", "article_url", "article url") if header_map.get(h)), None)
    keywords_col = next((header_map.get(h) for h in ("keywords", "keyword", "tags") if header_map.get(h)), None)
    if not url_col or not keywords_col:
        raise HTTPException(status_code=400, detail="CSV must have 'url' and 'keywords' columns")

    pages = db.query(Page).all()
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


@router.get("")
def get_keywords_status(db: Session = Depends(get_db)) -> KeywordStatusResponse:
    """Get keyword status."""
    total_pages = db.query(Page).count()
    rows = db.query(SEOKeyword.keywords).all()

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
