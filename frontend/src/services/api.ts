import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  // Don't set default Content-Type - let axios set it based on the request body
});

// Types
export interface Website {
  id: number;
  name: string;
  url: string;
  sitemap_url: string | null;
  generation_settings?: Record<string, unknown> | null;
  created_at: string;
  pages_count?: number;
  enabled_pages_count?: number;
}

export interface Page {
  id: number;
  website_id: number;
  url: string;
  title: string | null;
  section: string | null;
  sitemap_source: string | null;
  sitemap_bucket: string | null;
  is_utility_page: boolean;
  is_enabled: boolean;
  scraped_at: string | null;
  created_at: string;
}

export interface PageBulkUpdateResponse {
  updated_count: number;
}

export interface Template {
  id: number;
  name: string;
  filename: string;
  template_manifest?: Record<string, unknown> | null;
  width: number;
  height: number;
  created_at: string;
  zones?: TemplateZone[];
}

export interface TemplateZone {
  id: number;
  zone_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, unknown> | null;
}

export interface TemplateManifestUpdatePayload {
  svg_content: string;
  template_manifest: Record<string, unknown>;
}

export interface TemplateDetectionStartResponse {
  template_id: number;
  structure: Record<string, unknown>;
  candidate_crops: Record<string, string>;
}

export interface TemplateOCRResult {
  candidate_id: string;
  text: string;
  confidence: number;
}

export interface SitemapGroup {
  sitemap_url: string;
  label: string;
  bucket: string;
  is_default: boolean;
}

export interface PageImage {
  id: number;
  page_id: number;
  url: string;
  is_excluded: boolean;
  width: number | null;
  height: number | null;
  file_size: number | null;
  mime_type: string | null;
  format: string | null;
  is_article_image: boolean;
  is_hq: boolean;
  category: 'article' | 'featured' | 'other';
  excluded_by_global_rule: boolean;
  created_at: string;
}

export interface GlobalExcludedImage {
  id: number;
  url_pattern: string | null;
  name_pattern: string | null;
  reason: 'affiliate' | 'logo' | 'tracking' | 'icon' | 'ad' | 'other';
  created_at: string;
}

export interface ImagePageSummary {
  id: number;
  website_id: number;
  website_name: string;
  url: string;
  title: string | null;
  is_enabled: boolean;
  is_utility_page: boolean;
  sitemap_source: string | null;
  sitemap_bucket: string;
  scraped_at: string | null;
  created_at: string;
  section: string;
  images_total: number;
  images_available: number;
  images_excluded: number;
  keyword_count: number;
  has_keywords: boolean;
}

