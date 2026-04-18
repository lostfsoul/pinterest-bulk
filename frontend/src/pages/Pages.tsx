import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Filter, RefreshCcw, Search } from 'lucide-react';
import apiClient, { ImagePageSummary, Website } from '../services/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

type GroupMode = 'prefix' | 'sitemap' | 'categories';
type SelectionFilter = 'all' | 'enabled' | 'disabled';

function derivePagePrefix(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return `${parsed.origin}/`;
    return `${parsed.origin}/${pathParts[0]}/`;
  } catch {
    return '/';
  }
}

function deriveCategory(page: ImagePageSummary): string {
  const pathParts = page.url
    .split('/')
    .filter(Boolean)
    .slice(2)
    .map((part) => part.toLowerCase());
  const firstSlug = pathParts[0] || '';
  const slugAsLabel = firstSlug.replace(/[-_]+/g, ' ').trim();
  if (page.sitemap_bucket === 'category' && slugAsLabel) return slugAsLabel;
  if (slugAsLabel) return slugAsLabel;
  return (page.section || 'uncategorized').toLowerCase();
}

function deriveSitemapLabel(source: string): string {
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split('/').filter(Boolean).pop();
    return filename || source;
  } catch {
    return source;
  }
}

export default function Pages() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(null);
  const [pages, setPages] = useState<ImagePageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('prefix');
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  useEffect(() => {
    void loadWebsites();
  }, []);

  useEffect(() => {
    const onWebsiteSwitch = (event: Event) => {
      const custom = event as CustomEvent<number>;
      setActiveWebsiteId(custom.detail ?? null);
    };
    window.addEventListener('website-switch', onWebsiteSwitch as EventListener);
    return () => window.removeEventListener('website-switch', onWebsiteSwitch as EventListener);
  }, []);

  useEffect(() => {
    if (!activeWebsiteId) return;
    void loadPages(activeWebsiteId);
  }, [activeWebsiteId]);

  async function loadWebsites() {
    setLoading(true);
    try {
      const websitesRes = await apiClient.listWebsites();
      setWebsites(websitesRes.data);
      const stored = localStorage.getItem('active_website_id');
      const storedId = stored ? Number(stored) : null;
      const nextId = (
        storedId && websitesRes.data.some((site) => site.id === storedId)
          ? storedId
          : (websitesRes.data[0]?.id ?? null)
      );
      setActiveWebsiteId(nextId);
    } catch (error) {
      console.error('Failed to load websites:', error);
      setStatus('Failed to load websites.');
    } finally {
      setLoading(false);
    }
  }

  async function loadPages(websiteId: number) {
    setLoading(true);
    try {
      const response = await apiClient.listImagePages({ website_id: websiteId, enabled_state: 'all' });
      setPages(response.data);
      setCollapsedGroups(new Set());
      setStatus('');
    } catch (error) {
      console.error('Failed to load pages:', error);
      setStatus('Failed to load pages.');
    } finally {
      setLoading(false);
    }
  }

  async function togglePage(page: ImagePageSummary) {
    setSaving(true);
    try {
      await apiClient.updatePage(page.id, { is_enabled: !page.is_enabled });
      setPages((prev) => prev.map((item) => (item.id === page.id ? { ...item, is_enabled: !item.is_enabled } : item)));
    } catch (error) {
      console.error('Failed to update page:', error);
      setStatus('Failed to update page.');
    } finally {
      setSaving(false);
    }
  }

  async function bulkSetPages(pageIds: number[], enabled: boolean) {
    if (pageIds.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        pageIds.map((id) => apiClient.updatePage(id, { is_enabled: enabled })),
      );
      const targetSet = new Set(pageIds);
      setPages((prev) => prev.map((item) => (targetSet.has(item.id) ? { ...item, is_enabled: enabled } : item)));
    } catch (error) {
      console.error('Failed to update pages in bulk:', error);
      setStatus('Failed to update some pages.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshSitemap() {
    if (!activeWebsiteId) return;
    setImporting(true);
    setStatus('Refreshing sitemap...');
    try {
      await apiClient.importSitemap(activeWebsiteId);
      await loadPages(activeWebsiteId);
      setStatus('Sitemap refreshed.');
    } catch (error) {
      console.error('Failed to refresh sitemap:', error);
      setStatus('Failed to refresh sitemap.');
    } finally {
      setImporting(false);
    }
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return pages.filter((page) => {
      if (selectionFilter === 'enabled' && !page.is_enabled) return false;
      if (selectionFilter === 'disabled' && page.is_enabled) return false;
      if (!term) return true;
      return page.url.toLowerCase().includes(term) || (page.title || '').toLowerCase().includes(term);
    });
  }, [pages, query, selectionFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; pages: ImagePageSummary[] }>();
    for (const page of filtered) {
      let key = '';
      let label = '';
      if (groupMode === 'prefix') {
        label = derivePagePrefix(page.url);
        key = label.toLowerCase();
      } else if (groupMode === 'sitemap') {
        const source = (page.sitemap_source || 'Unknown sitemap').trim();
        label = deriveSitemapLabel(source);
        key = source.toLowerCase();
      } else {
        label = deriveCategory(page);
        key = label.toLowerCase();
      }
      if (!map.has(key)) map.set(key, { label, pages: [] });
      map.get(key)?.pages.push(page);
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, label: value.label, pages: value.pages }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, groupMode]);

  const enabledCount = useMemo(() => pages.filter((page) => page.is_enabled).length, [pages]);
  const activeWebsite = websites.find((site) => site.id === activeWebsiteId) ?? null;

  if (loading && websites.length === 0) {
    return <div className="text-slate-500">Loading pages...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <CardTitle>Pages For Pin Generation</CardTitle>
              <CardDescription>
                {activeWebsite ? `${pages.length} pages, ${enabledCount} enabled` : 'Select a website to manage pages'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>
                Actions
              </Button>
              <Button variant="outline" size="sm" disabled>
                Process Seasonal Pins
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_auto] gap-2">
            <select
              value={activeWebsiteId ?? ''}
              onChange={(event) => {
                const next = event.target.value ? Number(event.target.value) : null;
                setActiveWebsiteId(next);
                if (next) {
                  localStorage.setItem('active_website_id', String(next));
                  window.dispatchEvent(new CustomEvent<number>('website-switch', { detail: next }));
                }
              }}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Select website</option>
              {websites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by URL or title"
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" className="h-10" disabled>
              <Filter className="h-4 w-4" />
              Filter by date
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                {([
                  ['prefix', 'Prefix'],
                  ['sitemap', 'Sitemap'],
                  ['categories', 'Categories'],
                ] as Array<[GroupMode, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setGroupMode(value)}
                    className={`rounded px-3 py-1.5 text-xs ${groupMode === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                {([
                  ['all', 'All'],
                  ['enabled', 'Selected'],
                  ['disabled', 'Non Selected'],
                ] as Array<[SelectionFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setSelectionFilter(value)}
                    className={`rounded px-3 py-1.5 text-xs ${selectionFilter === value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void bulkSetPages(filtered.map((page) => page.id), true)}
                disabled={saving || filtered.length === 0}
              >
                Enable Visible
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void bulkSetPages(filtered.map((page) => page.id), false)}
                disabled={saving || filtered.length === 0}
              >
                Disable Visible
              </Button>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-y-auto rounded-md border border-slate-200">
            {groups.length === 0 && <div className="p-4 text-sm text-slate-500">No pages found.</div>}
            {groups.map((group) => {
              const enabledInGroup = group.pages.filter((page) => page.is_enabled).length;
              const fullyEnabled = enabledInGroup === group.pages.length && group.pages.length > 0;
              const collapsed = collapsedGroups.has(group.key);
              return (
                <div key={group.key} className="border-b border-slate-200 last:border-b-0">
                  <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={fullyEnabled}
                        onChange={() => void bulkSetPages(group.pages.map((page) => page.id), !fullyEnabled)}
                        disabled={saving}
                      />
                      <button
                        className="truncate text-left text-sm font-medium text-slate-900"
                        onClick={() => void bulkSetPages(group.pages.map((page) => page.id), !fullyEnabled)}
                        disabled={saving}
                      >
                        {group.label}
                      </button>
                      <Badge variant="secondary" className="text-[10px]">
                        {enabledInGroup}/{group.pages.length} enabled
                      </Badge>
                    </div>
                    <button
                      className="rounded-md border border-slate-300 p-1 text-slate-600"
                      onClick={() => {
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      }}
                    >
                      {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                  {!collapsed && group.pages.map((page) => (
                    <div key={page.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={page.is_enabled}
                          onChange={() => void togglePage(page)}
                          disabled={saving}
                        />
                        <span className="truncate text-sm text-slate-700">{page.url}</span>
                        {page.is_enabled && <Check className="h-3.5 w-3.5 text-green-600" />}
                      </label>
                      <span className="shrink-0 text-xs text-slate-500">
                        Last modified: {page.scraped_at ? new Date(page.scraped_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <div>
            <p className="text-sm font-medium text-slate-900">Sitemap Management</p>
            <p className="text-sm text-slate-500">Last updated: {new Date().toLocaleString()}</p>
          </div>
          <Button variant="outline" onClick={() => void refreshSitemap()} disabled={!activeWebsiteId || importing}>
            <RefreshCcw className="h-4 w-4" />
            {importing ? 'Refreshing...' : 'Refresh Sitemap'}
          </Button>
        </CardContent>
      </Card>

      {status && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {status}
        </div>
      )}
    </div>
  );
}
