import { useEffect, useState } from 'react';
import apiClient from '../services/api';

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

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const response = await apiClient.getKeywordsStatus();
      setStatus(response.data);
    } catch (error) {
      console.error('Failed to load keyword status:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    uploadFile(file);
    e.target.value = '';
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadResult(null);

    try {
      const response = await apiClient.uploadKeywords(file);
      setUploadResult(response.data);
      loadStatus();
    } catch (error) {
      console.error('Failed to upload keywords:', error);
      alert('Failed to upload keywords. Check the file format.');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const csv = 'url,keywords\nhttps://example.com/article1,keyword1,keyword2,keyword3\nhttps://example.com/article2,recipe,cooking,dinner';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keywords_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Keywords</h1>
        <p className="text-gray-500 mt-1">Upload keyword CSV to tag your pages</p>
      </div>

      {status && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Keyword Status</h2>
          <div className="grid grid-cols-4 gap-6">
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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Keywords CSV</h2>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700 mb-2">
            <strong>CSV Format:</strong> First row should be headers: <code>url,keywords</code>
          </p>
          <p className="text-sm text-gray-600">
            Keywords should be comma-separated. URLs must match pages imported from sitemaps.
          </p>
          <button
            onClick={downloadTemplate}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Download template
          </button>
        </div>

        <div className="flex items-center gap-4">
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
        </div>

        {uploading && (
          <p className="mt-4 text-sm text-gray-600">Uploading and processing...</p>
        )}
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
            {uploadResult.unmatched_urls.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-yellow-700">
                  Unmatched URLs ({uploadResult.unmatched_urls.length})
                </summary>
                <ul className="mt-2 text-xs text-gray-600 list-disc list-inside max-h-40 overflow-y-auto">
                  {uploadResult.unmatched_urls.map((url, i) => <li key={i}>{url}</li>)}
                </ul>
              </details>
            )}
            {uploadResult.errors.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-red-700">
                  Errors ({uploadResult.errors.length})
                </summary>
                <ul className="mt-2 text-xs text-red-600 list-disc list-inside">
                  {uploadResult.errors.map((error, i) => <li key={i}>{error}</li>)}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