export interface PinDraft {
  id: number;
  page_id: number;
  template_id: number | null;
  selected_image_url: string | null;
  title: string | null;
  description: string | null;
  board_name: string | null;
  link: string | null;
  media_url: string | null;
  publish_date: string | null;
  keywords: string | null;
  text_zone_y: number | null;
  text_zone_height: number | null;
  text_zone_pad_left: number | null;
  text_zone_pad_right: number | null;
  text_align: 'left' | 'center' | null;
  font_family: string | null;
  custom_font_file: string | null;
  text_zone_bg_color: string | null;
  text_color: string | null;
  text_effect: 'none' | 'drop' | 'echo' | 'outline' | null;
  text_effect_color: string | null;
  text_effect_offset_x: number | null;
  text_effect_offset_y: number | null;
  text_effect_blur: number | null;
  status: string;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export interface PinDetail {
  pin: PinDraft;
  page: Page;
  images: PageImage[];
}

export interface PinRenderSettings {
  text_zone_y?: number;
  text_zone_height?: number;
  text_zone_pad_left?: number;
  text_zone_pad_right?: number;
  text_align?: 'left' | 'center';
  palette_mode?: 'auto' | 'brand' | 'manual';
  text_zone_bg_color?: string;
  brand_palette_background_color?: string;
  brand_palette_text_color?: string;
  brand_palette_effect_color?: string;
  manual_palette_background_color?: string;
  manual_palette_text_color?: string;
  manual_palette_effect_color?: string;
  font_family?: string;
  text_color?: string;
  text_effect?: 'none' | 'drop' | 'echo' | 'outline';
  text_effect_color?: string;
  text_effect_offset_x?: number;
  text_effect_offset_y?: number;
  text_effect_blur?: number;
  title_scale?: number;
  title_padding_x?: number;
  line_height_multiplier?: number;
  custom_font_file?: string | null;
}

export interface GenerationJob {
  id: number;
  website_id: number | null;
  template_id: number | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  phase: string;
  message: string | null;
  error_detail: string | null;
  total_pages: number;
  processed_pages: number;
  scraped_pages: number;
  failed_pages: number;
  total_pins: number;
  rendered_pins: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ScheduleSettings {
  id: number;
  pins_per_day: number;
  start_hour: number;
  end_hour: number;
  min_days_reuse: number;
  timezone: string;
  random_minutes: boolean;
  warmup_month: boolean;
  floating_days: boolean;
  max_floating_minutes: number;
  updated_at: string;
}

export interface WorkflowStatusResponse {
  website_id: number;
  pins_per_day: number;
  window_days: number;
  days_ahead_current: number;
  scheduled_count: number;
  scheduled_until: string | null;
  auto_regen_enabled: boolean;
  auto_regen_days_before_deadline: number;
  desired_gap_days: number;
  has_active_job: boolean;
  active_job_id: number | null;
}

export interface WorkflowPinCountPreviewDay {
  day: number;
  count: number;
}

export interface WorkflowPinCountPreviewResponse {
  website_id: number;
  year: number;
  month: number;
  base_daily_pin_count: number;
  days: WorkflowPinCountPreviewDay[];
}

export interface WorkflowTimeWindowPreviewDay {
  day: number;
  start_minutes: number;
  end_minutes: number;
  start_time: string;
  end_time: string;
}

export interface WorkflowTimeWindowPreviewResponse {
  website_id: number;
  year: number;
  month: number;
  start_hour: number;
  end_hour: number;
  floating_start_end_hours: boolean;
  start_window_flex_minutes: number;
  end_window_flex_minutes: number;
  days: WorkflowTimeWindowPreviewDay[];
}

export interface AuthStatus {
  authenticated: boolean;
  enabled: boolean;
}

export interface AIPromptPreset {
  id: number;
  name: string;
  target_field: 'title' | 'description' | 'board';
  prompt_template: string;
  model: string;
  temperature: number;
  max_tokens: number | null;
  language: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AISettings {
  id: number;
  default_title_preset_id: number | null;
  default_description_preset_id: number | null;
  default_board_preset_id: number | null;
  default_language: string;
  use_ai_by_default: boolean;
}

export interface KeywordEntry {
  url: string;
  keywords: string;
}

export interface TrendKeywordUploadResponse {
  total_rows: number;
  inserted: number;
  updated: number;
  duplicates_skipped: number;
  errors: string[];
}

export interface TrendKeywordEntry {
  id: number;
  website_id: number;
  keyword: string;
  period_type: string;
  period_value: string | null;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface TrendKeywordMatchPage {
  page_id: number;
  url: string;
  title: string;
  score: number;
}

export interface TrendKeywordMatchItem {
  keyword: string;
  weight: number;
  matched_count: number;
  matched_pages: TrendKeywordMatchPage[];
}

export interface TrendKeywordMatchPreviewResponse {
  website_id: number;
  items: TrendKeywordMatchItem[];
}

export interface AIModelInfo {
  id: string;
  provider: string;
  label: string;
  available: boolean;
}

export interface WebsiteGenerationSettings {
  website_id: number;
  settings: Record<string, unknown>;
}

export interface GenerationPreview {
  pages_count: number;
  estimated_pins: number;
  mode: string;
  sample: Array<{
    page_id: number;
    title: string | null;
    url: string;
    images_used: number;
    pins_projected: number;
  }>;
}

export interface PlaceholderInfo {
  placeholders: Array<{ name: string; description: string }>;
  languages: string[];
}

export interface PlaygroundPageItem {
  id: number;
  url: string;
  title: string;
  description: string;
  alt_text: string;
  board: string;
  images: string[];
}

export interface PlaygroundTemplateItem {
  id: number;
  name: string;
  path: string;
  image_count: number;
  thumbnail_url: string;
}

export interface PlaygroundFontSet {
  id: string;
  main: string;
  secondary: string;
  accent: string;
  font_file?: string;
}

export interface PlaygroundSettings {
  selected_templates: number[];
  default_template_id?: number | null;
  font_set: string;
  font_color: string;
  title_scale?: number;
  title_padding_x?: number;
  line_height_multiplier?: number;
  ai_settings?: Record<string, unknown>;
  image_settings?: Record<string, unknown>;
  display_settings?: Record<string, unknown>;
  advanced_settings?: Record<string, unknown>;
}

export interface PlaygroundPreviewMeta {
  title: string;
  image_title: string;
  description: string;
  alt_text: string;
  board: string;
  image_url: string;
  outbound_url: string;
  template_name: string;
  template_path: string;
  font_set_id?: string | null;
  font_color?: string | null;
}

export interface PlaygroundScrapeImagesResponse {
  images: string[];
  title: string;
  description: string;
}

export interface PlaygroundGeneratedContent {
  title: string;
  description: string;
  alt_text: string;
}

// API Functions
export const apiClient = {
  // Health check
  health: () => api.get('/health'),
  authStatus: () => api.get<AuthStatus>('/auth/status'),
  login: (password: string) => api.post<AuthStatus>('/auth/login', { password }),
  logout: () => api.post<AuthStatus>('/auth/logout'),

  // Websites
  listWebsites: () => api.get<Website[]>('/websites'),
  createWebsite: (data: { name: string; url: string; sitemap_url?: string }) =>
    api.post<Website>('/websites', data),
  getWebsite: (id: number) => api.get<Website>(`/websites/${id}`),
  updateWebsite: (id: number, data: { name?: string; url?: string; sitemap_url?: string }) =>
    api.patch<Website>(`/websites/${id}`, data),
  deleteWebsite: (id: number) => api.delete(`/websites/${id}`),
  importSitemap: (id: number) => api.post<{ total_urls: number; new_pages: number; updated_pages: number; errors: string[] }>(`/websites/${id}/sitemap`),
  importSitemapWithGroups: (id: number, selected_sitemaps: string[]) =>
    api.post<{ total_urls: number; new_pages: number; updated_pages: number; errors: string[] }>(`/websites/${id}/sitemap`, { selected_sitemaps }),
  listSitemapGroups: (id: number) => api.get<{ sitemap_url: string; groups: SitemapGroup[] }>(`/websites/${id}/sitemap-groups`),
  getWebsiteGenerationSettings: (id: number) =>
    api.get<WebsiteGenerationSettings>(`/websites/${id}/generation-settings`),
  updateWebsiteGenerationSettings: (id: number, settings: Record<string, unknown>) =>
    api.put<WebsiteGenerationSettings>(`/websites/${id}/generation-settings`, { settings }),
  listWebsitePages: (id: number) => api.get<Page[]>(`/websites/${id}/pages`),
  listAllPages: () => api.get<Page[]>('/websites/pages/all'),
  updatePage: (id: number, data: { is_enabled?: boolean; title?: string }) =>
    api.patch<Page>(`/websites/pages/${id}`, data),
  updatePagesBulk: (data: { page_ids: number[]; is_enabled: boolean }) =>
    api.patch<PageBulkUpdateResponse>('/websites/pages/bulk', data),

  // Keywords
  uploadKeywords: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{
      total_rows: number;
      matched_pages: number;
      unmatched_urls: string[];
      duplicates_skipped: number;
      errors: string[];
    }>('/keywords/upload', formData);
  },
  uploadTrendKeywords: (websiteId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<TrendKeywordUploadResponse>('/keywords/trend/upload', formData, {
      params: { website_id: websiteId },
    });
  },
  getKeywordsStatus: () => api.get<{
    total_pages: number;
    pages_with_keywords: number;
    total_keywords: number;
    coverage_percent: number;
  }>('/keywords'),
  listKeywordEntries: (params: { website_id: number; limit?: number }) =>
    api.get<KeywordEntry[]>('/keywords/entries', { params }),
  updateKeywordEntry: (data: { url: string; keywords: string }) =>
    api.patch<KeywordEntry>('/keywords/entries', data),
  deleteKeywordEntry: (url: string) =>
    api.delete('/keywords/entries', { params: { url } }),
  listTrendKeywords: (websiteId: number) =>
    api.get<TrendKeywordEntry[]>(`/websites/${websiteId}/trend-keywords`),
  getTrendKeywordMatchPreview: (params: { website_id: number; pages_per_keyword?: number; min_score?: number }) =>
    api.get<TrendKeywordMatchPreviewResponse>('/keywords/trend/match-preview', { params }),

