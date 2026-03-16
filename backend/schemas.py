"""
Pydantic schemas for request/response validation.
"""
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, HttpUrl


# =============================================================================
# Website Schemas
# =============================================================================

class WebsiteCreate(BaseModel):
    """Schema for creating a website."""
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., min_length=1, max_length=1024)
    sitemap_url: str | None = Field(None, max_length=1024)


class WebsiteUpdate(BaseModel):
    """Schema for updating a website."""
    name: str | None = None
    sitemap_url: str | None = None


class WebsiteResponse(BaseModel):
    """Schema for website response."""
    id: int
    name: str
    url: str
    sitemap_url: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class WebsiteWithStats(WebsiteResponse):
    """Website with page counts."""
    pages_count: int
    enabled_pages_count: int


# =============================================================================
# Page Schemas
# =============================================================================

class PageResponse(BaseModel):
    """Schema for page response."""
    id: int
    website_id: int
    url: str
    title: str | None
    section: str | None
    sitemap_source: str | None
    is_enabled: bool
    scraped_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class PageUpdate(BaseModel):
    """Schema for updating a page."""
    is_enabled: bool | None = None
    title: str | None = None


# =============================================================================
# Keyword Schemas
# =============================================================================

class KeywordUploadResponse(BaseModel):
    """Response for keyword CSV upload."""
    total_rows: int
    matched_pages: int
    unmatched_urls: list[str]
    duplicates_skipped: int
    errors: list[str]


class KeywordRow(BaseModel):
    """Single keyword row from CSV."""
    url: str
    keywords: str


# =============================================================================
# Template Schemas
# =============================================================================

class TemplateZoneResponse(BaseModel):
    """Schema for template zone response."""
    id: int
    zone_type: str
    x: int
    y: int
    width: int
    height: int
    props: dict | None

    class Config:
        from_attributes = True


class TemplateResponse(BaseModel):
    """Schema for template response."""
    id: int
    name: str
    filename: str
    width: int
    height: int
    created_at: datetime

    class Config:
        from_attributes = True


class TemplateWithZones(TemplateResponse):
    """Template with its zones."""
    zones: list[TemplateZoneResponse]


# =============================================================================
# Image Schemas
# =============================================================================

class PageImageResponse(BaseModel):
    """Schema for page image response."""
    id: int
    page_id: int
    url: str
    is_excluded: bool
    created_at: datetime

    class Config:
        from_attributes = True


class PageImageUpdate(BaseModel):
    """Schema for updating page image."""
    is_excluded: bool


class PageWithImages(PageResponse):
    """Page with its images."""
    images: list[PageImageResponse]


class ImagePageSummary(BaseModel):
    """Page summary for image inventory management."""
    id: int
    website_id: int
    website_name: str
    url: str
    title: str | None
    is_enabled: bool
    scraped_at: datetime | None
    created_at: datetime
    section: str
    images_total: int
    images_available: int
    images_excluded: int


class ImageBatchScrapeRequest(BaseModel):
    """Batch scrape request."""
    page_ids: list[int]


class ImageBatchScrapeResponse(BaseModel):
    """Batch scrape response."""
    total: int
    scraped: int
    failed: int
    errors: list[str]


# =============================================================================
# Pin Draft Schemas
# =============================================================================

class PinDraftCreate(BaseModel):
    """Schema for creating pin drafts."""
    page_ids: list[int]
    template_id: int


class PinRenderSettings(BaseModel):
    """Settings used to render a pin."""
    text_zone_y: int | None = None
    text_zone_height: int | None = None
    text_zone_pad_left: int | None = None
    text_zone_pad_right: int | None = None
    font_family: str | None = None
    text_color: str | None = None


class PinDraftResponse(BaseModel):
    """Schema for pin draft response."""
    id: int
    page_id: int
    template_id: int | None
    selected_image_url: str | None
    title: str | None
    description: str | None
    board_name: str | None
    link: str | None
    media_url: str | None
    publish_date: datetime | None
    keywords: str | None
    text_zone_y: int | None
    text_zone_height: int | None
    text_zone_pad_left: int | None
    text_zone_pad_right: int | None
    font_family: str | None
    text_color: str | None
    status: str
    is_selected: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PinDraftUpdate(BaseModel):
    """Schema for updating pin draft."""
    title: str | None = None
    description: str | None = None
    board_name: str | None = None
    keywords: str | None = None
    text_zone_y: int | None = None
    text_zone_height: int | None = None
    text_zone_pad_left: int | None = None
    text_zone_pad_right: int | None = None
    font_family: str | None = None
    text_color: str | None = None
    status: str | None = None
    is_selected: bool | None = None


class PinGenerateRequest(BaseModel):
    """Request for pin generation."""
    template_id: int
    page_ids: list[int] | None = None  # None = all enabled pages
    board_name: str = "General"
    render_settings: PinRenderSettings | None = None
    use_ai_titles: bool = True


# =============================================================================
# Schedule Schemas
# =============================================================================

class ScheduleSettingsResponse(BaseModel):
    """Schema for schedule settings response."""
    id: int
    pins_per_day: int
    start_hour: int
    end_hour: int
    min_days_reuse: int
    random_minutes: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class ScheduleSettingsUpdate(BaseModel):
    """Schema for updating schedule settings."""
    pins_per_day: int = Field(ge=1, le=100)
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    min_days_reuse: int = Field(ge=1, le=365)
    random_minutes: bool


# =============================================================================
# Sitemap Import Schemas
# =============================================================================

class SitemapImportRequest(BaseModel):
    """Request for sitemap import."""
    sitemap_url: str


class SitemapImportResponse(BaseModel):
    """Response from sitemap import."""
    total_urls: int
    new_pages: int
    updated_pages: int
    errors: list[str]


# =============================================================================
# Export Schemas
# =============================================================================

class ExportRequest(BaseModel):
    """Request for CSV export."""
    selected_only: bool = True
    pin_ids: list[int] | None = None


class ExportResponse(BaseModel):
    """Response from CSV export."""
    pins_count: int
    file_path: str
    download_url: str


# =============================================================================
# Analytics/Activity Schemas
# =============================================================================

class ActivityLogResponse(BaseModel):
    """Schema for activity log response."""
    id: int
    action: str
    entity_type: str | None
    entity_id: int | None
    details: dict | None
    created_at: datetime

    class Config:
        from_attributes = True


class ImportLogResponse(BaseModel):
    """Schema for import log response."""
    id: int
    type: str
    website_id: int | None
    items_count: int
    success_count: int
    error_count: int
    details: dict | None
    created_at: datetime

    class Config:
        from_attributes = True


class ExportLogResponse(BaseModel):
    """Schema for export log response."""
    id: int
    pins_count: int
    file_path: str
    created_at: datetime

    class Config:
        from_attributes = True


class AnalyticsSummary(BaseModel):
    """Summary statistics for analytics."""
    websites: int
    pages: int
    enabled_pages: int
    keywords: int
    pages_with_keywords: int
    templates: int
    images_total: int
    images_excluded: int
    images_available: int
    pins_total: int
    pins_draft: int
    pins_ready: int
    pins_exported: int
    pins_skipped: int
    exports_count: int
    exports_pins_total: int
