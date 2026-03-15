import { useEffect, useState } from 'react';
import apiClient, { PinDraft } from '../services/api';
import { Button } from '../components/Button';

export default function Export() {
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [selectedPins, setSelectedPins] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportHistory, setExportHistory] = useState<Array<{
    id: number;
    pins_count: number;
    filename: string;
    created_at: string;
  }>>([]);

  useEffect(() => {
    loadPins();
    loadHistory();
  }, []);

  const loadPins = async () => {
    try {
      const response = await apiClient.listPins({ is_selected: true });
      setPins(response.data);
      // Select only rendered pins by default
      const renderedPins = response.data.filter(p => p.media_url && p.media_url.startsWith('/static/'));
      setSelectedPins(new Set(renderedPins.map(p => p.id)));
    } catch (error) {
      console.error('Failed to load pins:', error);
    }
  };

  const renderedPins = pins.filter(p => p.media_url && p.media_url.startsWith('/static/'));
  const unrenderedPins = pins.filter(p => !p.media_url || !p.media_url.startsWith('/static/'));

  const loadHistory = async () => {
    try {
      const response = await apiClient.getExportHistory();
      setExportHistory(response.data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const togglePinSelection = (pinId: number) => {
    const newSelection = new Set(selectedPins);
    if (newSelection.has(pinId)) {
      newSelection.delete(pinId);
    } else {
      newSelection.add(pinId);
    }
    setSelectedPins(newSelection);
  };

  const handleExport = async (selectedOnly: boolean) => {
    const pinIds = selectedOnly ? Array.from(selectedPins) : renderedPins.map((pin) => pin.id);
    const pinsToExport = pinIds.length;

    if (pinsToExport === 0) {
      alert('No pins selected for export');
      return;
    }

    setExporting(true);

    try {
      const response = await apiClient.exportCsv({
        selected_only: selectedOnly,
        pin_ids: pinIds,
      });
      const { download_url } = response.data;

      // Trigger download
      window.open(download_url, '_blank');

      // Refresh data
      loadPins();
      loadHistory();
    } catch (error) {
      console.error('Failed to export:', error);
      alert('Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const downloadFromHistory = (filename: string) => {
    window.open(apiClient.downloadExport(filename), '_blank');
  };

  const allSelected = pins.length > 0 && selectedPins.size === pins.length;
  const toggleAll = () => {
    if (allSelected) {
      setSelectedPins(new Set());
    } else {
      setSelectedPins(new Set(pins.map(p => p.id)));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Export</h1>
        <p className="text-gray-500 mt-1">Review and export pins to CSV for Pinterest</p>
      </div>

      {/* Export actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {unrenderedPins.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-800">
                  {unrenderedPins.length} pin{unrenderedPins.length !== 1 ? 's' : ''} not rendered yet
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  Unrendered pins won't be included in the export. Go to Generate page to render them first.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-600">
              {selectedPins.size} of {renderedPins.length} rendered pins selected
              {unrenderedPins.length > 0 && (
                <span className="text-gray-400"> ({unrenderedPins.length} unrendered)</span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              CSV includes: Title, Media URL, Board, Description, Link, Publish Date, Keywords
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => handleExport(true)}
              disabled={selectedPins.size === 0 || exporting}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedPins.size})`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport(false)}
              disabled={renderedPins.length === 0 || exporting}
            >
              Export All ({renderedPins.length})
            </Button>
          </div>
        </div>
      </div>

      {/* Pins table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">Pins Ready for Export</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
            />
            Select All
          </label>
        </div>

        {pins.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            No pins to export. Generate pins first.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Board</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Image</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Publish Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pins.map((pin) => {
                  const isRendered = pin.media_url && pin.media_url.startsWith('/static/');
                  return (
                    <tr
                      key={pin.id}
                      className={`hover:bg-gray-50 ${!selectedPins.has(pin.id) ? 'opacity-50' : ''} ${!isRendered ? 'bg-gray-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedPins.has(pin.id)}
                          onChange={() => togglePinSelection(pin.id)}
                          disabled={!isRendered}
                          className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-xs">
                          {pin.title || 'Untitled'}
                        </p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">{pin.link}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{pin.board_name || '-'}</td>
                      <td className="px-4 py-3">
                        {isRendered ? (
                          <img
                            src={pin.media_url ?? undefined}
                            alt=""
                            className="w-12 h-12 object-cover rounded"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-400">Not rendered</span>
                            <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">{pin.status}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {pin.publish_date
                          ? new Date(pin.publish_date).toLocaleString()
                          : 'Not scheduled'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Export history */}
      {exportHistory.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">Export History</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {exportHistory.map((export_item) => (
              <div key={export_item.id} className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{export_item.filename}</p>
                  <p className="text-xs text-gray-500">
                    {export_item.pins_count} pins • {new Date(export_item.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => downloadFromHistory(export_item.filename)}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