  // Templates
  listTemplates: () => api.get<Template[]>('/templates'),
  uploadTemplate: (name: string, file: File) => {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', file);
    // Axios will automatically set Content-Type for FormData
    return api.post<Template>('/templates/upload', formData);
  },
  getTemplate: (id: number) => api.get<Template>(`/templates/${id}`),
  getTemplateSvg: (id: number) => api.get<string>(`/templates/${id}/file`, { responseType: 'text' as const }),
  startTemplateDetection: (templateId: number, max_regions = 10) =>
    api.post<TemplateDetectionStartResponse>(`/templates/${templateId}/detect/start`, { max_regions }),
  finalizeTemplateDetection: (templateId: number, ocr_results: TemplateOCRResult[]) =>
    api.post<Template>(`/templates/${templateId}/detect/finalize`, { ocr_results }),
  updateTemplateManifest: (templateId: number, payload: TemplateManifestUpdatePayload) =>
    api.put<Template>(`/templates/${templateId}/manifest`, payload),
  addZone: (templateId: number, zone: {
    zone_type: 'text' | 'image';
    x: number;
    y: number;
    width: number;
    height: number;
    props: Record<string, unknown> | null;
  }) => api.post(`/templates/${templateId}/zones`, zone),
  updateZone: (templateId: number, zoneId: number, data: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    props?: Record<string, unknown> | null;
  }) => {
    const formData = new FormData();
    if (data.x !== undefined) formData.append('x', String(data.x));
    if (data.y !== undefined) formData.append('y', String(data.y));
    if (data.width !== undefined) formData.append('width', String(data.width));
    if (data.height !== undefined) formData.append('height', String(data.height));
    if (data.props !== undefined) formData.append('props', JSON.stringify(data.props));
    return api.patch<TemplateZone>(`/templates/${templateId}/zones/${zoneId}`, formData);
  },
  listTemplateFonts: () => api.get<{ fonts: Array<{ filename: string; family: string }> }>('/templates/fonts/list'),
  uploadTemplateFont: (file: File, family?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (family && family.trim()) {
      formData.append('family', family.trim());
    }
    return api.post<{ filename: string; family: string }>('/templates/fonts/upload', formData);
  },
  deleteZone: (templateId: number, zoneId: number) => api.delete(`/templates/${templateId}/zones/${zoneId}`),
  deleteTemplate: (id: number) => api.delete(`/templates/${id}`),

