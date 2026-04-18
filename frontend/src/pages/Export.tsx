import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import apiClient, { PinDraft } from '../services/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';

export default function Export() {
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [selectedPins, setSelectedPins] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_website_id');
    return stored ? Number(stored) : null;
  });
  const [exportHistory, setExportHistory] = useState<Array<{
    id: number;
    pins_count: number;
    filename: string;
    created_at: string;
  }>>([]);

  useEffect(() => {
    void loadPins();
    void loadHistory();
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
    void loadPins();
  }, [activeWebsiteId]);

  const loadPins = async () => {
    try {
      const response = await apiClient.listPins({ is_selected: true, website_id: activeWebsiteId ?? undefined });
      setPins(response.data);
      const renderedPins = response.data.filter((p) => p.media_url && p.media_url.startsWith('/static/'));
      setSelectedPins(new Set(renderedPins.map((p) => p.id)));
    } catch (error) {
      console.error('Failed to load pins:', error);
    }
  };

  const renderedPins = pins.filter((p) => p.media_url && p.media_url.startsWith('/static/'));
  const unrenderedPins = pins.filter((p) => !p.media_url || !p.media_url.startsWith('/static/'));

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

    if (pinIds.length === 0) {
      alert('No pins selected for export');
      return;
    }

    setExporting(true);

    try {
      const response = await apiClient.exportCsv({
        selected_only: selectedOnly,
        pin_ids: pinIds,
        website_id: activeWebsiteId ?? undefined,
      });
      const { download_url } = response.data;
      window.open(download_url, '_blank');
      await loadPins();
      await loadHistory();
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
      setSelectedPins(new Set(pins.map((p) => p.id)));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>Review rendered pins and export a Pinterest-ready CSV.</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {unrenderedPins.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="text-sm font-medium">
                    {unrenderedPins.length} pin{unrenderedPins.length !== 1 ? 's are' : ' is'} not rendered yet.
                  </p>
                  <p className="text-xs">Unrendered pins are excluded from CSV export.</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{selectedPins.size}</span> of{' '}
                <span className="font-semibold">{renderedPins.length}</span> rendered pins selected.
              </p>
              <p className="text-xs text-slate-500">
                CSV fields: title, media URL, board, description, link, publish date, keywords.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleExport(true)} disabled={selectedPins.size === 0 || exporting || deleting}>
                <Download className="h-4 w-4" />
                {exporting ? 'Exporting...' : `Export Selected (${selectedPins.size})`}
              </Button>
              <Button variant="secondary" onClick={() => void handleExport(false)} disabled={renderedPins.length === 0 || exporting || deleting}>
                Export All ({renderedPins.length})
              </Button>
              <Button variant="outline" onClick={() => void handleDeleteSelected()} disabled={selectedPins.size === 0 || exporting || deleting}>
                <Trash2 className="h-4 w-4" />
                Delete Selected
              </Button>
              <Button variant="outline" onClick={() => void handleDeleteAllListed()} disabled={pins.length === 0 || exporting || deleting}>
                Delete All Listed
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Pins Ready for Export</CardTitle>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4"
            />
            Select all
          </label>
        </CardHeader>
        <CardContent>
          {pins.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              No pins to export. Generate pins first.
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4"
                      />
                    </TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="hidden sm:table-cell">Board</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead className="hidden md:table-cell">Publish Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pins.map((pin) => {
                    const isRendered = pin.media_url && pin.media_url.startsWith('/static/');
                    return (
                      <TableRow key={pin.id} className={`${!selectedPins.has(pin.id) ? 'opacity-60' : ''}`}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedPins.has(pin.id)}
                            onChange={() => togglePinSelection(pin.id)}
                            disabled={!isRendered}
                            className="h-4 w-4 disabled:cursor-not-allowed"
                          />
                        </TableCell>
                        <TableCell>
                          <p className="max-w-xs truncate text-sm font-medium text-slate-900">{pin.title || 'Untitled'}</p>
                          {!isRendered && <Badge variant="outline" className="mt-1">Not rendered</Badge>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{pin.board_name || '-'}</TableCell>
                        <TableCell>
                          {isRendered ? (
                            <img
                              src={pin.media_url ?? undefined}
                              alt=""
                              className="h-12 w-12 rounded border border-slate-200 object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="text-xs text-slate-500">{pin.status}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {pin.publish_date
                            ? new Date(pin.publish_date).toLocaleString()
                            : 'Not scheduled'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export History</CardTitle>
          <CardDescription>Recent CSV files generated from this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {exportHistory.length === 0 ? (
            <p className="text-sm text-slate-500">No export history yet.</p>
          ) : (
            <div className="space-y-2">
              {exportHistory.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                  <div className="text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{item.filename}</div>
                    <div className="text-xs text-slate-500">
                      {item.pins_count} pins • {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => downloadFromHistory(item.filename)}>
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
