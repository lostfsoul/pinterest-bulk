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

export interface PageImage {
  id: number;
  page_id: number;
  url: string;
  is_excluded: boolean;
  created_at: string;
}

export interface ImagePageSummary {
  id: number;
  website_id: number;
  website_name: string;
  url: string;
  title: string | null;
  is_enabled: boolean;
  scraped_at: string | null;
  created_at: string;
  section: string;
  images_total: number;
  images_available: number;
  images_excluded: number;
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
  font_family: string | null;
  text_color: string | null;
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
  font_family?: string;
  text_color?: string;
}

export interface ScheduleSettings {
  id: number;
  pins_per_day: number;
  start_hour: number;
  end_hour: number;
  min_days_reuse: number;
  random_minutes: boolean;
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

export interface ActivityLog {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuthStatus {
  authenticated: boolean;
  enabled: boolean;
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
  deleteWebsite: (id: number) => api.delete(`/websites/${id}`),
  importSitemap: (id: number) => api.post<{ total_urls: number; new_pages: number; updated_pages: number; errors: string[] }>(`/websites/${id}/sitemap`),
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
  }>('/keywords'),

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
  deleteZone: (templateId: number, zoneId: number) => api.delete(`/templates/${templateId}/zones/${zoneId}`),
  deleteTemplate: (id: number) => api.delete(`/templates/${id}`),

  // Images
  scrapePageImages: (pageId: number) => api.post<PageImage[]>(`/images/pages/${pageId}/scrape`),
  listImagePages: (params?: { website_id?: number; scrape_status?: string; search?: string; section?: string }) =>
    api.get<ImagePageSummary[]>('/images/pages', { params }),
  scrapePagesBatch: (page_ids: number[]) =>
    api.post<{ total: number; scraped: number; failed: number; errors: string[] }>('/images/pages/scrape', { page_ids }),
  getPageImages: (pageId: number) => api.get<PageImage[]>(`/images/pages/${pageId}/images`),
  proxyImageUrl: (url: string) => `/api/images/proxy?url=${encodeURIComponent(url)}`,
  updateImage: (id: number, data: { is_excluded: boolean }) =>
    api.patch<PageImage>(`/images/images/${id}`, data),
  getPendingPages: () => api.get<Array<{ id: number; url: string; title: string | null; website_id: number }>>('/images/pending'),
  getImageStats: () => api.get<{ total: number; excluded: number; available: number }>('/images/stats'),

  // Pins
  generatePins: (data: {
    template_id: number;
    page_ids?: number[];
    board_name: string;
    render_settings?: PinRenderSettings;
    use_ai_titles?: boolean;
  }) =>
    api.post<PinDraft[]>('/pins/generate', data),
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
  clearPins: () => api.delete('/pins'),
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

  // Analytics
  getAnalyticsSummary: () => api.get<AnalyticsSummary>('/analytics/summary'),
  getActivityLogs: (limit = 100) => api.get<ActivityLog[]>(`/analytics/activity?limit=${limit}`),
  getImportHistory: (limit = 50) => api.get<{
    id: number;
    type: string;
    website_id: number | null;
    items_count: number;
    success_count: number;
    error_count: number;
    details: Record<string, unknown> | null;
    created_at: string;
  }[]>(`/analytics/history/import?limit=${limit}`),
};

export default apiClient;