  // Playground
  getPlaygroundPages: (website_id: number) =>
    api.get<PlaygroundPageItem[]>('/playground/pages', { params: { website_id } }),
  getPlaygroundTemplates: () =>
    api.get<{ templates: PlaygroundTemplateItem[] }>('/playground/templates'),
  getPlaygroundFonts: () =>
    api.get<PlaygroundFontSet[]>('/playground/fonts'),
  getPlaygroundSettings: (website_id: number) =>
    api.get<PlaygroundSettings>('/playground/settings', { params: { website_id } }),
  savePlaygroundSettings: (website_id: number, settings: PlaygroundSettings) =>
    api.post<PlaygroundSettings>('/playground/settings', settings, { params: { website_id } }),
  getPlaygroundPreview: (params: {
    website_id: number;
    page_url: string;
    template_id: number;
    font_set_id?: string;
    font_color?: string;
    ai_settings?: Record<string, unknown>;
  }) =>
    api.get<PlaygroundPreviewMeta>('/playground/preview', {
      params: {
        website_id: params.website_id,
        page_url: params.page_url,
        template_id: params.template_id,
        font_set_id: params.font_set_id,
        font_color: params.font_color,
        ai_settings: params.ai_settings ? JSON.stringify(params.ai_settings) : undefined,
      },
    }),
  getPlaygroundScrapeImages: (url: string) =>
    api.get<PlaygroundScrapeImagesResponse>('/playground/scrape-images', { params: { url } }),
  generatePlaygroundContent: (payload: {
    website_id: number;
    page_url: string;
    ai_settings?: Record<string, unknown>;
  }) =>
    api.post<PlaygroundGeneratedContent>('/playground/generate-content', payload),

