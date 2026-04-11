import { useEffect, useMemo, useState } from 'react';
import apiClient, { KeywordEntry, Website } from '../services/api';
import { Button } from '../components/Button';

interface UploadResult {
  total_rows: number;
  matched_pages: number;
  unmatched_urls: string[];
  duplicates_skipped: number;
  errors: string[];
}

interface KeywordStatus {
  total_pages: number;
  pages_with_keywords: number;
  total_keywords: number;
  coverage_percent: number;
}

export default function Keywords() {
  const [status, setStatus] = useState<KeywordStatus | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(null);
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editKeywords, setEditKeywords] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadInitial();
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
    void loadEntries();
  }, [activeWebsiteId]);

  const activeWebsite = useMemo(
    () => websites.find((website) => website.id === activeWebsiteId) ?? null,
    [websites, activeWebsiteId],
  );

  async function loadInitial() {
    try {
      const [statusRes, websitesRes] = await Promise.all([
        apiClient.getKeywordsStatus(),
        apiClient.listWebsites(),
      ]);
      setStatus(statusRes.data);
      setWebsites(websitesRes.data);

      const stored = localStorage.getItem('active_website_id');
      const storedId = stored ? Number(stored) : null;
      const nextWebsiteId =
        (storedId && websitesRes.data.some((website) => website.id === storedId) ? storedId : null) ??
        websitesRes.data[0]?.id ??
        null;
      setActiveWebsiteId(nextWebsiteId);
    } catch (error) {
      console.error('Failed to load keywords page:', error);
    }
  }

  async function loadStatus() {
    try {
      const response = await apiClient.getKeywordsStatus();
      setStatus(response.data);
    } catch (error) {
      console.error('Failed to refresh keyword status:', error);
    }
  }

  async function loadEntries() {
    if (!activeWebsiteId) {
      setEntries([]);
      return;
    }

    setLoadingEntries(true);
    try {
      const response = await apiClient.listKeywordEntries({
        website_id: activeWebsiteId,
        limit: 1000,
      });
      setEntries(response.data);
    } catch (error) {
      console.error('Failed to load keyword entries:', error);
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }

  function startEdit(entry: KeywordEntry) {
    setEditingUrl(entry.url);
    setEditKeywords(entry.keywords);
  }

  function cancelEdit() {
    setEditingUrl(null);
    setEditKeywords('');
  }

  async function saveEdit(entryUrl: string) {
    const keywords = editKeywords.trim();
    if (!keywords) {
      alert('Keywords cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.updateKeywordEntry({ url: entryUrl, keywords });
      setEntries((prev) => prev.map((item) => (item.url === entryUrl ? response.data : item)));
      await loadStatus();
      cancelEdit();
    } catch (error) {
      console.error('Failed to update keyword:', error);
      alert('Failed to update keyword');
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entryUrl: string) {
    if (!confirm('Delete this keyword entry?')) return;
    try {
      await apiClient.deleteKeywordEntry(entryUrl);
      setEntries((prev) => prev.filter((item) => item.url !== entryUrl));
      await loadStatus();
    } catch (error) {
      console.error('Failed to delete keyword:', error);
      alert('Failed to delete keyword');
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    void uploadFile(file);
    e.target.value = '';
  };

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const response = await apiClient.uploadKeywords(file);
      setUploadResult(response.data);
      await Promise.all([loadStatus(), loadEntries()]);
    } catch (error) {
      console.error('Failed to upload keywords:', error);
      alert('Failed to upload keywords. Check the file format.');
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      'url,keywords',
      '"https://example.com/article1","summer corn salad,bright side dish"',
      '"https://example.com/article2","quick family dinner,easy weeknight meal"',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keywords_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Keywords</h1>
        <p className="text-gray-500 mt-1">Manage SEO keywords for the currently selected website</p>
      </div>

      {status && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Keyword Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-500">Total Pages</p>
              <p className="text-2xl font-bold text-gray-900">{status.total_pages}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Pages with Keywords</p>
              <p className="text-2xl font-bold text-blue-600">{status.pages_with_keywords}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Keywords</p>
              <p className="text-2xl font-bold text-gray-900">{status.total_keywords}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Coverage</p>
              <p className="text-2xl font-bold text-gray-900">{status.coverage_percent}%</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload CSV</h2>
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700 mb-2">
            <strong>CSV headers:</strong> <code>url,keywords</code>
          </p>
          <button
            onClick={downloadTemplate}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Download template
          </button>
        </div>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
        {uploading && <p className="mt-3 text-sm text-gray-600">Uploading and processing...</p>}
      </div>

      {uploadResult && (
        <div
          className={`rounded-lg border p-6 ${
            uploadResult.matched_pages > 0
              ? 'bg-green-50 border-green-200'
              : 'bg-yellow-50 border-yellow-200'
          }`}
        >
          <h3
            className={`font-semibold mb-4 ${
              uploadResult.matched_pages > 0 ? 'text-green-900' : 'text-yellow-900'
            }`}
          >
            Upload Complete
          </h3>
          <div className="space-y-2 text-sm">
            <p>Total rows: <strong>{uploadResult.total_rows}</strong></p>
            <p>Matched to pages: <strong className="text-green-700">{uploadResult.matched_pages}</strong></p>
            <p>Duplicates skipped: <strong>{uploadResult.duplicates_skipped}</strong></p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SEO Keywords</h2>
            <p className="text-sm text-gray-500 mt-1">
              {activeWebsite
                ? `Showing keywords for: ${activeWebsite.name}`
                : 'No website selected. Select a website from the sidebar.'}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={loadEntries} disabled={loadingEntries || !activeWebsiteId}>
            Refresh
          </Button>
        </div>

        <div className="text-sm text-gray-600">{entries.length} entries</div>

        <div className="border border-gray-200 rounded-md overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 border-b">URL</th>
                  <th className="text-left p-2 border-b">Keywords</th>
                  <th className="text-left p-2 border-b w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isEditing = editingUrl === entry.url;
                  return (
                    <tr key={entry.url} className="border-b align-top">
                      <td className="p-2">
                        <div className="text-xs text-gray-500 break-all">{entry.url}</div>
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <input
                            value={editKeywords}
                            onChange={(e) => setEditKeywords(e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          />
                        ) : (
                          <span className="text-gray-900">{entry.keywords}</span>
                        )}
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void saveEdit(entry.url)} disabled={saving}>
                              Save
                            </Button>
                            <Button size="sm" variant="secondary" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => startEdit(entry)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void removeEntry(entry.url)}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-gray-500">
                      {loadingEntries
                        ? 'Loading keyword entries...'
                        : activeWebsiteId
                          ? 'No keyword entries found for this website.'
                          : 'No website selected.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
