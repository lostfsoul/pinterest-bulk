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

export interface Template {
  id: number;
  name: string;
  filename: string;
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

export interface SitemapGroup {
  sitemap_url: string;
  label: string;
  bucket: string;
  is_default: boolean;
}

export interface WebsiteOverview {
  id: number;
  name: string;
  url: string;
  enabled_pages: number;
  scraped_pages: number;
  generated_pages: number;
  scheduled_pins: number;
  scheduled_until: string | null;
  total_pins: number;
  status: 'scheduled' | 'generated' | 'indexed' | 'paused';
}

export interface Board {
  id: number;
  website_id: number;
  name: string;
  source_type: 'manual' | 'ai';
  keywords: string | null;
  source_page_ids: number[] | null;
  priority: number;
  created_at: string;
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
  random_minutes: boolean;
  warmup_month: boolean;
  floating_days: boolean;
  max_floating_minutes: number;
  updated_at: string;
}

export interface AnalyticsSummary {
  websites: number;
  pages: number;
  enabled_pages: number;
  keywords: number;
  pages_with_keywords: number;
  templates: number;
  images_total: number;
  images_excluded: number;
  images_available: number;
  pins_total: number;
  pins_draft: number;
  pins_ready: number;
  pins_exported: number;
  pins_skipped: number;
  exports_count: number;
  exports_pins_total: number;
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
  id: number;
  page_id: number;
  website_id: number;
  website_name: string;
  page_title: string | null;
  page_url: string;
  keyword: string;
  keyword_role: 'selection' | 'seo';
  period_type: 'always' | 'month' | 'season';
  period_value: string | null;
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
  getKeywordsStatus: () => api.get<{
    total_pages: number;
    pages_with_keywords: number;
    total_keywords: number;
    coverage_percent: number;
    by_period_type: Record<string, number>;
    by_role?: Record<string, number>;
  }>('/keywords'),
  listKeywordEntries: (params?: { website_id?: number; period_type?: 'always' | 'month' | 'season'; keyword_role?: 'selection' | 'seo'; search?: string; limit?: number }) =>
    api.get<KeywordEntry[]>('/keywords/entries', { params }),
  updateKeywordEntry: (id: number, data: {
    keyword: string;
    keyword_role?: 'selection' | 'seo';
    period_type: 'always' | 'month' | 'season';
    period_value?: string | null;
  }) => api.patch<KeywordEntry>(`/keywords/entries/${id}`, data),
  deleteKeywordEntry: (id: number) => api.delete(`/keywords/entries/${id}`),

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
  uploadTemplateFont: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ filename: string; family: string }>('/templates/fonts/upload', formData);
  },
  deleteZone: (templateId: number, zoneId: number) => api.delete(`/templates/${templateId}/zones/${zoneId}`),
  deleteTemplate: (id: number) => api.delete(`/templates/${id}`),

  // Images
  scrapePageImages: (pageId: number) => api.post<PageImage[]>(`/images/pages/${pageId}/scrape`),
  listImagePages: (params?: { website_id?: number; scrape_status?: string; search?: string; section?: string; sitemap_bucket?: string }) =>
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
  }) => api.post<GenerationPreview>('/pins/preview', data),
  listPins: (params?: { status?: string; is_selected?: boolean }) =>
    api.get<PinDraft[]>('/pins', { params }),
  getPin: (id: number) => api.get<PinDraft>(`/pins/${id}`),
  updatePin: (id: number, data: {
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

  // Schedule
  getScheduleSettings: () => api.get<ScheduleSettings>('/schedule'),
  updateScheduleSettings: (data: {
    pins_per_day: number;
    start_hour: number;
    end_hour: number;
    min_days_reuse: number;
    random_minutes: boolean;
    warmup_month: boolean;
    floating_days: boolean;
    max_floating_minutes: number;
  }) => api.post<ScheduleSettings>('/schedule', data),

  // Export
  exportCsv: (data: { selected_only: boolean; pin_ids?: number[] }) =>
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

  // Boards
  listBoards: (website_id: number) => api.get<Board[]>('/boards', { params: { website_id } }),
  createBoard: (data: { website_id: number; name: string; source_type?: 'manual' | 'ai'; keywords?: string; source_page_ids?: number[] | null; priority?: number }) =>
    api.post<Board>('/boards', data),
  updateBoard: (id: number, data: { name?: string; keywords?: string; source_page_ids?: number[] | null; priority?: number }) =>
    api.patch<Board>(`/boards/${id}`, data),
  deleteBoard: (id: number) => api.delete(`/boards/${id}`),
  suggestBoards: (data: { website_id: number; count?: number; page_ids?: number[] }) =>
    api.post<{ website_id: number; page_ids_used: number[]; suggestions: string[] }>('/boards/suggest', data),

  // Analytics
  getAnalyticsSummary: () => api.get<AnalyticsSummary>('/analytics/summary'),
  getWebsitesOverview: () => api.get<WebsiteOverview[]>('/analytics/websites-overview'),
};

export default apiClient;