  // Images
  scrapePageImages: (pageId: number) => api.post<PageImage[]>(`/images/pages/${pageId}/scrape`),
  listImagePages: (params?: { website_id?: number; scrape_status?: string; search?: string; section?: string; sitemap_bucket?: string; enabled_state?: 'all' | 'enabled' | 'disabled' }) =>
    api.get<ImagePageSummary[]>('/images/pages', { params }),
  scrapePagesBatch: (page_ids: number[]) =>
    api.post<{ total: number; scraped: number; failed: number; errors: string[] }>('/images/pages/scrape', { page_ids }),
  getPageImages: (pageId: number) => api.get<PageImage[]>(`/images/pages/${pageId}/images`),
  proxyImageUrl: (url: string) => `/api/images/proxy?url=${encodeURIComponent(url)}`,
  updateImage: (id: number, data: { is_excluded: boolean }) =>
    api.patch<PageImage>(`/images/images/${id}`, data),
  getPendingPages: () => api.get<Array<{ id: number; url: string; title: string | null; website_id: number }>>('/images/pending'),
  getImageStats: () => api.get<{ total: number; excluded: number; available: number }>('/images/stats'),

  // Global Exclusions
  listGlobalExclusions: () => api.get<GlobalExcludedImage[]>('/images/global-exclusions'),
  createGlobalExclusion: (data: { url_pattern?: string; name_pattern?: string; reason: string }) =>
    api.post<GlobalExcludedImage>('/images/global-exclusions', data),
  deleteGlobalExclusion: (id: number) => api.delete(`/images/global-exclusions/${id}`),
  applyGlobalExclusion: (id: number) =>
    api.post<{ rule_id: number; matched: number; applied: boolean }>(`/images/global-exclusions/${id}/apply`),

