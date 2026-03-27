import { useEffect, useMemo, useState } from 'react';
import apiClient, { GlobalExcludedImage, ImagePageSummary, PageImage, Website } from '../services/api';
import { Button } from '../components/Button';

const UNKNOWN_SITEMAP_KEY = '__unknown_sitemap__';

type ScrapeStatus = 'all' | 'pending' | 'scraped';
type ImageCategory = 'all' | 'article' | 'featured' | 'other' | 'excluded';

export default function Images() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [pages, setPages] = useState<ImagePageSummary[]>([]);
  const [selectedPage, setSelectedPage] = useState<ImagePageSummary | null>(null);
  const [images, setImages] = useState<PageImage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [expandedSitemapSources, setExpandedSitemapSources] = useState<Set<string>>(new Set());
  const [selectedWebsiteId, setSelectedWebsiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>('all');
  const [pageSearch, setPageSearch] = useState('');

  // Global exclusions state
  const [globalExclusions, setGlobalExclusions] = useState<GlobalExcludedImage[]>([]);
  const [showExclusionPanel, setShowExclusionPanel] = useState(false);
  const [newExclusionReason, setNewExclusionReason] = useState<string>('other');

  // Category filter for image gallery
  const [categoryFilter, setCategoryFilter] = useState<ImageCategory>('all');

  useEffect(() => {
    loadInventory().catch((error) => {
      console.error('Failed to load image inventory:', error);
    });
  }, []);

  useEffect(() => {
    if (!selectedWebsiteId) {
      setPages([]);
      setSelectedPageIds(new Set());
      setExpandedSitemapSources(new Set());
      if (selectedPage) {
        setSelectedPage(null);
        setImages([]);
      }
      return;
    }

    loadPagesForWebsite(Number(selectedWebsiteId)).catch((error) => {
      console.error('Failed to load website pages:', error);
    });
  }, [selectedWebsiteId]);

  // Load global exclusions
  useEffect(() => {
    loadGlobalExclusions().catch(console.error);
  }, []);

  const visiblePages = useMemo(() => {
    const search = pageSearch.trim().toLowerCase();
    return pages.filter((page) => {
      if (scrapeStatus === 'pending' && page.scraped_at) return false;
      if (scrapeStatus === 'scraped' && !page.scraped_at) return false;
      if (!search) return true;
      const title = (page.title || '').toLowerCase();
      return title.includes(search) || page.url.toLowerCase().includes(search);
    });
  }, [pages, scrapeStatus, pageSearch]);

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

  async function loadInventory() {
    try {
      const websitesRes = await apiClient.listWebsites();
      setWebsites(websitesRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadGlobalExclusions() {
    const response = await apiClient.listGlobalExclusions();
    setGlobalExclusions(response.data);
  }

  async function loadPagesForWebsite(websiteId: number) {
    setLoading(true);
    try {
      const response = await apiClient.listImagePages({
        website_id: websiteId,
      });
      setPages(response.data);
      setSelectedPageIds(new Set());
      const sources = new Set<string>();
      for (const page of response.data) {
        sources.add(page.sitemap_source?.trim() || UNKNOWN_SITEMAP_KEY);
      }
      setExpandedSitemapSources(sources);
      if (selectedPage && !response.data.some((page) => page.id === selectedPage.id)) {
        setSelectedPage(null);
        setImages([]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectPage(page: ImagePageSummary) {
    setSelectedPage(page);
    const response = await apiClient.getPageImages(page.id);
    setImages(response.data);
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

  async function handleScrapeSingle(page: ImagePageSummary) {
    setScraping(true);
    try {
      const response = await apiClient.scrapePageImages(page.id);
      setImages(response.data);
      if (selectedWebsiteId) {
        await loadPagesForWebsite(Number(selectedWebsiteId));
      }
      setSelectedPage((prev) => (prev?.id === page.id ? { ...page, scraped_at: new Date().toISOString() } : prev));
    } catch (error) {
      console.error('Failed to scrape page images:', error);
      alert('Failed to scrape images');
    } finally {
      setScraping(false);
    }
  }

  async function handleBatchScrape(scope: 'selected' | 'filtered') {
    const pageIds = scope === 'selected' ? Array.from(selectedPageIds) : visiblePages.map((page) => page.id);
    if (pageIds.length === 0) {
      alert(`No ${scope} pages to scrape`);
      return;
    }

    setScraping(true);
    try {
      const response = await apiClient.scrapePagesBatch(pageIds);
      if (selectedWebsiteId) {
        await loadPagesForWebsite(Number(selectedWebsiteId));
      }
      if (selectedPage) {
        await selectPage(selectedPage);
      }
      if (response.data.errors.length > 0) {
        alert(`Scraped ${response.data.scraped}/${response.data.total} pages. ${response.data.errors.length} failed.`);
      }
    } catch (error) {
      console.error('Failed to batch scrape images:', error);
      alert('Batch scrape failed');
    } finally {
      setScraping(false);
    }
  }

  async function toggleImageExcluded(image: PageImage) {
    try {
      const response = await apiClient.updateImage(image.id, { is_excluded: !image.is_excluded });
      setImages((prev) => prev.map((item) => (item.id === image.id ? response.data : item)));
      if (selectedWebsiteId) {
        await loadPagesForWebsite(Number(selectedWebsiteId));
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image');
    }
  }

  async function excludeImageGlobally(image: PageImage) {
    if (!confirm('Exclude this image globally? It will be excluded from all pages.')) {
      return;
    }
    try {
      // Create exclusion based on URL pattern
      await apiClient.createGlobalExclusion({
        url_pattern: image.url,
        reason: 'other',
      });
      // Apply to all existing images
      const rules = await apiClient.listGlobalExclusions();
      const newRule = rules.data.find(r => r.url_pattern === image.url);
      if (newRule) {
        await apiClient.applyGlobalExclusion(newRule.id);
      }
      await loadGlobalExclusions();
      // Refresh images
      if (selectedPage) {
        const response = await apiClient.getPageImages(selectedPage.id);
        setImages(response.data);
      }
      if (selectedWebsiteId) {
        await loadPagesForWebsite(Number(selectedWebsiteId));
      }
    } catch (error) {
      console.error('Failed to exclude image globally:', error);
      alert('Failed to exclude image globally');
    }
  }

  async function createGlobalExclusion(urlPattern: string, namePattern: string, reason: string) {
    try {
      await apiClient.createGlobalExclusion({
        url_pattern: urlPattern || undefined,
        name_pattern: namePattern || undefined,
        reason,
      });
      await loadGlobalExclusions();
    } catch (error) {
      console.error('Failed to create exclusion rule:', error);
      alert('Failed to create exclusion rule');
    }
  }

  async function deleteGlobalExclusion(id: number) {
    if (!confirm('Delete this exclusion rule?')) {
      return;
    }
    try {
      await apiClient.deleteGlobalExclusion(id);
      await loadGlobalExclusions();
    } catch (error) {
      console.error('Failed to delete exclusion rule:', error);
      alert('Failed to delete exclusion rule');
    }
  }

  async function applyGlobalExclusion(id: number) {
    try {
      const response = await apiClient.applyGlobalExclusion(id);
      alert(`Applied rule. ${response.data.matched} images matched and excluded.`);
      if (selectedPage) {
        const pageResponse = await apiClient.getPageImages(selectedPage.id);
        setImages(pageResponse.data);
      }
      if (selectedWebsiteId) {
        await loadPagesForWebsite(Number(selectedWebsiteId));
      }
    } catch (error) {
      console.error('Failed to apply exclusion rule:', error);
      alert('Failed to apply exclusion rule');
    }
  }

  // Filter images by category
  // Filter images by category
  const filteredImages = useMemo(() => {
    if (categoryFilter === 'all') {
      return images;
    }
    if (categoryFilter === 'excluded') {
      // Show images that are excluded (either manually or by global rule)
      return images.filter(img => img.is_excluded || img.excluded_by_global_rule);
    }
    return images.filter(img => img.category === categoryFilter && !img.is_excluded && !img.excluded_by_global_rule);
  }, [images, categoryFilter]);

  // Count images by category
  const categoryCounts = useMemo(() => {
    const counts = { all: images.length, article: 0, featured: 0, other: 0, excluded: 0 };
    images.forEach(img => {
      // An image is excluded if is_excluded=True OR excluded_by_global_rule=True
      const isExcluded = img.is_excluded || img.excluded_by_global_rule;
      if (isExcluded) {
        counts.excluded++;
      } else if (img.category === 'article') {
        counts.article++;
      } else if (img.category === 'featured') {
        counts.featured++;
      } else {
        counts.other++;
      }
    });
    return counts;
  }, [images]);

  // Format file size
  function formatFileSize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Get category badge color
  function getCategoryBadgeColor(category: string): string {
    switch (category) {
      case 'featured': return 'bg-purple-100 text-purple-800 border border-purple-300';
      case 'article': return 'bg-amber-100 text-amber-800 border border-amber-300';
      case 'other': return 'bg-slate-100 text-slate-700 border border-slate-300';
      default: return 'bg-slate-100 text-slate-700 border border-slate-300';
    }
  }

  function toggleSitemapSelection(source: string) {
    const sourcePages = sitemapPageMap.get(source) ?? [];
    const allSelected = sourcePages.length > 0 && sourcePages.every((page) => selectedPageIds.has(page.id));
    const shouldSelect = !allSelected;
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        for (const page of sourcePages) next.add(page.id);
      } else {
        for (const page of sourcePages) next.delete(page.id);
      }
      return next;
    });
  }

  function toggleSitemapExpanded(source: string) {
    setExpandedSitemapSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  function getSitemapDisplay(source: string) {
    if (source === UNKNOWN_SITEMAP_KEY) return 'Unknown sitemap source';
    const name = source.split('/').filter(Boolean).pop();
    return name || source;
  }

  const pendingCount = visiblePages.filter((page) => !page.scraped_at).length;
  const scrapedCount = visiblePages.filter((page) => page.scraped_at).length;

  if (loading && pages.length === 0) {
    return <div className="text-gray-500">Loading image inventory...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Images</h1>
        <p className="text-gray-500 mt-1">Select website, then manage pages by sitemap file and scrape status</p>
      </div>

      <div className="bg-white border-2 border-black p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <select
              value={selectedWebsiteId}
              onChange={(event) => setSelectedWebsiteId(event.target.value)}
              className="w-full px-3 py-2 border-2 border-black rounded-none"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Scrape status</label>
            <select
              value={scrapeStatus}
              onChange={(event) => setScrapeStatus(event.target.value as ScrapeStatus)}
              className="w-full px-3 py-2 border-2 border-black rounded-none"
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
              value={pageSearch}
              onChange={(event) => setPageSearch(event.target.value)}
              placeholder="Title or URL"
              className="w-full px-3 py-2 border-2 border-black rounded-none"
              disabled={!selectedWebsiteId}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => handleBatchScrape('selected')} disabled={scraping || selectedPageIds.size === 0}>
            {scraping ? 'Scraping...' : `Scrape Selected (${selectedPageIds.size})`}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleBatchScrape('filtered')} disabled={scraping || visiblePages.length === 0}>
            Scrape Visible ({visiblePages.length})
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowExclusionPanel(!showExclusionPanel)}>
            {showExclusionPanel ? 'Hide' : 'Show'} Global Exclusions ({globalExclusions.length})
          </Button>
        </div>

        <div className="flex gap-6 text-sm text-gray-600">
          <span>{visiblePages.length} pages in view</span>
          <span>{pendingCount} pending</span>
          <span>{scrapedCount} scraped</span>
        </div>
      </div>

      {/* Global Exclusions Panel */}
      {showExclusionPanel && (
        <div className="bg-white border-2 border-black p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold uppercase text-gray-900">Global Exclusion Rules</h3>
            <p className="text-xs text-gray-500">Excluded images will be marked with a red "Global Rule" tag</p>
          </div>

          <div className="space-y-3">
            {globalExclusions.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No global exclusion rules. Create one below.</p>
            ) : (
              globalExclusions.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      {rule.url_pattern && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700" title="URL pattern">
                          URL: {rule.url_pattern.length > 30 ? rule.url_pattern.slice(0, 30) + '...' : rule.url_pattern}
                        </span>
                      )}
                      {rule.name_pattern && (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700" title="Name pattern">
                          Name: {rule.name_pattern}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                        {rule.reason}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => applyGlobalExclusion(rule.id)}>
                      Apply
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => deleteGlobalExclusion(rule.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Create new rule form */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Create New Exclusion Rule</h4>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="URL pattern (e.g., *tracking*)"
                className="flex-1 px-3 py-2 border-2 border-black rounded-none text-sm"
                id="new-url-pattern"
              />
              <input
                type="text"
                placeholder="Name pattern (e.g., *logo*)"
                className="flex-1 px-3 py-2 border-2 border-black rounded-none text-sm"
                id="new-name-pattern"
              />
              <select
                value={newExclusionReason}
                onChange={(e) => setNewExclusionReason(e.target.value)}
                className="px-3 py-2 border-2 border-black rounded-none text-sm"
              >
                <option value="other">Other</option>
                <option value="affiliate">Affiliate</option>
                <option value="logo">Logo</option>
                <option value="tracking">Tracking</option>
                <option value="icon">Icon</option>
                <option value="ad">Ad</option>
              </select>
              <Button
                size="sm"
                onClick={() => {
                  const urlInput = document.getElementById('new-url-pattern') as HTMLInputElement;
                  const nameInput = document.getElementById('new-name-pattern') as HTMLInputElement;
                  if (!urlInput.value && !nameInput.value) {
                    alert('Please enter at least one pattern');
                    return;
                  }
                  createGlobalExclusion(urlInput.value, nameInput.value, newExclusionReason);
                  urlInput.value = '';
                  nameInput.value = '';
                }}
              >
                Add Rule
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white border-2 border-black overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-black bg-bg-secondary">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold uppercase text-gray-900">Page Inventory</h2>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => setSelectedPageIds(new Set(visiblePages.map((page) => page.id)))}
                    className="text-blue-700 hover:text-blue-900"
                    disabled={!selectedWebsiteId}
                  >
                    Select All Visible
                  </button>
                  <button
                    onClick={() => setSelectedPageIds(new Set())}
                    className="text-gray-700 hover:text-gray-900"
                    disabled={!selectedWebsiteId}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
            <div className="divide-y divide-gray-200 max-h-[700px] overflow-y-auto">
              {!selectedWebsiteId ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">Select a website to load sitemap pages.</div>
              ) : groupedPagesBySitemap.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">No pages match the current filters.</div>
              ) : (
                groupedPagesBySitemap.map(([source, sourcePages]) => {
                  const selectedCount = sourcePages.filter((page) => selectedPageIds.has(page.id)).length;
                  const sourceChecked = sourcePages.length > 0 && selectedCount === sourcePages.length;
                  const expanded = expandedSitemapSources.has(source);

                  return (
                    <div key={source}>
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
                        <span className="text-xs text-gray-600">{selectedCount}/{sourcePages.length}</span>
                      </div>

                      {expanded && sourcePages.map((page) => (
                        <div
                          key={page.id}
                          className={`px-4 py-3 hover:bg-bg-secondary ${selectedPage?.id === page.id ? 'bg-accent text-white' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={selectedPageIds.has(page.id)}
                              onChange={() => togglePageSelection(page.id)}
                              className="mt-1 h-4 w-4"
                            />
                            <button className="flex-1 text-left min-w-0" onClick={() => selectPage(page)}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{page.website_name}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{page.section}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${page.scraped_at ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                  {page.scraped_at ? 'Scraped' : 'Pending'}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-gray-900 truncate">{page.title || 'Untitled'}</p>
                              <p className="text-xs text-gray-500 truncate">{page.url}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {page.images_available} available / {page.images_total} total
                              </p>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedPage ? (
            <div className="bg-white border-2 border-black p-6">
              <div className="flex justify-between items-start gap-4 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 font-bold">{selectedPage.website_name}</span>
                    <span className="text-xs px-2 py-0.5 bg-accent text-white font-bold">{selectedPage.section}</span>
                  </div>
                  <h2 className="font-black text-gray-900">{selectedPage.title || 'Untitled'}</h2>
                  <p className="text-sm text-gray-500 break-all">{selectedPage.url}</p>
                </div>
                <Button onClick={() => handleScrapeSingle(selectedPage)} disabled={scraping} size="sm">
                  {scraping ? 'Scraping...' : 'Scrape This Page'}
                </Button>
              </div>

              {/* Category Filter Tabs */}
              {images.length > 0 && (
                <div className="flex gap-2 mb-4 border-b pb-3">
                  {(['all', 'article', 'featured', 'other', 'excluded'] as ImageCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                        categoryFilter === cat
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      <span className="ml-1 opacity-75">({categoryCounts[cat]})</span>
                    </button>
                  ))}
                </div>
              )}

              {filteredImages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  {images.length === 0
                    ? 'No images stored for this page yet. Scrape it to review article images.'
                    : 'No images match the selected category filter.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto">
                  {filteredImages.map((image) => (
                    <div
                      key={image.id}
                      className={`relative border-2 overflow-hidden ${
                        image.is_excluded ? 'border-red-600 bg-red-50' : 'border-black bg-white'
                      }`}
                    >
                      {/* Global Rule indicator */}
                      {image.excluded_by_global_rule && (
                        <div className="absolute top-2 left-2 z-10">
                          <span className="text-xs px-2 py-0.5 bg-red-600 text-white font-bold uppercase">
                            Global Rule
                          </span>
                        </div>
                      )}

                      {/* HQ Badge */}
                      {image.is_hq && !image.is_excluded && (
                        <div className="absolute top-2 right-2 z-10">
                          <span className="text-xs px-2 py-0.5 bg-bg-primary text-black font-bold uppercase border-2 border-black">
                            HQ
                          </span>
                        </div>
                      )}

                      <img
                        src={image.url}
                        alt=""
                        className="w-full h-36 object-cover"
                        onError={(event) => {
                          (event.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23eee" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';
                        }}
                      />

                      <div className="p-2 bg-white">
                        {/* Category and Status row */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          {/* Category Badge */}
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryBadgeColor(image.category)}`}>
                            {image.category}
                          </span>

                          {/* Status indicator */}
                          {(() => {
                            const isEffectivelyExcluded = image.is_excluded || image.excluded_by_global_rule;
                            return (
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                isEffectivelyExcluded
                                  ? 'bg-red-100 text-red-700 border border-red-200'
                                  : 'bg-blue-100 text-blue-700 border border-blue-200'
                              }`}>
                                {isEffectivelyExcluded ? 'Excluded' : 'Included'}
                              </span>
                            );
                          })()}
                        </div>

                        {/* Metadata */}
                        <div className="text-xs text-gray-500 mb-2 space-y-1">
                          {image.width && image.height && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Resolution:</span>
                              <span className="font-medium text-gray-700">{image.width} x {image.height}</span>
                              {image.is_hq && <span className="text-yellow-600 font-medium">HQ</span>}
                            </div>
                          )}
                          {image.file_size && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Size:</span>
                              <span className="font-medium text-gray-700">{formatFileSize(image.file_size)}</span>
                            </div>
                          )}
                          {image.format && (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Format:</span>
                              <span className="font-medium text-gray-700">{image.format}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleImageExcluded(image)}
                            className={`text-xs font-medium py-1 px-2 rounded ${
                              image.is_excluded
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                            title={image.is_excluded ? 'Click to include this image' : 'Click to exclude this image'}
                          >
                            {image.is_excluded ? 'Include' : 'Exclude'}
                          </button>
                          {!image.excluded_by_global_rule && (
                            <button
                              onClick={() => excludeImageGlobally(image)}
                              className="text-xs font-medium py-1 px-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                              title="Exclude from all pages"
                            >
                              Glob
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border-2 border-black p-12 text-center text-gray-500 font-bold">
              Select a page to review and manage its scraped images.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
