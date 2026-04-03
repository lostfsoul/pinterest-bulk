import { useEffect, useState } from 'react';
import apiClient, { PinDraft } from '../services/api';
import { Button } from '../components/Button';

export default function Export() {
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [selectedPins, setSelectedPins] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      const message =
        (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (error as Error)?.message ||
        'Failed to export CSV';
      alert(message);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedPins);
    if (ids.length === 0) {
      alert('No selected pins to delete');
      return;
    }
    const confirmed = window.confirm(`Delete ${ids.length} selected generated pin(s) from the database? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiClient.clearPins({ pin_ids: ids });
      await loadPins();
      await loadHistory();
    } catch (error) {
      console.error('Failed to delete selected pins:', error);
      alert('Failed to delete selected pins');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAllListed = async () => {
    if (pins.length === 0) {
      alert('No generated pins to delete');
      return;
    }
    const ids = pins.map((pin) => pin.id);
    const confirmed = window.confirm(`Delete all ${ids.length} listed generated pin(s) from the database? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiClient.clearPins({ pin_ids: ids });
      await loadPins();
      await loadHistory();
    } catch (error) {
      console.error('Failed to delete all listed pins:', error);
      alert('Failed to delete pins');
    } finally {
      setDeleting(false);
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
        <h1 className="text-2xl font-black uppercase text-black font-mono">Export</h1>
        <p className="text-gray-600 mt-1 font-bold font-mono">Review and export pins to CSV for Pinterest</p>
      </div>

      {/* Export actions */}
      <div className="bg-white border-2 border-black shadow-brutal p-4 sm:p-6">
        {unrenderedPins.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-100 border-2 border-black rounded-md">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-yellow-700 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-bold text-yellow-800">
                  {unrenderedPins.length} pin{unrenderedPins.length !== 1 ? 's' : ''} not rendered yet
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  Unrendered pins won't be included in the export. Go to Generate page to render them first.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <p className="text-sm font-bold text-black">
              {selectedPins.size} of {renderedPins.length} rendered pins selected
              {unrenderedPins.length > 0 && (
                <span className="text-gray-500"> ({unrenderedPins.length} unrendered)</span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              CSV includes: Title, Media URL, Board, Description, Link, Publish Date, Keywords
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => handleExport(true)}
              disabled={selectedPins.size === 0 || exporting || deleting}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedPins.size})`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport(false)}
              disabled={renderedPins.length === 0 || exporting || deleting}
            >
              Export All ({renderedPins.length})
            </Button>
            <Button
              variant="secondary"
              onClick={handleDeleteSelected}
              disabled={selectedPins.size === 0 || exporting || deleting}
            >
              {deleting ? 'Deleting...' : `Delete Selected (${selectedPins.size})`}
            </Button>
            <Button
              variant="secondary"
              onClick={handleDeleteAllListed}
              disabled={pins.length === 0 || exporting || deleting}
            >
              {deleting ? 'Deleting...' : `Delete All Listed (${pins.length})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Pins table */}
      <div className="bg-white border-2 border-black shadow-brutal overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b-2 border-black bg-bg-secondary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <h2 className="font-black uppercase text-sm sm:text-base">Pins Ready for Export</h2>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-accent"
            />
            Select All
          </label>
        </div>

        {pins.length === 0 ? (
          <div className="p-8 sm:p-12 text-center text-gray-500 font-mono">
            No pins to export. Generate pins first.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[400px] sm:max-h-[500px] overflow-y-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-bg-secondary sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 accent-accent"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase hidden sm:table-cell">Board</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase">Image</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase hidden md:table-cell">Publish Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {pins.map((pin) => {
                  const isRendered = pin.media_url && pin.media_url.startsWith('/static/');
                  return (
                    <tr
                      key={pin.id}
                      className={`hover:bg-bg-secondary ${!selectedPins.has(pin.id) ? 'opacity-50' : ''} ${!isRendered ? 'bg-gray-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedPins.has(pin.id)}
                          onChange={() => togglePinSelection(pin.id)}
                          disabled={!isRendered}
                          className="h-4 w-4 accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-black truncate max-w-[120px] sm:max-w-xs">
                          {pin.title || 'Untitled'}
                        </p>
                        <p className="text-xs text-gray-500 truncate max-w-[120px] sm:max-w-xs sm:hidden">{pin.link}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium hidden sm:table-cell">{pin.board_name || '-'}</td>
                      <td className="px-4 py-3">
                        {isRendered ? (
                          <img
                            src={pin.media_url ?? undefined}
                            alt=""
                            className="w-10 h-10 sm:w-12 sm:h-12 object-cover border-2 border-black"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-400">Not rendered</span>
                            <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 border border-black rounded">{pin.status}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium hidden md:table-cell">
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
        <div className="bg-white border-2 border-black shadow-brutal overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b-2 border-black bg-bg-secondary">
            <h2 className="font-black uppercase text-sm sm:text-base">Export History</h2>
          </div>
          <div className="divide-y divide-black">
            {exportHistory.map((export_item) => (
              <div key={export_item.id} className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 hover:bg-bg-secondary">
                <div>
                  <p className="text-sm font-bold text-black">{export_item.filename}</p>
                  <p className="text-xs text-gray-500">
                    {export_item.pins_count} pins • {new Date(export_item.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => downloadFromHistory(export_item.filename)}
                  className="text-sm font-bold uppercase hover:opacity-80"
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
