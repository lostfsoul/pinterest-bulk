import { useEffect, useMemo, useState } from 'react';
import apiClient, {
  AIPromptPreset,
  ImagePageSummary,
  PageImage,
  PinDraft,
  PinRenderSettings,
  Template,
  Website,
} from '../services/api';
import { Button } from '../components/Button';
import { PinPreview } from '../components/PinPreview';

const UNKNOWN_SITEMAP_KEY = '__unknown_sitemap__';

const FONT_OPTIONS = [
  { label: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Oswald Bold', value: '"Oswald", Impact, sans-serif' },
  { label: 'Montserrat Black', value: '"Montserrat", Arial Black, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", Arial, sans-serif' },
];

type ScrapeStatus = 'all' | 'pending' | 'scraped';

type EditorSettings = {
  textZoneY: number;
  textZoneHeight: number;
  textZonePadLeft: number;
  textZonePadRight: number;
  fontFamily: string;
  textColor: string;
};

function getTemplateDefaults(template: Template): EditorSettings {
  const textZone = template.zones?.find((zone) => zone.zone_type === 'text');
  return {
    textZoneY: textZone?.y ?? Math.round(template.height * 0.44),
    textZoneHeight: textZone?.height ?? Math.round(template.height * 0.12),
    textZonePadLeft: 0,
    textZonePadRight: 0,
    fontFamily: '"Bebas Neue", Impact, sans-serif',
    textColor: String(textZone?.props?.text_color ?? '#000000'),
  };
}

function settingsToApi(settings: EditorSettings): PinRenderSettings {
  return {
    text_zone_y: settings.textZoneY,
    text_zone_height: settings.textZoneHeight,
    text_zone_pad_left: settings.textZonePadLeft,
    text_zone_pad_right: settings.textZonePadRight,
    font_family: settings.fontFamily,
    text_color: settings.textColor,
  };
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

export default function Generate() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [pages, setPages] = useState<ImagePageSummary[]>([]);
  const [pageImages, setPageImages] = useState<Map<number, PageImage[]>>(new Map());
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [expandedSitemapSources, setExpandedSitemapSources] = useState<Set<string>>(new Set());
  const [selectedWebsiteId, setSelectedWebsiteId] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>('all');
  const [boardName, setBoardName] = useState('General');
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [settings, setSettings] = useState<EditorSettings>({
    textZoneY: 693,
    textZoneHeight: 189,
    textZonePadLeft: 0,
    textZonePadRight: 0,
    fontFamily: '"Bebas Neue", Impact, sans-serif',
    textColor: '#000000',
  });
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiPresets, setAiPresets] = useState<AIPromptPreset[]>([]);
  const [titlePresetId, setTitlePresetId] = useState<number | null>(null);
  const [descriptionPresetId, setDescriptionPresetId] = useState<number | null>(null);
  const [boardPresetId, setBoardPresetId] = useState<number | null>(null);
  const [useAISettings, setUseAISettings] = useState(true);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const previewPages = useMemo(
    () => (selectedPageIds.size > 0 ? pages.filter((page) => selectedPageIds.has(page.id)) : pages),
    [pages, selectedPageIds],
  );
  const previewPage = previewPages[currentPreviewIndex] ?? null;
  const visiblePages = useMemo(() => {
    const term = pageSearch.trim().toLowerCase();
    return pages.filter((page) => {
      if (scrapeStatus === 'pending' && page.scraped_at) return false;
      if (scrapeStatus === 'scraped' && !page.scraped_at) return false;
      if (!term) return true;
      const title = (page.title || '').toLowerCase();
      const url = page.url.toLowerCase();
      return title.includes(term) || url.includes(term);
    });
  }, [pages, pageSearch, scrapeStatus]);

  const sitemapPageMap = useMemo(() => {
    const map = new Map<string, ImagePageSummary[]>();
    for (const page of visiblePages) {
      const source = page.sitemap_source?.trim() || UNKNOWN_SITEMAP_KEY;
      if (!map.has(source)) {
        map.set(source, []);
      }
      map.get(source)?.push(page);
    }
    for (const entries of map.values()) {
      entries.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    }
    return map;
  }, [visiblePages]);

  const groupedPagesBySitemap = useMemo(
    () =>
      Array.from(sitemapPageMap.entries()).sort(([a], [b]) => {
        if (a === UNKNOWN_SITEMAP_KEY) return 1;
        if (b === UNKNOWN_SITEMAP_KEY) return -1;
        return a.localeCompare(b);
      }),
    [sitemapPageMap],
  );

  const totalVisiblePages = visiblePages.length;
  const selectedVisibleCount = useMemo(
    () => visiblePages.filter((page) => selectedPageIds.has(page.id)).length,
    [visiblePages, selectedPageIds],
  );
  const pageSectionById = useMemo(
    () => new Map(pages.map((page) => [page.id, page.section || 'uncategorized'])),
    [pages],
  );
  const generatedPinsByCategory = useMemo(() => {
    const groups = new Map<string, PinDraft[]>();
    for (const pin of pins) {
      const category = (pageSectionById.get(pin.page_id) || 'uncategorized').trim();
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)?.push(pin);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, categoryPins]) => [
        category,
        [...categoryPins].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      ] as const);
  }, [pins, pageSectionById]);

  useEffect(() => {
    loadData().catch((error) => {
      console.error('Failed to load generate page:', error);
    });
  }, []);

  useEffect(() => {
    if (!selectedTemplate) return;
    setSettings(getTemplateDefaults(selectedTemplate));
  }, [selectedTemplateId]);

  useEffect(() => {
    setCurrentPreviewIndex(0);
  }, [selectedPageIds]);

  useEffect(() => {
    if (!previewPage) return;
    loadPageImages(previewPage.id).catch((error) => {
      console.error('Failed to load preview images:', error);
    });
  }, [previewPage?.id]);

  useEffect(() => {
    if (!selectedWebsiteId) {
      setPages([]);
      setSelectedPageIds(new Set());
      setExpandedSitemapSources(new Set());
      return;
    }

    loadPagesForWebsite(Number(selectedWebsiteId)).catch((error) => {
      console.error('Failed to load website pages:', error);
    });
  }, [selectedWebsiteId]);

  async function loadData() {
    try {
      const [templatesRes, websitesRes, pinsRes, aiPresetsRes] = await Promise.all([
        apiClient.listTemplates(),
        apiClient.listWebsites(),
        apiClient.listPins(),
        apiClient.listAIPresets(),
      ]);
      setTemplates(templatesRes.data);
      setWebsites(websitesRes.data);
      setPins(pinsRes.data);
      setAiPresets(aiPresetsRes.data);

      if (templatesRes.data.length > 0) {
        setSelectedTemplateId(templatesRes.data[0].id);
        setSettings(getTemplateDefaults(templatesRes.data[0]));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadPagesForWebsite(websiteId: number) {
    setLoading(true);
    try {
      const response = await apiClient.listImagePages({
        website_id: websiteId,
      });
      const enabledPages = response.data.filter((page) => page.is_enabled);
      const sources = new Set<string>();
      for (const page of enabledPages) {
        sources.add(page.sitemap_source?.trim() || UNKNOWN_SITEMAP_KEY);
      }

      setPages(enabledPages);
      setSelectedPageIds(new Set());
      setExpandedSitemapSources(sources);
      setCurrentPreviewIndex(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadPageImages(pageId: number) {
    if (pageImages.has(pageId)) {
      return pageImages.get(pageId) ?? [];
    }

    const response = await apiClient.getPageImages(pageId);
    const images = response.data.filter((image) => !image.is_excluded);
    setPageImages((prev) => new Map(prev).set(pageId, images));
    return images;
  }

  function updateSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    if (!selectedTemplateId) {
      alert('Please select a template');
      return;
    }

    setGenerating(true);
    try {
      if (!selectedWebsiteId) {
        alert('Please select a website first');
        setGenerating(false);
        return;
      }

      if (selectedPageIds.size === 0) {
        alert('Please select at least one page');
        setGenerating(false);
        return;
      }
      const pageIds = Array.from(selectedPageIds);

      const response = await apiClient.generatePins({
        template_id: selectedTemplateId,
        page_ids: pageIds,
        board_name: boardName,
        render_settings: settingsToApi(settings),
      });

      for (const pin of response.data) {
        await apiClient.renderPin(pin.id, { settings: settingsToApi(settings) });
      }

      const pinsRes = await apiClient.listPins();
      setPins(pinsRes.data);
    } catch (error) {
      console.error('Failed to generate pins:', error);
      alert('Failed to generate pins');
    } finally {
      setGenerating(false);
    }
  }

  function togglePageSelection(pageId: number) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedPageIds(new Set());
  }

  function selectAllPages() {
    setSelectedPageIds(new Set(visiblePages.map((page) => page.id)));
  }

  function toggleSitemapSelection(source: string) {
    const sourcePages = sitemapPageMap.get(source) ?? [];
    const allSelected = sourcePages.length > 0 && sourcePages.every((page) => selectedPageIds.has(page.id));
    const shouldSelect = !allSelected;

    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        for (const page of sourcePages) {
          next.add(page.id);
        }
      } else {
        for (const page of sourcePages) {
          next.delete(page.id);
        }
      }
      return next;
    });
  }

  function toggleSitemapExpanded(source: string) {
    setExpandedSitemapSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }

  function getSitemapDisplay(source: string) {
    if (source === UNKNOWN_SITEMAP_KEY) {
      return 'Unknown sitemap source';
    }
    const name = source.split('/').filter(Boolean).pop();
    return name || source;
  }

  async function clearAllPins() {
    if (!confirm('Delete all pin drafts?')) return;
    try {
      await apiClient.clearPins();
      setPins([]);
    } catch (error) {
      console.error('Failed to clear pins:', error);
      alert('Failed to clear pins');
    }
  }

  if (loading) {
    return <div className="text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Generate Pins</h1>
        <p className="text-gray-500 mt-1">Create rendered pins from stored pages, images, and templates</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Generate New Pins</h2>

        {templates.length === 0 ? (
          <p className="text-sm text-yellow-700">No templates available. Upload a template first.</p>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
              <select
                value={selectedTemplateId ?? ''}
                onChange={(event) => setSelectedTemplateId(Number(event.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.width}×{template.height})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Board Name</label>
              <input
                type="text"
                value={boardName}
                onChange={(event) => setBoardName(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="General"
              />
            </div>

            {/* AI Settings Collapsible */}
            <div className="border border-gray-200 rounded-md">
              <button
                type="button"
                onClick={() => setShowAISettings(!showAISettings)}
                className="w-full flex justify-between items-center p-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>AI Settings (Presets)</span>
                <span className={`transform transition-transform ${showAISettings ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>
              {showAISettings && (
                <div className="p-3 border-t border-gray-200 space-y-4 bg-gray-50">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useAISettings}
                      onChange={(e) => setUseAISettings(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium text-gray-700">Use AI Settings</span>
                  </label>

                  {useAISettings && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Title Preset</label>
                        <select
                          value={titlePresetId ?? ''}
                          onChange={(e) => setTitlePresetId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Use Default</option>
                          {aiPresets.filter(p => p.target_field === 'title').map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description Preset</label>
                        <select
                          value={descriptionPresetId ?? ''}
                          onChange={(e) => setDescriptionPresetId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Use Default</option>
                          {aiPresets.filter(p => p.target_field === 'description').map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Board Preset</label>
                        <select
                          value={boardPresetId ?? ''}
                          onChange={(e) => setBoardPresetId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Use Default</option>
                          {aiPresets.filter(p => p.target_field === 'board').map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {aiPresets.length === 0 && (
                    <p className="text-xs text-yellow-600">
                      No AI presets configured. Go to AI Settings to create presets.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">Generation Scope</label>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <select
                    value={selectedWebsiteId}
                    onChange={(event) => setSelectedWebsiteId(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Select website</option>
                    {websites.map((website) => (
                      <option key={website.id} value={website.id}>
                        {website.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scrape Status</label>
                  <select
                    value={scrapeStatus}
                    onChange={(event) => setScrapeStatus(event.target.value as ScrapeStatus)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    disabled={!selectedWebsiteId}
                  >
                    <option value="all">All pages</option>
                    <option value="pending">Pending only</option>
                    <option value="scraped">Scraped only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search Pages</label>
                  <input
                    type="text"
                    value={pageSearch}
                    onChange={(event) => setPageSearch(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Filter by page title or URL"
                    disabled={!selectedWebsiteId}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">
                  {selectedVisibleCount} selected of {totalVisiblePages} page{totalVisiblePages === 1 ? '' : 's'}
                </span>
                <div className="flex gap-3 text-xs">
                  <button onClick={selectAllPages} className="text-blue-600 hover:text-blue-800" disabled={!selectedWebsiteId}>
                    Select All Visible
                  </button>
                  <button onClick={clearSelection} className="text-gray-600 hover:text-gray-800" disabled={!selectedWebsiteId}>
                    Clear Selection
                  </button>
                </div>
              </div>

              <div className="border border-gray-300 rounded-md max-h-[28rem] overflow-y-auto divide-y divide-gray-200">
                {!selectedWebsiteId ? (
                  <div className="p-4 text-sm text-gray-500 text-center">
                    Select a website to load sitemap files and pages.
                  </div>
                ) : groupedPagesBySitemap.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500 text-center">No enabled pages available.</div>
                ) : (
                  groupedPagesBySitemap.map(([source, sourcePages]) => {
                    const selectedCount = sourcePages.filter((page) => selectedPageIds.has(page.id)).length;
                    const sourceChecked = sourcePages.length > 0 && selectedCount === sourcePages.length;
                    const expanded = expandedSitemapSources.has(source);

                    return (
                      <div key={source} className="bg-white">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                          <button
                            type="button"
                            onClick={() => toggleSitemapExpanded(source)}
                            className="text-gray-500 hover:text-gray-700 text-xs w-5"
                          >
                            {expanded ? '▼' : '▶'}
                          </button>
                          <input
                            type="checkbox"
                            checked={sourceChecked}
                            onChange={() => toggleSitemapSelection(source)}
                            className="h-4 w-4"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{getSitemapDisplay(source)}</p>
                            {source !== UNKNOWN_SITEMAP_KEY && (
                              <p className="text-[11px] text-gray-500 truncate">{source}</p>
                            )}
                          </div>
                          <span className="text-xs text-gray-600">
                            {selectedCount}/{sourcePages.length}
                          </span>
                        </div>

                        {expanded && (
                          <div className="divide-y divide-gray-100">
                            {sourcePages.map((page) => (
                              <label
                                key={page.id}
                                className={`flex items-start gap-2 px-6 py-2 cursor-pointer hover:bg-gray-50 ${
                                  selectedPageIds.has(page.id) ? 'bg-blue-50' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedPageIds.has(page.id)}
                                  onChange={() => togglePageSelection(page.id)}
                                  className="mt-1 h-4 w-4"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                                      {page.sitemap_bucket}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                                      {page.section}
                                    </span>
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded ${
                                        page.scraped_at ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                      }`}
                                    >
                                      {page.scraped_at ? 'Scraped' : 'Pending'}
                                    </span>
                                  </div>
                                  <p className="text-sm font-medium text-gray-900 truncate">{page.title || 'Untitled'}</p>
                                  <p className="text-xs text-gray-500 truncate">{page.url}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <Button onClick={handleGenerate} disabled={generating || !selectedTemplateId || !selectedWebsiteId}>
                {generating ? 'Generating...' : 'Generate and Render Pins'}
              </Button>
              {selectedPageIds.size > 0 && (
                <span className="text-sm text-gray-500 self-center">
                  Generation will use {selectedPageIds.size} selected page{selectedPageIds.size === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {selectedTemplate && previewPage && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">
            Live Preview {selectedPageIds.size > 0 ? `(${selectedPageIds.size} selected pages)` : ''}
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-6">
            <div className="space-y-4">
              <div className="bg-gray-100 border rounded p-4 text-center">
                <div className="flex justify-center" style={{ maxWidth: '380px', margin: '0 auto' }}>
                  <PinPreview
                    template={selectedTemplate}
                    imageUrls={(pageImages.get(previewPage.id) || []).map((image) => apiClient.proxyImageUrl(image.url))}
                    title={previewPage.title || 'Untitled'}
                    settings={settings}
                    onZoneChange={(zone, value) => updateSetting(zone, value as never)}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {previewPage.title || 'Untitled'} • {(pageImages.get(previewPage.id) || []).length} images available
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setCurrentPreviewIndex((index) => Math.max(0, index - 1))}
                  disabled={currentPreviewIndex === 0}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCurrentPreviewIndex((index) => Math.min(previewPages.length - 1, index + 1))}
                  disabled={currentPreviewIndex >= previewPages.length - 1}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Zone Y: {settings.textZoneY}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max={selectedTemplate.height}
                    value={settings.textZoneY}
                    onChange={(event) => updateSetting('textZoneY', Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Zone Height: {settings.textZoneHeight}px
                  </label>
                  <input
                    type="range"
                    min="40"
                    max="500"
                    value={settings.textZoneHeight}
                    onChange={(event) => updateSetting('textZoneHeight', Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Left Padding: {settings.textZonePadLeft}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max={Math.round(selectedTemplate.width * 0.4)}
                    value={settings.textZonePadLeft}
                    onChange={(event) => updateSetting('textZonePadLeft', Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Right Padding: {settings.textZonePadRight}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max={Math.round(selectedTemplate.width * 0.4)}
                    value={settings.textZonePadRight}
                    onChange={(event) => updateSetting('textZonePadRight', Number(event.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Font Family</label>
                <select
                  value={settings.fontFamily}
                  onChange={(event) => updateSetting('fontFamily', event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Text Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={settings.textColor}
                    onChange={(event) => updateSetting('textColor', event.target.value)}
                    className="h-10 w-16"
                  />
                  <input
                    type="text"
                    value={settings.textColor.toUpperCase()}
                    onChange={(event) => {
                      const next = normalizeHexColor(event.target.value);
                      if (next) {
                        updateSetting('textColor', next);
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm uppercase"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Adjust the zone directly on the preview or with the controls here. Generated pins will persist these settings.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">Generated Pins ({pins.length})</h2>
          {pins.length > 0 && (
            <Button variant="danger" size="sm" onClick={clearAllPins}>
              Clear All
            </Button>
          )}
        </div>

        {pins.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No pins generated yet.</div>
        ) : (
          <div className="divide-y divide-gray-200 max-h-[520px] overflow-y-auto">
            {generatedPinsByCategory.map(([category, categoryPins]) => (
              <div key={category}>
                <div className="px-4 py-2 bg-gray-50 text-xs font-semibold uppercase text-gray-600 border-b border-gray-200">
                  {category} ({categoryPins.length})
                </div>
                {categoryPins.map((pin) => (
                  <div key={pin.id} className="p-4 hover:bg-gray-50">
                    <div className="flex gap-4">
                      {pin.media_url ? (
                        <img src={pin.media_url} alt="" className="w-20 h-20 object-cover rounded" />
                      ) : (
                        <div className="w-20 h-20 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
                          No image
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{pin.title || 'Untitled'}</p>
                        <p className="text-sm text-gray-500 truncate">{pin.link}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">{pin.status}</span>
                          {pin.board_name && <span>{pin.board_name}</span>}
                          {pin.font_family && <span>{pin.font_family.split(',')[0].replace(/"/g, '')}</span>}
                          {pin.text_color && <span>{pin.text_color}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