  // Pins
  generatePins: (data: {
    template_id: number;
    page_ids?: number[];
    website_id?: number;
    language?: string;
    board_name: string;
    generate_descriptions?: boolean;
    tone?: string;
    keyword_mode?: 'auto' | 'manual';
    manual_keywords?: string;
    cta_style?: 'soft' | 'strong' | 'none';
    title_max?: number;
    description_max?: number;
    mode?: 'conservative' | 'matrix';
    variation_options?: Record<string, number | boolean>;
    top_n?: number;
    similarity_threshold?: number;
    diversity_enabled?: boolean;
    diversity_penalty?: number;
    semantic_enabled?: boolean;
    render_settings?: PinRenderSettings;
    use_ai_titles?: boolean;
  }) =>
    api.post<PinDraft[]>('/pins/generate', data),
  startGenerationJob: (data: {
    template_id: number;
    page_ids?: number[];
    website_id?: number;
    language?: string;
    board_name: string;
    generate_descriptions?: boolean;
    tone?: string;
    keyword_mode?: 'auto' | 'manual';
    manual_keywords?: string;
    cta_style?: 'soft' | 'strong' | 'none';
    title_max?: number;
    description_max?: number;
    mode?: 'conservative' | 'matrix';
    variation_options?: Record<string, number | boolean>;
    top_n?: number;
    similarity_threshold?: number;
    diversity_enabled?: boolean;
    diversity_penalty?: number;
    semantic_enabled?: boolean;
    render_settings?: PinRenderSettings;
    use_ai_titles?: boolean;
  }) => api.post<GenerationJob>('/pins/generate-job', data),
  getGenerationJob: (id: number) => api.get<GenerationJob>(`/pins/generate-jobs/${id}`),
  previewPins: (data: {
    template_id: number;
    page_ids?: number[];
    website_id?: number;
    mode?: 'conservative' | 'matrix';
    variation_options?: Record<string, number | boolean>;
    top_n?: number;
    similarity_threshold?: number;
    diversity_enabled?: boolean;
    diversity_penalty?: number;
    semantic_enabled?: boolean;
  }) => api.post<GenerationPreview>('/pins/preview', data),
  listPins: (params?: { status?: string; is_selected?: boolean; website_id?: number }) =>
    api.get<PinDraft[]>('/pins', { params }),
  getPin: (id: number) => api.get<PinDraft>(`/pins/${id}`),
  getPinDetail: (id: number) => api.get<PinDetail>(`/pins/${id}/detail`),
  updatePin: (id: number, data: {
    template_id?: number;
    selected_image_url?: string;
    title?: string;
    description?: string;
    board_name?: string;
    keywords?: string;
    text_zone_y?: number;
    text_zone_height?: number;
    text_zone_pad_left?: number;
    text_zone_pad_right?: number;
    font_family?: string;
    text_color?: string;
    custom_font_file?: string | null;
    text_effect?: 'none' | 'drop' | 'echo' | 'outline';
    text_effect_color?: string;
    text_effect_offset_x?: number;
    text_effect_offset_y?: number;
    text_effect_blur?: number;
    status?: string;
    is_selected?: boolean;
  }) => api.patch<PinDraft>(`/pins/${id}`, data),
  clearPins: (data?: { pin_ids?: number[]; selected_only?: boolean }) =>
    api.delete('/pins', { data }),
  getPinsSummary: () => api.get<{
    total: number;
    by_status: Record<string, number>;
    selected: number;
  }>('/pins/stats/summary'),
  renderPin: (id: number, data: { settings?: PinRenderSettings }) =>
    api.post<PinDraft>(`/pins/${id}/render`, data),
  regeneratePins: (data: { template_id: number; settings?: PinRenderSettings }) =>
    api.post<{ message: string; pin_count: number; template_id: number }>('/pins/regenerate', data),
  regeneratePinPreview: (id: number, data?: {
    template_id?: number | null;
    selected_image_url?: string | null;
    regenerate_ai_content?: boolean;
    ai_settings?: Record<string, unknown>;
  }) =>
    api.post<{
      pin_id: number;
      template_id: number;
      template_name: string;
      template_path: string;
      selected_image_url: string | null;
      available_images: string[];
      candidate: {
        title: string;
        description: string;
        board_name: string;
      };
    }>(`/pins/${id}/regenerate-preview`, data || {}),
  regeneratePinApply: (id: number, data: {
    template_id?: number | null;
    selected_image_url?: string | null;
    title?: string | null;
    description?: string | null;
    board_name?: string | null;
    render_settings?: PinRenderSettings;
  }) =>
    api.post<PinDraft>(`/pins/${id}/regenerate-apply`, data),

