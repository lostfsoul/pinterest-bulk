"""
Image scraping and management router.
"""
import os
import re
from dataclasses import dataclass
from typing import List
from datetime import datetime
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, case
from sqlalchemy.orm import Session
import httpx

from database import get_db
from models import Page, PageImage, PageKeyword, Website, GlobalExcludedImage
from schemas import (
    PageImageResponse,
    PageWithImages,
    PageImageUpdate,
    ImagePageSummary,
    ImageBatchScrapeRequest,
    ImageBatchScrapeResponse,
    GlobalExcludedImageResponse,
    GlobalExcludedImageCreate,
    GlobalExcludedImageApplyResponse,
)
from services.image_metadata import fetch_image_metadata, is_hq_image
from services.image_classifier import classify_image, should_auto_exclude, ImageCategory
from services.global_exclusion import check_global_exclusion, apply_exclusion_to_images, recompute_global_exclusions

router = APIRouter()

# User agent for scraping
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PinterestCSVTool/1.0; +https://github.com/pinterest-csv-tool)"
}


@dataclass
class ImageScrapeResult:
    """Result of scraping a single image."""
    url: str
    is_wp_content_image: bool = False  # WordPress content area image (wp-block-image, etc.)
    html_width: int | None = None  # Width from HTML attribute
    html_height: int | None = None  # Height from HTML attribute


def is_wordpress_content_image(parent_classes: str, img_tag: str) -> bool:
    """Check if an img tag is inside a WordPress content block like wp-block-image."""
    # Combine parent classes and img tag for checking
    combined = (parent_classes + " " + img_tag).lower()

    wordpress_content_patterns = [
        r'wp-block-',  # Any WordPress block (wp-block-image, wp-block-kadence-image, etc.)
        r'wp-image-',  # WordPress media library images
        r'wp-post-image',  # WordPress post featured image
        r'attachment-',  # WordPress attachments
        r'alignnone',
        r'aligncenter',
        r'alignwide',
        r'alignfull',
        r'ns-pinterest',  # Pinterest-related images in content
    ]

    return any(re.search(pattern, combined) for pattern in wordpress_content_patterns)


def extract_html_dimensions(img_tag: str) -> tuple[int | None, int | None]:
    """Extract width and height from an img tag's attributes."""
    width_match = re.search(r'width=["\'](\d+)["\']', img_tag, re.IGNORECASE)
    height_match = re.search(r'height=["\'](\d+)["\']', img_tag, re.IGNORECASE)

    width = int(width_match.group(1)) if width_match else None
    height = int(height_match.group(1)) if height_match else None

    return width, height


def extract_main_content(html: str) -> str:
    """Extract only the main article content from HTML, excluding related posts, navigation, etc.

    For WordPress sites, finds the main entry-content div and excludes:
    - entry-related / related posts sections
    - post-navigation
    - comments
    - footer
    """
    # Try to find main content area in WordPress
    # Pattern: entry-content single-content or entry-content

    # Find the start of main content
    content_start_patterns = [
        r'<div[^>]*class=[^>]*entry-content[^>]*>',  # <div class="entry-content...">
        r'<div[^>]*class=[^>]*post-content[^>]*>',
        r'<article[^>]*>',
    ]

    content_start = None
    for pattern in content_start_patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            content_start = match.start()
            break

    if content_start is None:
        # If no content area found, use entire HTML
        return html

    # Find the end of main content
    # Look for the closing of entry-content div or start of related posts
    content_end_patterns = [
        r'</div><!-- \.entry-content -->',  # WordPress specific closing
        r'<div[^>]*class=[^>]*entry-related[^>]*>',  # Related posts start
        r'<nav[^>]*class=[^>]*post-navigation[^>]*>',  # Post navigation
        r'<section[^>]*class=[^>]*comments[^>]*>',  # Comments section
        r'<footer[^>]*>',  # Footer
    ]

    content_end = len(html)
    for pattern in content_end_patterns:
        match = re.search(pattern, html[content_start:], re.IGNORECASE)
        if match:
            end_pos = content_start + match.start()
            if end_pos < content_end:
                content_end = end_pos

    return html[content_start:content_end]


