import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PlaygroundPageItem } from '../../services/api';
import apiClient from '../../services/api';
import { Button } from '../ui/button';

type SelectPageProps = {
  pages: PlaygroundPageItem[];
  selectedPageUrl: string;
  onSelectPage: (url: string) => void;
  onScrapeResult: (payload: { pageUrl: string; images: string[]; title: string; description: string }) => void;
};

export default function SelectPage({
  pages,
  selectedPageUrl,
  onSelectPage,
  onScrapeResult,
}: SelectPageProps) {
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [emptyWarning, setEmptyWarning] = useState<string | null>(null);
  const selected = pages.find((page) => page.url === selectedPageUrl) || null;

  async function handlePageSelect(url: string) {
    onSelectPage(url);
    setScrapeError(null);
    setEmptyWarning(null);
    if (!url) return;
    setScraping(true);
    try {
      const response = await apiClient.getPlaygroundScrapeImages(url);
      const payload = response.data;
      onScrapeResult({ ...payload, pageUrl: url });
      if (!Array.isArray(payload.images) || payload.images.length === 0) {
        setEmptyWarning('No images found from the selected page. Some hosts may block CORS.');
      }
    } catch (_error) {
      setScrapeError('Failed to scrape images from page.');
    } finally {
      setScraping(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Select Page</h3>
        <p className="text-xs text-slate-500">Choose which page to generate pins for.</p>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selectedPageUrl}
          onChange={(event) => {
            void handlePageSelect(event.target.value);
          }}
          className="h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {pages.map((page) => (
            <option key={page.url} value={page.url}>
              {page.url}
            </option>
          ))}
        </select>
        <Button size="icon" variant="outline" title="Edit" disabled>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="outline" asChild>
          <a href={selected?.url || '#'} target="_blank" rel="noreferrer" title="Open URL">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button size="icon" variant="outline" title="Remove" disabled>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{pages.length} pages available</div>
      </div>

      {scraping && <div className="text-xs text-slate-500">Scraping page images...</div>}
      {scrapeError && <div className="text-xs text-red-600">{scrapeError}</div>}
      {emptyWarning && <div className="text-xs text-amber-700">{emptyWarning}</div>}
    </section>
  );
}
