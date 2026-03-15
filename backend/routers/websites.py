"""
Website management router.
"""
from typing import List
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Website, Page
from schemas import (
    WebsiteCreate,
    WebsiteResponse,
    WebsiteWithStats,
    PageResponse,
    PageUpdate,
    SitemapImportResponse,
)
from services.sitemap import import_sitemap

router = APIRouter()


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
    # Auto-detect sitemap URL if not provided
    sitemap_url = website.sitemap_url
    if not sitemap_url and website.url:
        # Try common sitemap locations
        parsed = urlparse(website.url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        sitemap_url = f"{base}/sitemap.xml"

    db_website = Website(
        name=website.name,
        url=website.url,
        sitemap_url=sitemap_url,
    )
    db.add(db_website)
    db.commit()
    db.refresh(db_website)
    return db_website


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


@router.post("/{website_id}/sitemap", response_model=SitemapImportResponse)
async def import_website_sitemap(
    website_id: int, db: Session = Depends(get_db)
):
    """Import pages from sitemap."""
    return await import_sitemap(website_id, db)


@router.get("/{website_id}/pages", response_model=List[PageResponse])
def list_website_pages(website_id: int, db: Session = Depends(get_db)):
    """List all pages for a website."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    return website.pages


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
