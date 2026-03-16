import { useEffect, useMemo, useState } from 'react';
import apiClient, {
  ImagePageSummary,
  PageImage,
  PinDraft,
  PinRenderSettings,
  Template,
  Website,
} from '../services/api';
import { Button } from '../components/Button';
import { PinPreview } from '../components/PinPreview';

const FONT_OPTIONS = [
  { label: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Oswald Bold', value: '"Oswald", Impact, sans-serif' },
  { label: 'Montserrat Black', value: '"Montserrat", Arial Black, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", Arial, sans-serif' },
];

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
  const [boardName, setBoardName] = useState('General');
  const [useAiTitles, setUseAiTitles] = useState(true);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [filters, setFilters] = useState({
    websiteId: '',
    section: '',
    scrapeStatus: 'all',
    search: '',
  });
  const [settings, setSettings] = useState<EditorSettings>({
    textZoneY: 693,
    textZoneHeight: 189,
    textZonePadLeft: 0,
    textZonePadRight: 0,
    fontFamily: '"Bebas Neue", Impact, sans-serif',
    textColor: '#000000',
  });

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const previewPages = useMemo(
    () => (selectedPageIds.size > 0 ? pages.filter((page) => selectedPageIds.has(page.id)) : pages),
    [pages, selectedPageIds],
  );
  const previewPage = previewPages[currentPreviewIndex] ?? null;
  const visibleSections = useMemo(
    () => Array.from(new Set(pages.map((page) => page.section).filter(Boolean) as string[])).sort(),
    [pages],
  );

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

  async function loadData() {
    try {
      const [templatesRes, websitesRes, pagesRes, pinsRes] = await Promise.all([
        apiClient.listTemplates(),
        apiClient.listWebsites(),
        apiClient.listImagePages(),
        apiClient.listPins(),
      ]);
      setTemplates(templatesRes.data);
      setWebsites(websitesRes.data);
      setPages(pagesRes.data.filter((page) => page.is_enabled));
      setPins(pinsRes.data);

      if (templatesRes.data.length > 0) {
        setSelectedTemplateId(templatesRes.data[0].id);
        setSettings(getTemplateDefaults(templatesRes.data[0]));
      }
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters() {
    setLoading(true);
    try {
      const response = await apiClient.listImagePages({
        website_id: filters.websiteId ? Number(filters.websiteId) : undefined,
        section: filters.section || undefined,
        scrape_status: filters.scrapeStatus || undefined,
        search: filters.search || undefined,
      });
      setPages(response.data.filter((page) => page.is_enabled));
      setSelectedPageIds(new Set());
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
      const pageIds = selectedPageIds.size > 0 ? Array.from(selectedPageIds) : undefined;
      const response = await apiClient.generatePins({
        template_id: selectedTemplateId,
        page_ids: pageIds,
        board_name: boardName,
        render_settings: settingsToApi(settings),
        use_ai_titles: useAiTitles,
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
    setSelectedPageIds(new Set(pages.map((page) => page.id)));
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

            <label className="flex items-start gap-3 rounded-md border border-gray-200 p-3">
              <input
                type="checkbox"
                checked={useAiTitles}
                onChange={(event) => setUseAiTitles(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">AI SEO Titles</div>
                <div className="text-xs text-gray-500">
                  Use `gpt-4o-mini` when `OPENAI_API_KEY` is configured. Falls back to keyword-merged titles.
                </div>
              </div>
            </label>

            <div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <select
                    value={filters.websiteId}
                    onChange={(event) => setFilters((prev) => ({ ...prev, websiteId: event.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">All websites</option>
                    {websites.map((website) => (
                      <option key={website.id} value={website.id}>
                        {website.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                  <select
                    value={filters.section}
                    onChange={(event) => setFilters((prev) => ({ ...prev, section: event.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">All sections</option>
                    {visibleSections.map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scrape status</label>
                  <select
                    value={filters.scrapeStatus}
                    onChange={(event) => setFilters((prev) => ({ ...prev, scrapeStatus: event.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="all">All pages</option>
                    <option value="pending">Pending only</option>
                    <option value="scraped">Scraped only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                    placeholder="Title or URL"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Pages ({selectedPageIds.size > 0 ? `${selectedPageIds.size} selected` : `${pages.length} available`})
                </label>
                <div className="flex gap-3 text-xs">
                  <button onClick={applyFilters} className="text-blue-600 hover:text-blue-800">Apply Filters</button>
                  <button onClick={selectAllPages} className="text-blue-600 hover:text-blue-800">Select All</button>
                  <button onClick={clearSelection} className="text-gray-600 hover:text-gray-800">Clear</button>
                </div>
              </div>
              <div className="border border-gray-300 rounded-md max-h-48 overflow-y-auto divide-y divide-gray-200">
                {pages.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500 text-center">No enabled pages available</div>
                ) : (
                  pages.map((page) => (
                    <label
                      key={page.id}
                      className={`flex items-start gap-2 p-2 cursor-pointer hover:bg-gray-50 ${
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
                          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">{page.website_name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">{page.section}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded ${page.scraped_at ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {page.scraped_at ? 'Scraped' : 'Pending'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">{page.title || 'Untitled'}</p>
                        <p className="text-xs text-gray-500 truncate">{page.url}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={generating || !selectedTemplateId}>
                {generating ? 'Generating...' : 'Generate and Render Pins'}
              </Button>
              {selectedPageIds.size > 0 && (
                <span className="text-sm text-gray-500 self-center">
                  Selected pages limit generation to {selectedPageIds.size} page{selectedPageIds.size === 1 ? '' : 's'}
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
            {pins.map((pin) => (
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
        )}
      </div>
    </div>
  );
}