async def scrape_page_images(page_url: str) -> List[ImageScrapeResult]:
    """Scrape image URLs from a page with metadata about their source."""
    image_results: List[ImageScrapeResult] = []
    seen_urls: set[str] = set()

    def process_img_tag(url: str, parent_classes: str = "", img_tag: str = "", skip_seen: bool = False) -> ImageScrapeResult | None:
        """Process an image URL and return ImageScrapeResult if valid."""
        # Convert relative URLs to absolute
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            parsed = urlparse(page_url)
            url = f"{parsed.scheme}://{parsed.netloc}{url}"
        elif not url.startswith(("http://", "https://")):
            url = urljoin(page_url, url)

        # Skip if already processed (unless skip_seen is True for OG images)
        if not skip_seen and url in seen_urls:
            return None
        seen_urls.add(url)

        # Filter out small images and common non-content images
        if any(bad in url.lower() for bad in [
            "icon", "logo", "avatar", "button", "spinner",
            "tracking", "pixel", "1x1", "ad.", "banner"
        ]):
            return None

        # Extract dimensions from HTML
        html_width, html_height = extract_html_dimensions(img_tag)

        # Check if WordPress content image
        is_wp_content = is_wordpress_content_image(parent_classes, img_tag)

        return ImageScrapeResult(
            url=url,
            is_wp_content_image=is_wp_content,
            html_width=html_width,
            html_height=html_height
        )

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=HEADERS) as client:
            response = await client.get(page_url)
            response.raise_for_status()
            html = response.text

            # Extract only the main article content (exclude related posts, navigation, etc.)
            main_content = extract_main_content(html)

            # Method 1: Match figure/div with class containing img (handles nested spans)
            # This captures figure/div/span with class before img, including deeply nested
            img_pattern_nested = re.compile(
                r'<((?:figure|div|p|span)[^>]*)>.*?<img([^>]*)>',
                re.IGNORECASE | re.DOTALL
            )
            for match in img_pattern_nested.finditer(main_content):
                opening_tag = match.group(1)  # e.g., 'figure class="wp-block-image"'
                img_tag = match.group(2)  # e.g., ' src="..." width="960" height="1200"'

                # Extract class/id from opening tag
                class_match = re.search(r'class=["\']([^"\']*)["\']', opening_tag, re.IGNORECASE)
                parent_classes = class_match.group(1) if class_match else ""

                # Extract src from img tag - prefer data-src for lazy-loaded images
                # data-src contains the actual full-res image URL, src often has a placeholder
                data_src_match = re.search(r'data-src=["\']([^"\']*)["\']', img_tag, re.IGNORECASE)
                if data_src_match:
                    url = data_src_match.group(1)
                else:
                    src_match = re.search(r'src=["\']([^"\']*)["\']', img_tag, re.IGNORECASE)
                    if not src_match:
                        continue
                    url = src_match.group(1)

                result = process_img_tag(url, parent_classes, img_tag)
                if result:
                    image_results.append(result)

    except Exception as e:
        print(f"Error scraping {page_url}: {e}")

    # Deduplicate while preserving order (keep first occurrence which has more context)
    seen = set()
    unique_results = []
    for img_result in image_results:
        if img_result.url not in seen:
            seen.add(img_result.url)
            unique_results.append(img_result)

    return unique_results[:20]  # Limit to 20 images per page


