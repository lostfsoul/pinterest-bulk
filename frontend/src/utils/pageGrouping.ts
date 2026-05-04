export type PageGroupingMode = 'prefix' | 'sitemap' | 'categories';
export type PageSelectionFilter = 'all' | 'enabled' | 'disabled';

export type GroupablePage = {
  id: number;
  url: string;
  title?: string | null;
  section?: string | null;
  sitemap_source?: string | null;
  sitemap_bucket?: string | null;
  is_enabled: boolean;
};

export type PageGroup<T extends GroupablePage> = {
  key: string;
  label: string;
  pages: T[];
};

export function derivePagePrefix(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return `${parsed.origin}/`;
    return `${parsed.origin}/${pathParts[0]}/`;
  } catch {
    return '/';
  }
}

export function deriveCategory(page: GroupablePage): string {
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

export function deriveSitemapLabel(source: string): string {
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split('/').filter(Boolean).pop();
    return filename || source;
  } catch {
    return source;
  }
}

export function filterPages<T extends GroupablePage>(
  pages: T[],
  query: string,
  selectionFilter: PageSelectionFilter,
): T[] {
  const term = query.trim().toLowerCase();
  return pages.filter((page) => {
    if (selectionFilter === 'enabled' && !page.is_enabled) return false;
    if (selectionFilter === 'disabled' && page.is_enabled) return false;
    if (!term) return true;
    return page.url.toLowerCase().includes(term) || (page.title || '').toLowerCase().includes(term);
  });
}

export function groupPages<T extends GroupablePage>(
  pages: T[],
  groupMode: PageGroupingMode,
): PageGroup<T>[] {
  const map = new Map<string, { label: string; pages: T[] }>();
  for (const page of pages) {
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
}
