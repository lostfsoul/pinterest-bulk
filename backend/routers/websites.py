"""
Website management router.
"""
import re
from typing import List
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Website, Page, WebsiteTrendKeyword
from schemas import (
    WebsiteCreate,
    WebsiteUpdate,
    WebsiteResponse,
    WebsiteWithStats,
    PageResponse,
    PageUpdate,
    PageBulkUpdateRequest,
    PageBulkUpdateResponse,
    SitemapGroupResponse,
    SitemapGroupsResponse,
    SitemapImportRequest,
    SitemapImportResponse,
    WebsiteGenerationSettingsResponse,
    WebsiteGenerationSettingsUpdate,
    TrendKeywordCreate,
    TrendKeywordUpdate,
    TrendKeywordResponse,
)
from services.sitemap import import_sitemap, fetch_sitemap_groups

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


def _normalize_trend_period(period_type: str, period_value: str | None) -> tuple[str, str | None]:
    normalized_type = (period_type or "always").strip().lower()
    if normalized_type not in {"always", "month", "season"}:
        raise HTTPException(status_code=400, detail="period_type must be one of: always, month, season")
    if normalized_type == "always":
        return "always", None

    value = re.sub(r"\s+", " ", (period_value or "").strip().lower())
    if not value:
        raise HTTPException(status_code=400, detail="period_value is required for month/season")
    if normalized_type == "month":
        mapped = MONTH_ALIASES.get(value)
        if not mapped:
            raise HTTPException(status_code=400, detail=f"Unsupported month value: {period_value}")
        return "month", mapped
    mapped = SEASON_ALIASES.get(value)
    if not mapped:
        raise HTTPException(status_code=400, detail=f"Unsupported season value: {period_value}")
    return "season", mapped


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
        "preview_page_id": None,
        "ai": {
            "generate_titles": True,
            "generate_descriptions": True,
            "variants": 1,
            "tone": "seo-friendly",
            "keyword_mode": "auto",
            "manual_keywords": "",
            "cta_style": "soft",
            "language": "English",
            "title_max": 100,
            "description_max": 500,
            "board_candidates": [],
        },
        "design": {
            "template_ids": [],
            "font_choices": ["Poppins"],
            "palette_mode": "auto",
            "brand_palette": {
                "background": "#ffffff",
                "text": "#000000",
                "effect": "#000000",
            },
            "manual_palette": {
                "background": "#ffffff",
                "text": "#000000",
                "effect": "#000000",
            },
        },
        "image": {
            "fetch_from_page": True,
            "ignore_small_width": True,
            "min_width": 200,
            "ignore_small_height": False,
            "min_height": 200,
            "orientations": ["portrait", "square", "landscape"],
            "fetch_featured": True,
            "use_same_image_once": True,
            "match_palettes_to_images": False,
            "ignore_images_with_text": False,
            "show_full_image": False,
        },
        "generation": {
            "daily_pin_count": 5,
            "scheduling_window_days": 33,
            "auto_regeneration_enabled": False,
            "auto_regeneration_days_before_deadline": 3,
            "warmup_month": False,
            "floating_days": True,
            "randomize_posting_times": True,
            "max_floating_minutes": 45,
            "timezone": "UTC",
            "start_hour": 8,
            "end_hour": 20,
            "floating_start_end_hours": False,
            "start_window_flex_minutes": 60,
            "end_window_flex_minutes": 120,
        },
        "content": {
            "desired_gap_days": 31,
            "lifetime_limit_enabled": False,
            "lifetime_limit_count": 0,
            "monthly_limit_enabled": False,
            "monthly_limit_count": 0,
            "no_link_pins": False,
        },
        "trend": {
            "enabled": True,
            "top_n": 0,
            "similarity_threshold": 0.0,
            "diversity_enabled": False,
            "diversity_penalty": 0.15,
            "semantic_enabled": False,
        },
        # Legacy keys kept for backward compatibility.
        "image_settings": {
            "ignore_small_width": True,
            "ignore_small_height": False,
            "min_width": 200,
            "min_height": 200,
            "allowed_orientations": ["portrait", "square", "landscape"],
        },
        "ai_settings": {"enabled": True, "text_variations": 1},
        "design_settings": {"template_ids": [], "color_palette": "default"},
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


