"""
Pydantic schemas for request/response validation.
"""
from datetime import datetime
from typing import Any, Literal
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
    sitemap_bucket: str | None
    is_utility_page: bool
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
    period_type: Literal["always", "month", "season"] = "always"
    period_value: str | None = None


class KeywordStatusResponse(BaseModel):
    """Keyword status with period breakdown."""
    total_pages: int
    pages_with_keywords: int
    total_keywords: int
    coverage_percent: float
    by_period_type: dict[str, int]


class KeywordEntryResponse(BaseModel):
    """Single keyword entry with page metadata."""
    id: int
    page_id: int
    website_id: int
    website_name: str
    page_title: str | None
    page_url: str
    keyword: str
    period_type: Literal["always", "month", "season"]
    period_value: str | None


class KeywordEntryUpdate(BaseModel):
    """Update keyword entry."""
    keyword: str
    period_type: Literal["always", "month", "season"] = "always"
    period_value: str | None = None


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
    """Schema for page image response with enhanced metadata."""
    id: int
    page_id: int
    url: str
    is_excluded: bool
    width: int | None
    height: int | None
    file_size: int | None
    mime_type: str | None
    format: str | None
    is_article_image: bool
    is_hq: bool
    category: str
    excluded_by_global_rule: bool
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
    is_utility_page: bool
    sitemap_source: str | None
    sitemap_bucket: str
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
# Global Exclusion Schemas
# =============================================================================

class GlobalExcludedImageResponse(BaseModel):
    """Schema for global exclusion rule response."""
    id: int
    url_pattern: str | None
    name_pattern: str | None
    reason: str
    created_at: datetime

    class Config:
        from_attributes = True


class GlobalExcludedImageCreate(BaseModel):
    """Schema for creating a global exclusion rule."""
    url_pattern: str | None = None
    name_pattern: str | None = None
    reason: str = "other"


class GlobalExcludedImageApplyResponse(BaseModel):
    """Response after applying an exclusion rule to existing images."""
    rule_id: int
    matched: int
    applied: bool


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
    min_days_reuse: int = Field(ge=31, le=365)
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


# =============================================================================
# AI Preset Schemas
# =============================================================================

class AIPromptPresetBase(BaseModel):
    """Base schema for AI prompt preset."""
    name: str = Field(..., min_length=1, max_length=255)
    target_field: str = Field(..., pattern="^(title|description|board)$")
    prompt_template: str
    model: str = "gpt-4o-mini"
    temperature: float = Field(default=0.4, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=4000)
    language: str = "English"
    is_default: bool = False


class AIPromptPresetCreate(AIPromptPresetBase):
    """Schema for creating an AI prompt preset."""
    pass


class AIPromptPresetUpdate(BaseModel):
    """Schema for updating an AI prompt preset."""
    name: str | None = Field(default=None, min_length=1, max_length=255)
    target_field: str | None = Field(default=None, pattern="^(title|description|board)$")
    prompt_template: str | None = None
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=4000)
    language: str | None = None
    is_default: bool | None = None


class AIPromptPresetResponse(BaseModel):
    """Schema for AI prompt preset response."""
    id: int
    name: str
    target_field: str
    prompt_template: str
    model: str
    temperature: float
    max_tokens: int | None
    language: str
    is_default: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# =============================================================================
# AI Settings Schemas
# =============================================================================

class AISettingsResponse(BaseModel):
    """Schema for AI settings response."""
    id: int
    default_title_preset_id: int | None
    default_description_preset_id: int | None
    default_board_preset_id: int | None
    default_language: str
    use_ai_by_default: bool

    class Config:
        from_attributes = True


class AISettingsUpdate(BaseModel):
    """Schema for updating AI settings."""
    default_title_preset_id: int | None = None
    default_description_preset_id: int | None = None
    default_board_preset_id: int | None = None
    default_language: str | None = None
    use_ai_by_default: bool | None = None
