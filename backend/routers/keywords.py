"""
Keyword CSV upload router.
"""
import csv
import io
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Page, PageKeyword, ImportLog
from schemas import KeywordUploadResponse
from services.sitemap import clean_url

router = APIRouter()


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
    headers = [h.lower().strip() for h in reader.fieldnames or []]

    # Find url and keywords columns
    url_col = None
    keywords_col = None

    for h in headers:
        if h in ('url', 'article_url', 'article url'):
            url_col = h
        elif h in ('keywords', 'keyword', 'tags'):
            keywords_col = h

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

    # Get all existing pages
    pages = db.query(Page).all()
    url_to_page = {clean_url(p.url): p for p in pages}

    for row in reader:
        total_rows += 1

        try:
            raw_url = row.get(url_col, '').strip()
            keywords_str = row.get(keywords_col, '').strip()

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

            # Delete existing keywords for this page
            db.query(PageKeyword).filter(PageKeyword.page_id == page.id).delete()

            # Add new keywords
            keywords = [k.strip() for k in keywords_str.split(',') if k.strip()]

            for keyword in keywords[:10]:  # Limit to 10 keywords per page
                db.add(PageKeyword(page_id=page.id, keyword=keyword))

            matched_pages += 1

        except Exception as e:
            errors.append(f"Row {total_rows}: {str(e)}")

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
            "errors": errors[:10]
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
def get_keywords_status(db: Session = Depends(get_db)):
    """Get keyword import status."""
    total_pages = db.query(Page).count()
    pages_with_keywords = (
        db.query(PageKeyword.page_id)
        .distinct()
        .count()
    )
    total_keywords = db.query(PageKeyword).count()

    return {
        "total_pages": total_pages,
        "pages_with_keywords": pages_with_keywords,
        "total_keywords": total_keywords,
        "coverage_percent": round(
            (pages_with_keywords / total_pages * 100) if total_pages > 0 else 0, 1
        )
    }
