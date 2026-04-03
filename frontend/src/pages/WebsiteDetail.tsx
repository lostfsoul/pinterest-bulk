import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient, { Website, Page, SitemapGroup } from '../services/api';
import { Button } from '../components/Button';

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [website, setWebsite] = useState<Website | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ total_urls: number; new_pages: number; updated_pages: number; errors: string[] } | null>(null);
  const [sitemapGroups, setSitemapGroups] = useState<SitemapGroup[]>([]);
  const [selectedSitemaps, setSelectedSitemaps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (id) {
      loadWebsite();
      loadPages();
      loadSitemapGroups();
    }
  }, [id]);

  const loadWebsite = async () => {
    if (!id) return;
    try {
      const response = await apiClient.getWebsite(Number(id));
      setWebsite(response.data);
    } catch (error) {
      console.error('Failed to load website:', error);
    }
  };

  const loadSitemapGroups = async () => {
    if (!id) return;
    try {
      const response = await apiClient.listSitemapGroups(Number(id));
      setSitemapGroups(response.data.groups);
      const defaults = response.data.groups
        .filter((group) => group.is_default)
        .map((group) => group.sitemap_url);
      setSelectedSitemaps(new Set(defaults));
    } catch (error) {
      console.error('Failed to load sitemap groups:', error);
      setSitemapGroups([]);
      setSelectedSitemaps(new Set());
    }
  };

  const loadPages = async () => {
    if (!id) return;
    try {
      const response = await apiClient.listWebsitePages(Number(id));
      setPages(response.data);
    } catch (error) {
      console.error('Failed to load pages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSitemap = async () => {
    if (!id || !website?.sitemap_url) {
      alert('Please configure a sitemap URL first');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const selected = Array.from(selectedSitemaps);
      const response = selected.length > 0
        ? await apiClient.importSitemapWithGroups(Number(id), selected)
        : await apiClient.importSitemap(Number(id));
      setImportResult(response.data);
      loadPages();
      loadWebsite(); // Refresh counts
    } catch (error) {
      console.error('Failed to import sitemap:', error);
      alert('Failed to import sitemap. Check the sitemap URL.');
    } finally {
      setImporting(false);
    }
  };

  const toggleGroup = (groupUrl: string) => {
    setSelectedSitemaps((prev) => {
      const next = new Set(prev);
      if (next.has(groupUrl)) next.delete(groupUrl);
      else next.add(groupUrl);
      return next;
    });
  };

  const togglePageEnabled = async (pageId: number, currentState: boolean) => {
    try {
      await apiClient.updatePage(pageId, { is_enabled: !currentState });
      loadPages();
      loadWebsite();
    } catch (error) {
      console.error('Failed to update page:', error);
      alert('Failed to update page');
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading...</div>;
  }

  if (!website) {
    return <div className="text-red-500">Website not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <button
            onClick={() => navigate('/websites')}
            className="text-sm font-bold hover:opacity-80 mb-2"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-black uppercase text-black font-mono">{website.name}</h1>
          <p className="text-gray-600 mt-1 font-bold font-mono truncate max-w-xs sm:max-w-none">{website.url}</p>
        </div>
        <Button onClick={handleImportSitemap} disabled={importing || !website.sitemap_url}>
          {importing ? 'Importing...' : 'Import Sitemap'}
        </Button>
      </div>

      {importResult && (
        <div className="bg-blue-100 border-2 border-black p-4">
          <h3 className="font-black text-blue-900 mb-2">Sitemap Import Complete</h3>
          <p className="text-sm font-bold text-blue-800">
            Found {importResult.total_urls} pages: {importResult.new_pages} new, {importResult.updated_pages} updated.
          </p>
          {importResult.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-sm font-bold text-red-700 cursor-pointer">Errors ({importResult.errors.length})</summary>
              <ul className="mt-2 text-xs text-red-600 list-disc list-inside">
                {importResult.errors.map((error, i) => <li key={i}>{error}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {sitemapGroups.length > 0 && (
        <div className="bg-white border-2 border-black shadow-brutal p-4 sm:p-6 space-y-3">
          <h2 className="text-sm font-black uppercase">Sitemap Groups</h2>
          <p className="text-xs text-gray-600">Post sitemaps are selected by default. Adjust before importing.</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {sitemapGroups.map((group) => (
              <label key={group.sitemap_url} className="flex items-center gap-3 border border-black px-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedSitemaps.has(group.sitemap_url)}
                  onChange={() => toggleGroup(group.sitemap_url)}
                  className="h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{group.label}</p>
                  <p className="text-xs text-gray-500 truncate">{group.sitemap_url}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 border border-black uppercase">{group.bucket}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            Selected: {selectedSitemaps.size} / {sitemapGroups.length}
          </p>
        </div>
      )}

      {!website.sitemap_url && (
        <div className="bg-yellow-100 border-2 border-black p-4">
          <p className="text-sm font-bold text-yellow-800">
            ⚠️ No sitemap configured. This website will use <code className="bg-yellow-200 px-1">/sitemap.xml</code> by default. Click "Import Sitemap" to try importing pages.
          </p>
        </div>
      )}

      {pages.length === 0 && website.sitemap_url && (
        <div className="bg-blue-100 border-2 border-black p-4">
          <p className="text-sm font-bold text-blue-800">
            📄 No pages imported yet. Click the "Import Sitemap" button above to fetch pages from <code className="bg-blue-200 px-1 break-all">{website.sitemap_url}</code>
          </p>
        </div>
      )}

      <div className="bg-white border-2 border-black shadow-brutal overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b-2 border-black bg-bg-secondary">
          <h2 className="text-lg font-black uppercase text-black">
            Pages ({pages.length})
          </h2>
        </div>
        <div className="divide-y divide-black max-h-[400px] sm:max-h-[600px] overflow-y-auto">
          {pages.length === 0 ? (
            <div className="px-4 sm:px-6 py-8 sm:py-12 text-center text-gray-500 font-mono">
              No pages yet. Import from sitemap to get started.
            </div>
          ) : (
            pages.map((page) => (
              <div key={page.id} className="px-4 sm:px-6 py-3 sm:py-4 hover:bg-bg-secondary flex items-center gap-3 sm:gap-4">
                <input
                  type="checkbox"
                  checked={page.is_enabled}
                  onChange={() => togglePageEnabled(page.id, page.is_enabled)}
                  className="h-4 w-4 accent-accent flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-black truncate">
                    {page.title || 'Untitled'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{page.url}</p>
                </div>
                <div className="flex-shrink-0">
                  <span className={`text-xs px-2 py-1 border border-black rounded ${
                    page.scraped_at ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {page.scraped_at ? 'Scraped' : 'Not scraped'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