async def scrape_page_into_db(
    page: Page,
    db: Session,
    global_rules: list[GlobalExcludedImage] | None = None,
) -> list[PageImage]:
    """Scrape a page and persist its images with classification metadata."""
    db.query(PageImage).filter(PageImage.page_id == page.id).delete()

    rules = global_rules if global_rules is not None else db.query(GlobalExcludedImage).all()
    scrape_results = await scrape_page_images(page.url)

    images: list[PageImage] = []
    for result in scrape_results:
        metadata = await fetch_image_metadata(result.url)

        if metadata.width is None and result.html_width:
            metadata.width = result.html_width
        if metadata.height is None and result.html_height:
            metadata.height = result.html_height

        classification = classify_image(
            result.url,
            metadata,
            is_wp_content_image=result.is_wp_content_image,
        )

        exclusion_match = check_global_exclusion(result.url, rules)
        excluded_by_global = exclusion_match.matched

        should_exclude, _ = should_auto_exclude(
            result.url,
            classification.category,
            metadata,
            excluded_by_global,
        )

        hq = is_hq_image(metadata, result.url)

        img = PageImage(
            page_id=page.id,
            url=result.url,
            is_excluded=should_exclude,
            width=metadata.width,
            height=metadata.height,
            file_size=metadata.file_size,
            mime_type=metadata.mime_type,
            format=metadata.format,
            is_article_image=classification.is_article_image,
            is_hq=hq,
            category=classification.category,
            excluded_by_global_rule=excluded_by_global,
        )
        db.add(img)
        images.append(img)

    page.scraped_at = datetime.utcnow()
    db.commit()

    for img in images:
        db.refresh(img)

    return images


def derive_section(page_url: str) -> str:
    """Derive a coarse section/category from the URL path."""
    path_parts = [part for part in urlparse(page_url).path.split("/") if part]
    if not path_parts:
        return "uncategorized"

    lowered_parts = [part.lower() for part in path_parts]
    if "category" in lowered_parts:
        idx = lowered_parts.index("category")
        if idx + 1 < len(path_parts):
            return path_parts[idx + 1].replace("-", " ").replace("_", " ").lower()

    filtered_parts = []
    for part in path_parts:
        normalized = part.lower()
        if re.fullmatch(r"\d{4}", normalized):
            continue
        if re.fullmatch(r"\d{1,2}", normalized):
            continue
        if normalized == "amp":
            continue
        filtered_parts.append(normalized)

    # If URL is a single post slug (common WP permalink), don't treat it as category.
    if len(filtered_parts) <= 1:
        return "uncategorized"

    return filtered_parts[0].replace("-", " ")


