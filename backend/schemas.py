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
    url: str | None = None
    sitemap_url: str | None = None


class WebsiteResponse(BaseModel):
    """Schema for website response."""
    id: int
    name: str
    url: str
    sitemap_url: str | None
    generation_settings: dict[str, Any] | None = None
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


class TrendKeywordUploadResponse(BaseModel):
    """Response for trend keyword CSV upload."""
    total_rows: int
    inserted: int
    updated: int
    duplicates_skipped: int
    errors: list[str]


class KeywordRow(BaseModel):
    """Single keyword row from CSV."""
    url: str
    keywords: str


class KeywordStatusResponse(BaseModel):
    """Keyword status."""
    total_pages: int
    pages_with_keywords: int
    total_keywords: int
    coverage_percent: float


class KeywordEntryResponse(BaseModel):
    """Single URL-level SEO keyword entry."""
    url: str
    keywords: str


class KeywordEntryUpdate(BaseModel):
    """Update URL-level SEO keywords."""
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
    template_manifest: dict[str, Any] | None = None
    width: int
    height: int
    created_at: datetime

    class Config:
        from_attributes = True


class TemplateWithZones(TemplateResponse):
    """Template with its zones."""
    zones: list[TemplateZoneResponse]


class TemplateManifestUpdate(BaseModel):
    """Persisted template SVG + manifest payload."""
    svg_content: str
    template_manifest: dict[str, Any]


class TemplateDetectionStartRequest(BaseModel):
    """Request payload for template detection pre-pass."""
    max_regions: int = Field(default=10, ge=1, le=30)


class TemplateOCRResult(BaseModel):
    """Single OCR result row keyed by candidate id."""
    candidate_id: str
    text: str = ""
    confidence: float = 0.0


class TemplateDetectionFinalizeRequest(BaseModel):
    """Finalize detected zones using optional OCR results."""
    ocr_results: list[TemplateOCRResult] = Field(default_factory=list)


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
    keyword_count: int
    has_keywords: bool


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
    text_align: Literal["left", "center"] | None = None
    palette_mode: Literal["auto", "brand", "manual"] | None = None
    text_zone_bg_color: str | None = None
    brand_palette_background_color: str | None = None
    brand_palette_text_color: str | None = None
    brand_palette_effect_color: str | None = None
    manual_palette_background_color: str | None = None
    manual_palette_text_color: str | None = None
    manual_palette_effect_color: str | None = None
    font_family: str | None = None
    text_color: str | None = None
    text_effect: Literal["none", "drop", "echo", "outline"] | None = None
    text_effect_color: str | None = None
    text_effect_offset_x: int | None = None
    text_effect_offset_y: int | None = None
    text_effect_blur: int | None = None
    title_scale: float | None = None
    title_padding_x: int | None = None
    line_height_multiplier: float | None = None
    custom_font_file: str | None = None


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
    text_align: str | None
    font_family: str | None
    custom_font_file: str | None = None
    text_zone_bg_color: str | None
    text_color: str | None
    text_effect: str | None
    text_effect_color: str | None
    text_effect_offset_x: int | None
    text_effect_offset_y: int | None
    text_effect_blur: int | None
    status: str
    is_selected: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PinDraftDetailResponse(BaseModel):
    """Detailed pin draft response used by calendar detail view."""
    pin: PinDraftResponse
    page: PageResponse
    images: list[PageImageResponse]


class PinDraftUpdate(BaseModel):
    """Schema for updating pin draft."""
    template_id: int | None = None
    selected_image_url: str | None = None
    title: str | None = None
    description: str | None = None
    board_name: str | None = None
    keywords: str | None = None
    text_zone_y: int | None = None
    text_zone_height: int | None = None
    text_zone_pad_left: int | None = None
    text_zone_pad_right: int | None = None
    text_align: Literal["left", "center"] | None = None
    font_family: str | None = None
    custom_font_file: str | None = None
    text_zone_bg_color: str | None = None
    text_color: str | None = None
    text_effect: Literal["none", "drop", "echo", "outline"] | None = None
    text_effect_color: str | None = None
    text_effect_offset_x: int | None = None
    text_effect_offset_y: int | None = None
    text_effect_blur: int | None = None
    status: str | None = None
    is_selected: bool | None = None


class GenerationJobResponse(BaseModel):
    """Background generation job status."""
    id: int
    website_id: int | None
    template_id: int | None
    status: str
    phase: str
    message: str | None
    error_detail: str | None
    total_pages: int
    processed_pages: int
    scraped_pages: int
    failed_pages: int
    total_pins: int
    rendered_pins: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


