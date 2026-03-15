import { useEffect, useState } from 'react';
import apiClient, { AnalyticsSummary } from '../services/api';
import { Link } from 'react-router-dom';

function StatCard({ title, value, linkTo }: { title: string; value: number | string; linkTo: string }) {
  return (
    <Link to={linkTo} className="block">
      <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
        <p className="text-sm text-gray-500 mb-1">{title}</p>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      const response = await apiClient.getAnalyticsSummary();
      setSummary(response.data);
    } catch (error) {
      console.error('Failed to load summary:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading dashboard...</div>;
  }

  if (!summary) {
    return <div className="text-red-500">Failed to load dashboard</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of your Pinterest CSV tool</p>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Websites" value={summary.websites} linkTo="/websites" />
        <StatCard title="Pages" value={`${summary.enabled_pages}/${summary.pages}`} linkTo="/websites" />
        <StatCard title="Templates" value={summary.templates} linkTo="/templates" />
        <StatCard title="Pins Generated" value={summary.pins_total} linkTo="/generate" />
      </div>

      {/* Keywords Stats */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Keywords</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-500">Total Keywords</p>
            <p className="text-2xl font-bold text-gray-900">{summary.keywords}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Pages with Keywords</p>
            <p className="text-2xl font-bold text-gray-900">{summary.pages_with_keywords}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Coverage</p>
            <p className="text-2xl font-bold text-gray-900">
              {summary.pages > 0 ? Math.round((summary.pages_with_keywords / summary.pages) * 100) : 0}%
            </p>
          </div>
        </div>
      </div>

      {/* Images Stats */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Images</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-500">Total Images</p>
            <p className="text-2xl font-bold text-gray-900">{summary.images_total}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Excluded</p>
            <p className="text-2xl font-bold text-red-600">{summary.images_excluded}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Available</p>
            <p className="text-2xl font-bold text-green-600">{summary.images_available}</p>
          </div>
        </div>
      </div>

      {/* Pins by Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pin Status</h2>
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500">Draft</p>
            <p className="text-2xl font-bold text-gray-600">{summary.pins_draft}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Ready</p>
            <p className="text-2xl font-bold text-blue-600">{summary.pins_ready}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Exported</p>
            <p className="text-2xl font-bold text-green-600">{summary.pins_exported}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Skipped</p>
            <p className="text-2xl font-bold text-gray-400">{summary.pins_skipped}</p>
          </div>
        </div>
      </div>

      {/* Export Stats */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Exports</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500">Total Exports</p>
            <p className="text-2xl font-bold text-gray-900">{summary.exports_count}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Pins Exported</p>
            <p className="text-2xl font-bold text-gray-900">{summary.exports_pins_total}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
