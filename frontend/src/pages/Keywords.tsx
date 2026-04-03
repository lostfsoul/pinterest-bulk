import { useEffect, useState } from 'react';
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
  by_period_type: Record<string, number>;
  by_role?: Record<string, number>;
}

type PeriodType = 'always' | 'month' | 'season';

export default function Keywords() {
  const [status, setStatus] = useState<KeywordStatus | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [filters, setFilters] = useState({
    websiteId: '',
    periodType: '',
    keywordRole: '',
    search: '',
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKeyword, setEditKeyword] = useState('');
  const [editPeriodType, setEditPeriodType] = useState<PeriodType>('always');
  const [editPeriodValue, setEditPeriodValue] = useState('');
  const [editKeywordRole, setEditKeywordRole] = useState<'selection' | 'seo'>('seo');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadInitial().catch((error) => {
      console.error('Failed to load keywords page:', error);
    });
  }, []);

  async function loadInitial() {
    const [statusRes, websitesRes] = await Promise.all([
      apiClient.getKeywordsStatus(),
      apiClient.listWebsites(),
    ]);
    setStatus(statusRes.data);
    setWebsites(websitesRes.data);
    await loadEntries();
  }

  async function loadStatus() {
    const response = await apiClient.getKeywordsStatus();
    setStatus(response.data);
  }

  async function loadEntries() {
    setLoadingEntries(true);
    try {
      const response = await apiClient.listKeywordEntries({
        website_id: filters.websiteId ? Number(filters.websiteId) : undefined,
        period_type: (filters.periodType || undefined) as PeriodType | undefined,
        keyword_role: (filters.keywordRole || undefined) as 'selection' | 'seo' | undefined,
        search: filters.search || undefined,
        limit: 1000,
      });
      setEntries(response.data);
    } finally {
      setLoadingEntries(false);
    }
  }

  function startEdit(entry: KeywordEntry) {
    setEditingId(entry.id);
    setEditKeyword(entry.keyword);
    setEditPeriodType(entry.period_type);
    setEditPeriodValue(entry.period_value || '');
    setEditKeywordRole(entry.keyword_role);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditKeyword('');
    setEditPeriodType('always');
    setEditPeriodValue('');
    setEditKeywordRole('seo');
  }

  async function saveEdit(entryId: number) {
    const keyword = editKeyword.trim();
    if (!keyword) {
      alert('Keyword cannot be empty');
      return;
    }
    if (editPeriodType !== 'always' && !editPeriodValue.trim()) {
      alert('Period value is required for month/season');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.updateKeywordEntry(entryId, {
        keyword,
        keyword_role: editKeywordRole,
        period_type: editPeriodType,
        period_value: editPeriodType === 'always' ? null : editPeriodValue.trim(),
      });
      setEntries((prev) => prev.map((item) => (item.id === entryId ? response.data : item)));
      await loadStatus();
      cancelEdit();
    } catch (error) {
      console.error('Failed to update keyword:', error);
      alert('Failed to update keyword');
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entryId: number) {
    if (!confirm('Delete this keyword entry?')) return;
    try {
      await apiClient.deleteKeywordEntry(entryId);
      setEntries((prev) => prev.filter((item) => item.id !== entryId));
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

    uploadFile(file).catch((error) => {
      console.error('Failed to upload keywords:', error);
      alert('Failed to upload keywords. Check the file format.');
    });
    e.target.value = '';
  };

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const response = await apiClient.uploadKeywords(file);
      setUploadResult(response.data);
      await Promise.all([loadStatus(), loadEntries()]);
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      'url,keywords,period_type,period_value,keyword_role',
      '"https://example.com/article1","spring recipes,quick appetizers","month","march","selection"',
      '"https://example.com/article1","easy snacks,party ideas","always","","seo"',
      '"https://example.com/article2","summer dinner,bbq ideas","season","summer","selection"',
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
        <p className="text-gray-500 mt-1">Upload, review, and edit keyword entries</p>
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
          <div className="mt-4 text-xs text-gray-600">
            <span className="mr-3">Always: <strong>{status.by_period_type.always ?? 0}</strong></span>
            <span className="mr-3">Month: <strong>{status.by_period_type.month ?? 0}</strong></span>
            <span>Season: <strong>{status.by_period_type.season ?? 0}</strong></span>
          </div>
          <div className="mt-1 text-xs text-gray-600">
            <span className="mr-3">Selection: <strong>{status.by_role?.selection ?? 0}</strong></span>
            <span>SEO: <strong>{status.by_role?.seo ?? 0}</strong></span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload CSV</h2>
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700 mb-2">
            <strong>CSV headers:</strong> <code>url,keywords,period_type,period_value,keyword_role</code>
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
        <div className={`rounded-lg border p-6 ${
          uploadResult.matched_pages > 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
        }`}>
          <h3 className={`font-semibold mb-4 ${
            uploadResult.matched_pages > 0 ? 'text-green-900' : 'text-yellow-900'
          }`}>
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Manage Keywords</h2>
          <Button size="sm" variant="secondary" onClick={loadEntries} disabled={loadingEntries}>
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select
            value={filters.websiteId}
            onChange={(e) => setFilters((prev) => ({ ...prev, websiteId: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All websites</option>
            {websites.map((website) => (
              <option key={website.id} value={website.id}>{website.name}</option>
            ))}
          </select>
          <select
            value={filters.periodType}
            onChange={(e) => setFilters((prev) => ({ ...prev, periodType: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All periods</option>
            <option value="always">Always</option>
            <option value="month">Month</option>
            <option value="season">Season</option>
          </select>
          <select
            value={filters.keywordRole}
            onChange={(e) => setFilters((prev) => ({ ...prev, keywordRole: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All keyword types</option>
            <option value="selection">Selection (match pages)</option>
            <option value="seo">SEO (generate copy)</option>
          </select>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search keyword, title, or URL"
            className="px-3 py-2 border border-gray-300 rounded-md"
          />
          <Button size="sm" onClick={loadEntries}>Apply</Button>
        </div>

        <div className="text-sm text-gray-600">{entries.length} entries</div>

        <div className="border border-gray-200 rounded-md overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 border-b">Page</th>
                  <th className="text-left p-2 border-b">Keyword</th>
                  <th className="text-left p-2 border-b">Type</th>
                  <th className="text-left p-2 border-b">Period</th>
                  <th className="text-left p-2 border-b w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isEditing = editingId === entry.id;
                  return (
                    <tr key={entry.id} className="border-b align-top">
                      <td className="p-2">
                        <div className="text-xs text-gray-500 mb-1">{entry.website_name}</div>
                        <div className="font-medium text-gray-900">{entry.page_title || 'Untitled'}</div>
                        <div className="text-xs text-gray-500 break-all">{entry.page_url}</div>
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <input
                            value={editKeyword}
                            onChange={(e) => setEditKeyword(e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          />
                        ) : (
                          <span className="text-gray-900">{entry.keyword}</span>
                        )}
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <select
                            value={editKeywordRole}
                            onChange={(e) => setEditKeywordRole(e.target.value as 'selection' | 'seo')}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          >
                            <option value="selection">selection</option>
                            <option value="seo">seo</option>
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded ${
                            entry.keyword_role === 'selection' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {entry.keyword_role}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <div className="space-y-2">
                            <select
                              value={editPeriodType}
                              onChange={(e) => setEditPeriodType(e.target.value as PeriodType)}
                              className="w-full px-2 py-1 border border-gray-300 rounded"
                            >
                              <option value="always">always</option>
                              <option value="month">month</option>
                              <option value="season">season</option>
                            </select>
                            {editPeriodType !== 'always' && (
                              <input
                                value={editPeriodValue}
                                onChange={(e) => setEditPeriodValue(e.target.value)}
                                placeholder={editPeriodType === 'month' ? 'e.g. march' : 'e.g. spring'}
                                className="w-full px-2 py-1 border border-gray-300 rounded"
                              />
                            )}
                          </div>
                        ) : (
                          <span>
                            {entry.period_type}
                            {entry.period_value ? `: ${entry.period_value}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveEdit(entry.id)} disabled={saving}>
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
                            <Button size="sm" variant="danger" onClick={() => removeEntry(entry.id)}>
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
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      {loadingEntries ? 'Loading keyword entries...' : 'No keyword entries found.'}
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
