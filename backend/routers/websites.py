"""
Website management router.
"""
from typing import List
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Website, Page
from schemas import (
    WebsiteCreate,
    WebsiteUpdate,
    WebsiteResponse,
    WebsiteWithStats,
    PageResponse,
    PageUpdate,
    SitemapGroupResponse,
    SitemapGroupsResponse,
    SitemapImportRequest,
    SitemapImportResponse,
    WebsiteGenerationSettingsResponse,
    WebsiteGenerationSettingsUpdate,
)
from services.sitemap import import_sitemap, fetch_sitemap_groups

router = APIRouter()


def _normalize_website_url(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid website URL")
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}" if path else f"{parsed.scheme}://{parsed.netloc}"


def _normalize_sitemap_url(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid sitemap URL")
    path = parsed.path or "/"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _derive_sitemap_url(website_url: str, sitemap_url: str | None) -> str:
    normalized = _normalize_sitemap_url(sitemap_url)
    if normalized:
        return normalized
    parsed = urlparse(website_url)
    return f"{parsed.scheme}://{parsed.netloc}/sitemap_index.xml"


@router.get("", response_model=List[WebsiteWithStats])
def list_websites(db: Session = Depends(get_db)):
    """List all websites with stats."""
    websites = db.query(Website).all()

    result = []
    for site in websites:
        pages_count = len(site.pages)
        enabled_count = sum(1 for p in site.pages if p.is_enabled)

        result.append(
            WebsiteWithStats(
                id=site.id,
                name=site.name,
                url=site.url,
                sitemap_url=site.sitemap_url,
                created_at=site.created_at,
                pages_count=pages_count,
                enabled_pages_count=enabled_count,
            )
        )

    return result


@router.post("", response_model=WebsiteResponse, status_code=status.HTTP_201_CREATED)
def create_website(website: WebsiteCreate, db: Session = Depends(get_db)):
    """Create a new website. Auto-detects sitemap URL if not provided."""
    normalized_url = _normalize_website_url(website.url)
    if not normalized_url:
        raise HTTPException(status_code=400, detail="Website URL is required")
    sitemap_url = _derive_sitemap_url(normalized_url, website.sitemap_url)

    db_website = Website(
        name=website.name,
        url=normalized_url,
        sitemap_url=sitemap_url,
    )
    db.add(db_website)
    db.commit()
    db.refresh(db_website)
    return db_website


@router.patch("/{website_id}", response_model=WebsiteResponse)
def update_website(
    website_id: int,
    update: WebsiteUpdate,
    db: Session = Depends(get_db),
):
    """Update website basics."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    next_url = _normalize_website_url(update.url) if update.url is not None else website.url
    if not next_url:
        raise HTTPException(status_code=400, detail="Website URL is required")

    if update.name is not None:
        website.name = update.name.strip() or website.name
    website.url = next_url

    if update.sitemap_url is not None:
        website.sitemap_url = _derive_sitemap_url(next_url, update.sitemap_url)
    elif update.url is not None:
        website.sitemap_url = _derive_sitemap_url(next_url, website.sitemap_url)

    db.commit()
    db.refresh(website)
    return website


@router.get("/{website_id}", response_model=WebsiteWithStats)
def get_website(website_id: int, db: Session = Depends(get_db)):
    """Get a website by ID with stats."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    pages_count = len(website.pages)
    enabled_count = sum(1 for p in website.pages if p.is_enabled)

    return WebsiteWithStats(
        id=website.id,
        name=website.name,
        url=website.url,
        sitemap_url=website.sitemap_url,
        created_at=website.created_at,
        pages_count=pages_count,
        enabled_pages_count=enabled_count,
    )


@router.delete("/{website_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_website(website_id: int, db: Session = Depends(get_db)):
    """Delete a website."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    db.delete(website)
    db.commit()
    return None


@router.get("/{website_id}/sitemap-groups", response_model=SitemapGroupsResponse)
async def list_sitemap_groups(website_id: int, db: Session = Depends(get_db)):
    """Discover sitemap groups from the website sitemap index."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    if not website.sitemap_url:
        raise HTTPException(status_code=400, detail="No sitemap URL configured")

    groups = await fetch_sitemap_groups(website.sitemap_url)
    mapped = [
        SitemapGroupResponse(
            sitemap_url=item["sitemap_url"],
            label=item["label"],
            bucket=item["bucket"],
            is_default=item["is_default"] == "true",
        )
        for item in groups
    ]
    return SitemapGroupsResponse(sitemap_url=website.sitemap_url, groups=mapped)


@router.post("/{website_id}/sitemap", response_model=SitemapImportResponse)
async def import_website_sitemap(
    website_id: int,
    request: SitemapImportRequest | None = None,
    db: Session = Depends(get_db),
):
    """Import pages from sitemap."""
    selected = request.selected_sitemaps if request else None
    return await import_sitemap(website_id, db, selected_sitemaps=selected)


@router.get("/{website_id}/pages", response_model=List[PageResponse])
def list_website_pages(website_id: int, db: Session = Depends(get_db)):
    """List all pages for a website."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    return website.pages


@router.get("/{website_id}/generation-settings", response_model=WebsiteGenerationSettingsResponse)
def get_generation_settings(website_id: int, db: Session = Depends(get_db)):
    """Get saved generation defaults for website."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    defaults = {
        "image_settings": {
            "use_hidden_images": True,
            "ignore_small_images": True,
            "min_width": 200,
            "min_height": 200,
            "allowed_orientations": ["portrait", "square", "landscape"],
            "max_images_per_page": 1,
            "featured_only": False,
        },
        "ai_settings": {
            "enabled": True,
            "text_variations": 1,
        },
        "design_settings": {
            "template_ids": [],
            "color_palette": "default",
        },
    }
    return WebsiteGenerationSettingsResponse(
        website_id=website.id,
        settings=website.generation_settings or defaults,
    )


@router.put("/{website_id}/generation-settings", response_model=WebsiteGenerationSettingsResponse)
def update_generation_settings(
    website_id: int,
    update: WebsiteGenerationSettingsUpdate,
    db: Session = Depends(get_db),
):
    """Update saved generation defaults for website."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    website.generation_settings = update.settings
    db.commit()
    db.refresh(website)
    return WebsiteGenerationSettingsResponse(
        website_id=website.id,
        settings=website.generation_settings or {},
    )


@router.get("/pages/all", response_model=List[PageResponse])
def list_all_pages(db: Session = Depends(get_db)):
    """List all pages across all websites."""
    return db.query(Page).order_by(Page.created_at.desc()).all()


@router.patch("/pages/{page_id}", response_model=PageResponse)
def update_page(page_id: int, page_update: PageUpdate, db: Session = Depends(get_db)):
    """Update a page (enable/disable, title)."""
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    if page_update.is_enabled is not None:
        page.is_enabled = page_update.is_enabled
    if page_update.title is not None:
        page.title = page_update.title

    db.commit()
    db.refresh(page)
    return page