  // Schedule
  getScheduleSettings: () => api.get<ScheduleSettings>('/schedule'),
  updateScheduleSettings: (data: {
    pins_per_day: number;
    start_hour: number;
    end_hour: number;
    min_days_reuse: number;
    timezone: string;
    random_minutes: boolean;
    warmup_month: boolean;
    floating_days: boolean;
    max_floating_minutes: number;
  }) => api.post<ScheduleSettings>('/schedule', data),

  // Workflow
  getWorkflowStatus: (website_id: number) =>
    api.get<WorkflowStatusResponse>('/workflow/status', { params: { website_id } }),
  generateWorkflowNextBatch: (website_id: number, force = false) =>
    api.post<{ job_id: number; status: string; message: string; expired_stale_jobs?: number }>(
      '/workflow/generate-next',
      null,
      { params: { website_id, force } },
    ),
  getWorkflowPinCountPreview: (params: {
    website_id: number;
    year: number;
    month: number;
    daily_pin_count?: number;
    floating_days?: boolean;
    warmup_month?: boolean;
  }) =>
    api.get<WorkflowPinCountPreviewResponse>('/workflow/pin-count-preview', { params }),
  getWorkflowTimeWindowPreview: (params: {
    website_id: number;
    year: number;
    month: number;
    start_hour?: number;
    end_hour?: number;
    floating_start_end_hours?: boolean;
    start_window_flex_minutes?: number;
    end_window_flex_minutes?: number;
  }) =>
    api.get<WorkflowTimeWindowPreviewResponse>('/workflow/time-window-preview', { params }),

  // Export
  exportCsv: (data: { selected_only: boolean; pin_ids?: number[]; website_id?: number }) =>
    api.post<{
      pins_count: number;
      file_path: string;
      download_url: string;
    }>('/export', data),
  getExportHistory: () => api.get<Array<{
    id: number;
    pins_count: number;
    filename: string;
    created_at: string;
  }>>('/export/history'),
  downloadExport: (filename: string) => `${API_BASE}/export/download/${filename}`,

  // AI Presets
  listAIPresets: () => api.get<AIPromptPreset[]>('/ai-presets'),
  createAIPreset: (data: {
    name: string;
    target_field: 'title' | 'description' | 'board';
    prompt_template: string;
    model?: string;
    temperature?: number;
    max_tokens?: number | null;
    language?: string;
    is_default?: boolean;
  }) => api.post<AIPromptPreset>('/ai-presets', data),
  getAIPreset: (id: number) => api.get<AIPromptPreset>(`/ai-presets/${id}`),
  updateAIPreset: (id: number, data: {
    name?: string;
    target_field?: 'title' | 'description' | 'board';
    prompt_template?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number | null;
    language?: string;
    is_default?: boolean;
  }) => api.put<AIPromptPreset>(`/ai-presets/${id}`, data),
  deleteAIPreset: (id: number) => api.delete(`/ai-presets/${id}`),
  setDefaultAIPreset: (id: number) => api.post<AIPromptPreset>(`/ai-presets/${id}/set-default`),
  getAISettings: () => api.get<AISettings>('/ai-presets/settings'),
  updateAISettings: (data: {
    default_title_preset_id?: number | null;
    default_description_preset_id?: number | null;
    default_board_preset_id?: number | null;
    default_language?: string;
    use_ai_by_default?: boolean;
  }) => api.put<AISettings>('/ai-presets/settings', data),
  getPlaceholderInfo: () => api.get<PlaceholderInfo>('/ai-presets/placeholders'),
  listAIModels: () => api.get<{ models: AIModelInfo[] }>('/ai-presets/models'),

};

export default apiClient;
