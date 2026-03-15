"""
Image scraping and management router.
"""
import os
import re
from typing import List
from datetime import datetime
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, case
from sqlalchemy.orm import Session
import httpx

from database import get_db
from models import Page, PageImage, Website
from schemas import (
    PageImageResponse,
    PageWithImages,
    PageImageUpdate,
    ImagePageSummary,
    ImageBatchScrapeRequest,
    ImageBatchScrapeResponse,
)

router = APIRouter()

# User agent for scraping
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PinterestCSVTool/1.0; +https://github.com/pinterest-csv-tool)"
}


async def scrape_page_images(page_url: str) -> List[str]:
    """Scrape image URLs from a page."""
    image_urls = []

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=HEADERS) as client:
            response = await client.get(page_url)
            response.raise_for_status()
            html = response.text

            # Extract from <img> tags
            img_pattern = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
            for match in img_pattern.finditer(html):
                url = match.group(1)
                # Convert relative URLs to absolute
                if url.startswith("//"):
                    url = "https:" + url
                elif url.startswith("/"):
                    parsed = urlparse(page_url)
                    url = f"{parsed.scheme}://{parsed.netloc}{url}"
                elif not url.startswith(("http://", "https://")):
                    url = urljoin(page_url, url)

                # Filter out small images and common non-content images
                if not any(bad in url.lower() for bad in [
                    "icon", "logo", "avatar", "button", "spinner",
                    "tracking", "pixel", "1x1", "ad.", "banner"
                ]):
                    image_urls.append(url)

            # Extract from Open Graph
            og_pattern = re.compile(
                r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
                re.IGNORECASE
            )
            for match in og_pattern.finditer(html):
                image_urls.insert(0, match.group(1))  # Prioritize OG images

            # Extract from Twitter Card
            twitter_pattern = re.compile(
                r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
                re.IGNORECASE
            )
            for match in twitter_pattern.finditer(html):
                image_urls.insert(0, match.group(1))

    except Exception as e:
        print(f"Error scraping {page_url}: {e}")

    # Deduplicate while preserving order
    seen = set()
    unique_urls = []
    for url in image_urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)

    return unique_urls[:20]  # Limit to 20 images per page


def derive_section(page_url: str) -> str:
    """Derive a coarse section/category from the URL path."""
    path_parts = [part for part in urlparse(page_url).path.split("/") if part]
    if not path_parts:
        return "home"

    for part in path_parts:
        normalized = part.lower()
        if normalized.isdigit():
            continue
        if re.fullmatch(r"\d{4}", normalized):
            continue
        if re.fullmatch(r"\d{1,2}", normalized):
            continue
        return normalized.replace("-", " ")

    return path_parts[0].lower().replace("-", " ")