@router.post("/pages/{page_id}/scrape", response_model=List[PageImageResponse])
async def scrape_page(
    page_id: int,
    db: Session = Depends(get_db),
):
    """Scrape images from a page with enhanced metadata and classification."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    global_rules = db.query(GlobalExcludedImage).all()
    return await scrape_page_into_db(page, db, global_rules)


@router.get("/pages", response_model=List[ImagePageSummary])
def list_image_pages(
    website_id: int | None = None,
    sitemap_bucket: str | None = None,
    scrape_status: str = "all",
    search: str | None = None,
    section: str | None = None,
    db: Session = Depends(get_db),
):
    """List all pages with image scrape inventory metadata."""
    image_stats = (
        db.query(
            PageImage.page_id.label("page_id"),
            func.count(PageImage.id).label("images_total"),
            func.sum(case((PageImage.is_excluded == False, 1), else_=0)).label("images_available"),
            func.sum(case((PageImage.is_excluded == True, 1), else_=0)).label("images_excluded"),
        )
        .group_by(PageImage.page_id)
        .subquery()
    )
    keyword_stats = (
        db.query(
            PageKeyword.page_id.label("page_id"),
            func.count(PageKeyword.id).label("keyword_count"),
        )
        .group_by(PageKeyword.page_id)
        .subquery()
    )

    query = (
        db.query(
            Page.id,
            Page.website_id,
            Website.name.label("website_name"),
            Page.url,
            Page.title,
            Page.section,
            Page.sitemap_source,
            Page.sitemap_bucket,
            Page.is_utility_page,
            Page.is_enabled,
            Page.scraped_at,
            Page.created_at,
            image_stats.c.images_total,
            image_stats.c.images_available,
            image_stats.c.images_excluded,
            keyword_stats.c.keyword_count,
        )
        .join(Website, Website.id == Page.website_id)
        .outerjoin(image_stats, image_stats.c.page_id == Page.id)
        .outerjoin(keyword_stats, keyword_stats.c.page_id == Page.id)
        .order_by(Website.name.asc(), Page.created_at.desc())
    )

    query = query.filter(Page.is_enabled == True)

    if website_id is not None:
        query = query.filter(Page.website_id == website_id)

    if sitemap_bucket:
        query = query.filter(Page.sitemap_bucket == sitemap_bucket)

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
                is_utility_page=row.is_utility_page,
                sitemap_source=row.sitemap_source,
                sitemap_bucket=row.sitemap_bucket or "unknown",
                scraped_at=row.scraped_at,
                created_at=row.created_at,
                section=page_section,
                images_total=row.images_total or 0,
                images_available=row.images_available or 0,
                images_excluded=row.images_excluded or 0,
                keyword_count=row.keyword_count or 0,
                has_keywords=bool(row.keyword_count or 0),
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
    """Scrape images for multiple pages with enhanced metadata and classification."""
    if not request.page_ids:
        raise HTTPException(status_code=400, detail="No page ids provided")

    pages = (
        db.query(Page)
        .filter(Page.id.in_(request.page_ids), Page.is_enabled == True)
        .all()
    )

    # Get global exclusion rules once for all pages
    global_rules = db.query(GlobalExcludedImage).all()

    errors = []
    scraped = 0
    for page in pages:
        try:
            await scrape_page_into_db(page, db, global_rules)
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


# =============================================================================
# Global Exclusion Endpoints
# =============================================================================

@router.get("/global-exclusions", response_model=List[GlobalExcludedImageResponse])
def list_global_exclusions(db: Session = Depends(get_db)):
    """List all global exclusion rules."""
    return db.query(GlobalExcludedImage).order_by(GlobalExcludedImage.created_at.desc()).all()


@router.post("/global-exclusions", response_model=GlobalExcludedImageResponse)
def create_global_exclusion(
    rule: GlobalExcludedImageCreate,
    db: Session = Depends(get_db),
):
    """Create a new global exclusion rule."""
    if not rule.url_pattern and not rule.name_pattern:
        raise HTTPException(
            status_code=400,
            detail="At least one of url_pattern or name_pattern must be provided"
        )

    if rule.reason not in ["affiliate", "logo", "tracking", "icon", "ad", "other"]:
        raise HTTPException(
            status_code=400,
            detail="reason must be one of: affiliate, logo, tracking, icon, ad, other"
        )

    db_rule = GlobalExcludedImage(
        url_pattern=rule.url_pattern,
        name_pattern=rule.name_pattern,
        reason=rule.reason,
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule


@router.delete("/global-exclusions/{rule_id}")
def delete_global_exclusion(rule_id: int, db: Session = Depends(get_db)):
    """Delete a global exclusion rule."""
    rule = db.query(GlobalExcludedImage).filter(GlobalExcludedImage.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Exclusion rule not found")

    db.delete(rule)
    db.commit()
    recompute_global_exclusions(db)
    return {"message": "Rule deleted successfully"}


@router.post("/global-exclusions/{rule_id}/apply", response_model=GlobalExcludedImageApplyResponse)
def apply_global_exclusion(rule_id: int, db: Session = Depends(get_db)):
    """Apply a global exclusion rule to existing scraped images."""
    rule = db.query(GlobalExcludedImage).filter(GlobalExcludedImage.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Exclusion rule not found")

    result = apply_exclusion_to_images(db, rule_id, dry_run=False)
    return GlobalExcludedImageApplyResponse(**result)
