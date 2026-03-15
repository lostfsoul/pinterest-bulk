import { useEffect, useState } from 'react';
import apiClient, { ActivityLog } from '../services/api';

export default function Activity() {
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [importLogs, setImportLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'activity' | 'imports'>('activity');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [activityRes, importsRes] = await Promise.all([
        apiClient.getActivityLogs(100),
        apiClient.getImportHistory(50),
      ]);
      setActivityLogs(activityRes.data);
      setImportLogs(importsRes.data);
    } catch (error) {
      console.error('Failed to load activity data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      'sitemap_imported': 'Sitemap Imported',
      'keywords_uploaded': 'Keywords Uploaded',
      'pins_generated': 'Pins Generated',
      'pin_updated': 'Pin Updated',
      'pins_cleared': 'Pins Cleared',
      'exported': 'Exported',
    };
    return labels[action] || action;
  };

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = {
      'sitemap_imported': 'bg-blue-100 text-blue-700',
      'keywords_uploaded': 'bg-purple-100 text-purple-700',
      'pins_generated': 'bg-green-100 text-green-700',
      'pin_updated': 'bg-gray-100 text-gray-700',
      'pins_cleared': 'bg-yellow-100 text-yellow-700',
      'exported': 'bg-green-100 text-green-700',
    };
    return colors[action] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return <div className="text-gray-500">Loading activity logs...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Activity & Traceability</h1>
        <p className="text-gray-500 mt-1">View operational logs and history for debugging and review</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('activity')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'activity'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Activity Logs ({activityLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('imports')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'imports'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Import History ({importLogs.length})
          </button>
        </nav>
      </div>

      {/* Activity Logs */}
      {activeTab === 'activity' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {activityLogs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">No activity yet</div>
          ) : (
            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
              {activityLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${getActionColor(log.action)}`}>
                          {getActionLabel(log.action)}
                        </span>
                        {log.entity_type && (
                          <span className="text-xs text-gray-500">
                            {log.entity_type}:{log.entity_id}
                          </span>
                        )}
                      </div>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 mt-2 overflow-x-auto">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import History */}
      {activeTab === 'imports' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {importLogs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">No imports yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Success</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Errors</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {importLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded ${
                          log.type === 'sitemap' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {log.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{log.items_count}</td>
                      <td className="px-6 py-4 text-sm text-green-600">{log.success_count}</td>
                      <td className="px-6 py-4 text-sm text-red-600">{log.error_count}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