@router.get("/{website_id}/trend-keywords", response_model=List[TrendKeywordResponse])
def list_trend_keywords(website_id: int, db: Session = Depends(get_db)):
    """List website-level trend keywords used for page ranking."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    return (
        db.query(WebsiteTrendKeyword)
        .filter(WebsiteTrendKeyword.website_id == website_id)
        .order_by(WebsiteTrendKeyword.created_at.desc(), WebsiteTrendKeyword.id.desc())
        .all()
    )


@router.post("/{website_id}/trend-keywords", response_model=TrendKeywordResponse, status_code=status.HTTP_201_CREATED)
def create_trend_keyword(
    website_id: int,
    payload: TrendKeywordCreate,
    db: Session = Depends(get_db),
):
    """Create a trend keyword for website ranking."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    period_type, period_value = _normalize_trend_period(payload.period_type, payload.period_value)
    keyword = payload.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="keyword cannot be empty")

    row = WebsiteTrendKeyword(
        website_id=website_id,
        keyword=keyword,
        period_type=period_type,
        period_value=period_value,
        weight=float(payload.weight),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{website_id}/trend-keywords/{trend_keyword_id}", response_model=TrendKeywordResponse)
def update_trend_keyword(
    website_id: int,
    trend_keyword_id: int,
    payload: TrendKeywordUpdate,
    db: Session = Depends(get_db),
):
    """Update a website trend keyword."""
    row = (
        db.query(WebsiteTrendKeyword)
        .filter(WebsiteTrendKeyword.id == trend_keyword_id, WebsiteTrendKeyword.website_id == website_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Trend keyword not found")

    if payload.keyword is not None:
        keyword = payload.keyword.strip()
        if not keyword:
            raise HTTPException(status_code=400, detail="keyword cannot be empty")
        row.keyword = keyword

    period_type_input = payload.period_type if payload.period_type is not None else row.period_type
    period_value_input = payload.period_value if (payload.period_type is not None or payload.period_value is not None) else row.period_value
    period_type, period_value = _normalize_trend_period(period_type_input, period_value_input)
    row.period_type = period_type
    row.period_value = period_value

    if payload.weight is not None:
        row.weight = float(payload.weight)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{website_id}/trend-keywords/{trend_keyword_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trend_keyword(
    website_id: int,
    trend_keyword_id: int,
    db: Session = Depends(get_db),
):
    """Delete a trend keyword from website ranking inputs."""
    row = (
        db.query(WebsiteTrendKeyword)
        .filter(WebsiteTrendKeyword.id == trend_keyword_id, WebsiteTrendKeyword.website_id == website_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Trend keyword not found")
    db.delete(row)
    db.commit()
    return None


@router.get("/pages/all", response_model=List[PageResponse])
def list_all_pages(db: Session = Depends(get_db)):
    """List all pages across all websites."""
    return db.query(Page).order_by(Page.created_at.desc()).all()


@router.patch("/pages/bulk", response_model=PageBulkUpdateResponse)
def update_pages_bulk(payload: PageBulkUpdateRequest, db: Session = Depends(get_db)):
    """Update multiple pages in one DB roundtrip."""
    page_ids = sorted({int(page_id) for page_id in payload.page_ids if int(page_id) > 0})
    if not page_ids:
        return PageBulkUpdateResponse(updated_count=0)

    updated_count = (
        db.query(Page)
        .filter(Page.id.in_(page_ids))
        .update({Page.is_enabled: payload.is_enabled}, synchronize_session=False)
    )
    db.commit()
    return PageBulkUpdateResponse(updated_count=updated_count)


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