@router.post("/pages/{page_id}/scrape", response_model=List[PageImageResponse])
async def scrape_page(
    page_id: int,
    db: Session = Depends(get_db),
):
    """Scrape images from a page."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Clear existing images
    db.query(PageImage).filter(PageImage.page_id == page_id).delete()

    # Scrape new images
    image_urls = await scrape_page_images(page.url)

    # Create database records
    images = []
    for url in image_urls:
        img = PageImage(page_id=page_id, url=url, is_excluded=False)
        db.add(img)
        images.append(img)

    # Update page scraped_at timestamp
    page.scraped_at = datetime.utcnow()

    db.commit()

    for img in images:
        db.refresh(img)

    return images


@router.get("/pages", response_model=List[ImagePageSummary])
def list_image_pages(
    website_id: int | None = None,
    scrape_status: str = "all",
    search: str | None = None,
    section: str | None = None,
    db: Session = Depends(get_db),
):
    """List all pages with image scrape inventory metadata."""
    query = (
        db.query(
            Page.id,
            Page.website_id,
            Website.name.label("website_name"),
            Page.url,
            Page.title,
            Page.section,
            Page.is_enabled,
            Page.scraped_at,
            Page.created_at,
            func.count(PageImage.id).label("images_total"),
            func.sum(case((PageImage.is_excluded == False, 1), else_=0)).label("images_available"),
            func.sum(case((PageImage.is_excluded == True, 1), else_=0)).label("images_excluded"),
        )
        .join(Website, Website.id == Page.website_id)
        .outerjoin(PageImage, PageImage.page_id == Page.id)
        .group_by(Page.id, Website.name)
        .order_by(Website.name.asc(), Page.created_at.desc())
    )

    query = query.filter(Page.is_enabled == True)

    if website_id is not None:
        query = query.filter(Page.website_id == website_id)

    if scrape_status == "pending":
        query = query.filter(Page.scraped_at == None)
    elif scrape_status == "scraped":
        query = query.filter(Page.scraped_at != None)

    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(
            Page.url.ilike(search_term) | Page.title.ilike(search_term)
        )

    results = []
    for row in query.all():
        page_section = row.section or derive_section(row.url)
        if section and page_section != section:
            continue

        results.append(
            ImagePageSummary(
                id=row.id,
                website_id=row.website_id,
                website_name=row.website_name,
                url=row.url,
                title=row.title,
                is_enabled=row.is_enabled,
                scraped_at=row.scraped_at,
                created_at=row.created_at,
                section=page_section,
                images_total=row.images_total or 0,
                images_available=row.images_available or 0,
                images_excluded=row.images_excluded or 0,
            )
        )

    return results


@router.get("/proxy")
async def proxy_image(url: str):
    """Proxy remote images so frontend canvas preview avoids CORS issues."""
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=HEADERS) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            return Response(content=response.content, media_type=content_type)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Failed to proxy image: {error}")


@router.post("/pages/scrape", response_model=ImageBatchScrapeResponse)
async def scrape_pages_batch(
    request: ImageBatchScrapeRequest,
    db: Session = Depends(get_db),
):
    """Scrape images for multiple pages."""
    if not request.page_ids:
        raise HTTPException(status_code=400, detail="No page ids provided")

    pages = (
        db.query(Page)
        .filter(Page.id.in_(request.page_ids), Page.is_enabled == True)
        .all()
    )

    errors = []
    scraped = 0
    for page in pages:
        try:
            db.query(PageImage).filter(PageImage.page_id == page.id).delete()
            image_urls = await scrape_page_images(page.url)
            for url in image_urls:
                db.add(PageImage(page_id=page.id, url=url, is_excluded=False))
            page.scraped_at = datetime.utcnow()
            db.commit()
            scraped += 1
        except Exception as error:
            db.rollback()
            errors.append(f"{page.id}: {error}")

    return ImageBatchScrapeResponse(
        total=len(request.page_ids),
        scraped=scraped,
        failed=len(request.page_ids) - scraped,
        errors=errors,
    )


@router.get("/pages/{page_id}/images", response_model=List[PageImageResponse])
def get_page_images(page_id: int, db: Session = Depends(get_db)):
    """Get images for a page."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    return db.query(PageImage).filter(PageImage.page_id == page_id).all()


@router.patch("/images/{image_id}", response_model=PageImageResponse)
def update_image(
    image_id: int,
    update: PageImageUpdate,
    db: Session = Depends(get_db),
):
    """Update image exclude status."""
    image = db.query(PageImage).filter(PageImage.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    image.is_excluded = update.is_excluded
    db.commit()
    db.refresh(image)
    return image


@router.get("/pending")
def get_pending_pages(db: Session = Depends(get_db)):
    """Get pages that haven't been scraped yet."""
    pages = (
        db.query(Page)
        .filter(
            Page.is_enabled == True,
            Page.scraped_at == None
        )
        .order_by(Page.created_at.desc())
        .limit(50)
        .all()
    )

    return [
        {
            "id": p.id,
            "url": p.url,
            "title": p.title,
            "website_id": p.website_id,
        }
        for p in pages
    ]


@router.get("/stats")
def get_image_stats(db: Session = Depends(get_db)):
    """Get image statistics."""
    total = db.query(PageImage).count()
    excluded = db.query(PageImage).filter(PageImage.is_excluded == True).count()

    return {
        "total": total,
        "excluded": excluded,
        "available": total - excluded,
    }