class PinGenerateRequest(BaseModel):
    """Request for pin generation."""
    template_id: int
    page_ids: list[int] | None = None  # None = all enabled pages
    board_name: str = "General"
    render_settings: PinRenderSettings | None = None
    use_ai_titles: bool = True
    generate_descriptions: bool = True
    tone: str = "seo-friendly"
    keyword_mode: Literal["auto", "manual"] = "auto"
    manual_keywords: str | None = None
    cta_style: Literal["soft", "strong", "none"] = "soft"
    title_max: int = Field(default=100, ge=20, le=200)
    description_max: int = Field(default=500, ge=60, le=1000)
    website_id: int | None = None
    language: str | None = None
    mode: Literal["conservative", "matrix"] = "conservative"
    variation_options: dict[str, int | bool] | None = None
    top_n: int | None = Field(default=None, ge=1, le=2000)
    similarity_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    diversity_enabled: bool | None = None
    diversity_penalty: float | None = Field(default=None, ge=0.0, le=1.0)
    semantic_enabled: bool | None = None
    image_settings: dict[str, Any] | None = None


class GenerationPreviewRequest(BaseModel):
    """Preview generation result without creating drafts."""
    template_id: int
    page_ids: list[int] | None = None
    website_id: int | None = None
    mode: Literal["conservative", "matrix"] = "conservative"
    variation_options: dict[str, int | bool] | None = None
    top_n: int | None = Field(default=None, ge=1, le=2000)
    similarity_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    diversity_enabled: bool | None = None
    diversity_penalty: float | None = Field(default=None, ge=0.0, le=1.0)
    semantic_enabled: bool | None = None


class GenerationPreviewResponse(BaseModel):
    """Projected output for generation preview."""
    pages_count: int
    estimated_pins: int
    mode: str
    sample: list[dict[str, Any]]


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
    timezone: str
    random_minutes: bool
    warmup_month: bool
    floating_days: bool
    max_floating_minutes: int
    updated_at: datetime

    class Config:
        from_attributes = True


class ScheduleSettingsUpdate(BaseModel):
    """Schema for updating schedule settings."""
    pins_per_day: int = Field(ge=1, le=100)
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    min_days_reuse: int = Field(ge=0, le=365)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    random_minutes: bool
    warmup_month: bool = False
    floating_days: bool = True
    max_floating_minutes: int = Field(default=45, ge=0, le=240)


# =============================================================================
# Sitemap Import Schemas
# =============================================================================

class SitemapImportResponse(BaseModel):
    """Response from sitemap import."""
    total_urls: int
    new_pages: int
    updated_pages: int
    errors: list[str]


class SitemapGroupResponse(BaseModel):
    """Single sitemap group entry discovered from sitemap index."""
    sitemap_url: str
    label: str
    bucket: str
    is_default: bool


class SitemapGroupsResponse(BaseModel):
    """Sitemap groups discovered for a website."""
    sitemap_url: str
    groups: list[SitemapGroupResponse]


class SitemapImportRequest(BaseModel):
    """Optional selected sitemap groups for import."""
    selected_sitemaps: list[str] | None = None


class WebsiteGenerationSettingsResponse(BaseModel):
    """Persisted generation defaults per website."""
    website_id: int
    settings: dict[str, Any]


class WebsiteGenerationSettingsUpdate(BaseModel):
    """Update generation defaults per website."""
    settings: dict[str, Any]


class TrendKeywordBase(BaseModel):
    """Base schema for persisted trend keywords."""
    keyword: str = Field(..., min_length=1, max_length=255)
    period_type: Literal["always", "month", "season"] = "always"
    period_value: str | None = None
    weight: float = Field(default=1.0, ge=0.0, le=10.0)


class TrendKeywordCreate(TrendKeywordBase):
    """Create a trend keyword."""
    pass


class TrendKeywordUpdate(BaseModel):
    """Update an existing trend keyword."""
    keyword: str | None = Field(default=None, min_length=1, max_length=255)
    period_type: Literal["always", "month", "season"] | None = None
    period_value: str | None = None
    weight: float | None = Field(default=None, ge=0.0, le=10.0)


class TrendKeywordResponse(BaseModel):
    """Trend keyword entry."""
    id: int
    website_id: int
    keyword: str
    period_type: str
    period_value: str | None
    weight: float
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# =============================================================================
# Export Schemas
# =============================================================================

class ExportRequest(BaseModel):
    """Request for CSV export."""
    selected_only: bool = True
    pin_ids: list[int] | None = None
    website_id: int | None = None


class ExportResponse(BaseModel):
    """Response from CSV export."""
    pins_count: int
    file_path: str
    download_url: str


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
