import { useEffect, useMemo, useState } from 'react';
import apiClient, { ImagePageSummary, PageImage, Website } from '../services/api';
import { Button } from '../components/Button';

type ScrapeStatus = 'all' | 'pending' | 'scraped';

export default function Images() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [pages, setPages] = useState<ImagePageSummary[]>([]);
  const [selectedPage, setSelectedPage] = useState<ImagePageSummary | null>(null);
  const [images, setImages] = useState<PageImage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [filters, setFilters] = useState({
    websiteId: '',
    scrapeStatus: 'all' as ScrapeStatus,
    section: '',
    search: '',
  });

  useEffect(() => {
    loadInventory().catch((error) => {
      console.error('Failed to load image inventory:', error);
    });
  }, []);

  const sections = useMemo(() => {
    return Array.from(new Set(pages.map((page) => page.section).filter(Boolean) as string[])).sort((left, right) => left.localeCompare(right));
  }, [pages]);

  async function loadInventory() {
    try {
      const [websitesRes, pagesRes] = await Promise.all([
        apiClient.listWebsites(),
        apiClient.listImagePages(),
      ]);
      setWebsites(websitesRes.data);
      setPages(pagesRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadFilteredPages() {
    setLoading(true);
    try {
      const response = await apiClient.listImagePages({
        website_id: filters.websiteId ? Number(filters.websiteId) : undefined,
        scrape_status: filters.scrapeStatus,
        section: filters.section || undefined,
        search: filters.search || undefined,
      });
      setPages(response.data);
      setSelectedPageIds(new Set());
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
      await loadFilteredPages();
      setSelectedPage((prev) => (prev?.id === page.id ? { ...page, scraped_at: new Date().toISOString() } : prev));
    } catch (error) {
      console.error('Failed to scrape page images:', error);
      alert('Failed to scrape images');
    } finally {
      setScraping(false);
    }
  }

  async function handleBatchScrape(scope: 'selected' | 'filtered') {
    const pageIds = scope === 'selected' ? Array.from(selectedPageIds) : pages.map((page) => page.id);
    if (pageIds.length === 0) {
      alert(`No ${scope} pages to scrape`);
      return;
    }

    setScraping(true);
    try {
      const response = await apiClient.scrapePagesBatch(pageIds);
      await loadFilteredPages();
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
      await loadFilteredPages();
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image');
    }
  }

  const pendingCount = pages.filter((page) => !page.scraped_at).length;
  const scrapedCount = pages.filter((page) => page.scraped_at).length;

  if (loading && pages.length === 0) {
    return <div className="text-gray-500">Loading image inventory...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Images</h1>
        <p className="text-gray-500 mt-1">Browse all sitemap pages by website, section, and scrape status</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              {sections.map((section) => (
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
              onChange={(event) => setFilters((prev) => ({ ...prev, scrapeStatus: event.target.value as ScrapeStatus }))}
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

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={loadFilteredPages}>Apply Filters</Button>
          <Button size="sm" variant="secondary" onClick={() => {
            setFilters({ websiteId: '', scrapeStatus: 'all', section: '', search: '' });
            setTimeout(() => { loadInventory().catch(console.error); }, 0);
          }}>
            Reset
          </Button>
          <Button size="sm" onClick={() => handleBatchScrape('selected')} disabled={scraping || selectedPageIds.size === 0}>
            {scraping ? 'Scraping...' : `Scrape Selected (${selectedPageIds.size})`}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleBatchScrape('filtered')} disabled={scraping || pages.length === 0}>
            Scrape Filtered ({pages.length})
          </Button>
        </div>

        <div className="flex gap-6 text-sm text-gray-600">
          <span>{pages.length} pages in view</span>
          <span>{pendingCount} pending</span>
          <span>{scrapedCount} scraped</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="font-semibold text-gray-900">Page Inventory</h2>
            </div>
            <div className="divide-y divide-gray-200 max-h-[700px] overflow-y-auto">
              {pages.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">No pages match the current filters.</div>
              ) : (
                pages.map((page) => (
                  <div
                    key={page.id}
                    className={`px-4 py-3 hover:bg-gray-50 ${selectedPage?.id === page.id ? 'bg-blue-50' : ''}`}
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
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedPage ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex justify-between items-start gap-4 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{selectedPage.website_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{selectedPage.section}</span>
                  </div>
                  <h2 className="font-semibold text-gray-900">{selectedPage.title || 'Untitled'}</h2>
                  <p className="text-sm text-gray-500 break-all">{selectedPage.url}</p>
                </div>
                <Button onClick={() => handleScrapeSingle(selectedPage)} disabled={scraping} size="sm">
                  {scraping ? 'Scraping...' : 'Scrape This Page'}
                </Button>
              </div>

              {images.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  No images stored for this page yet. Scrape it to review article images.
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className={`relative border-2 rounded-lg overflow-hidden ${image.is_excluded ? 'border-red-300 opacity-60' : 'border-gray-200'}`}
                    >
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
                        <button
                          onClick={() => toggleImageExcluded(image)}
                          className={`w-full text-xs font-medium py-1 px-2 rounded ${image.is_excluded ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                        >
                          {image.is_excluded ? 'Excluded' : 'Include'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">
              Select a page to review and manage its scraped images.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
