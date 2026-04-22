import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import apiClient, { PinDetail, PinDraft, PlaygroundTemplateItem, Website } from '../services/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

type CalendarDayGroup = {
  key: string;
  label: string;
  pins: PinDraft[];
};

function normalizeDayKey(value: string | null): string {
  if (!value) return 'unscheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unscheduled';
  return parsed.toISOString().slice(0, 10);
}

function formatCalendarDayLabel(key: string): string {
  if (key === 'unscheduled') return 'Unscheduled';
  const parsed = new Date(`${key}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sortCalendarGroups(a: CalendarDayGroup, b: CalendarDayGroup): number {
  if (a.key === 'unscheduled') return 1;
  if (b.key === 'unscheduled') return -1;
  return a.key.localeCompare(b.key);
}

export default function Generate() {
  const [loading, setLoading] = useState(true);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(null);
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [selectedCalendarPinId, setSelectedCalendarPinId] = useState<number | null>(null);
  const [calendarPinDetail, setCalendarPinDetail] = useState<PinDetail | null>(null);
  const [calendarDetailLoading, setCalendarDetailLoading] = useState(false);
  const [calendarPinMutationId, setCalendarPinMutationId] = useState<number | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPinId, setRegenPinId] = useState<number | null>(null);
  const [regenTemplates, setRegenTemplates] = useState<PlaygroundTemplateItem[]>([]);
  const [regenDetail, setRegenDetail] = useState<PinDetail | null>(null);
  const [regenTemplateId, setRegenTemplateId] = useState<number | null>(null);
  const [regenImageUrl, setRegenImageUrl] = useState<string>('');
  const [regenAiContent, setRegenAiContent] = useState(true);
  const [regenCandidate, setRegenCandidate] = useState<{ title: string; description: string; board_name: string } | null>(null);
  const [regenAvailableImages, setRegenAvailableImages] = useState<string[]>([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenApplying, setRegenApplying] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  });

  useEffect(() => {
    const stored = localStorage.getItem('active_website_id');
    const storedId = stored ? Number(stored) : null;
    void apiClient.listWebsites().then((response) => {
      setWebsites(response.data);
      const id =
        (storedId && response.data.some((website) => website.id === storedId) ? storedId : null) ??
        response.data[0]?.id ??
        null;
      setActiveWebsiteId(id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onSwitch = (event: Event) => {
      const custom = event as CustomEvent<number | null>;
      setActiveWebsiteId(custom.detail ?? null);
      setSelectedCalendarPinId(null);
      setCalendarPinDetail(null);
      setStatus({ type: 'idle', message: '' });
    };
    window.addEventListener('website-switch', onSwitch as EventListener);
    return () => window.removeEventListener('website-switch', onSwitch as EventListener);
  }, []);

  useEffect(() => {
    if (!activeWebsiteId) {
      setPins([]);
      return;
    }
    localStorage.setItem('active_website_id', String(activeWebsiteId));
    void refreshPins(activeWebsiteId);
  }, [activeWebsiteId]);

  const activeWebsite = useMemo(
    () => websites.find((website) => website.id === activeWebsiteId) || null,
    [activeWebsiteId, websites],
  );

  const approvedPinsCount = useMemo(
    () => pins.filter((pin) => pin.is_selected && pin.status !== 'skipped').length,
    [pins],
  );

  const selectedForExportCount = useMemo(
    () => pins.filter((pin) => pin.is_selected).length,
    [pins],
  );

  const calendarDayGroups = useMemo(() => {
    const byDay = new Map<string, PinDraft[]>();
    for (const pin of pins) {
      const key = normalizeDayKey(pin.publish_date);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)?.push(pin);
    }
    return Array.from(byDay.entries())
      .map(([key, dayPins]) => ({
        key,
        label: formatCalendarDayLabel(key),
        pins: [...dayPins].sort((a, b) => {
          const aTime = a.publish_date ? new Date(a.publish_date).getTime() : 0;
          const bTime = b.publish_date ? new Date(b.publish_date).getTime() : 0;
          if (aTime !== bTime) return aTime - bTime;
          return b.id - a.id;
        }),
      }))
      .sort(sortCalendarGroups);
  }, [pins]);

  async function refreshPins(websiteId: number) {
    try {
      const response = await apiClient.listPins({ website_id: websiteId });
      setPins(response.data);
    } catch (error) {
      console.error('Failed to load pins:', error);
      setStatus({ type: 'error', message: 'Failed to load pins.' });
    }
  }

  async function openCalendarPinDetail(pinId: number) {
    setSelectedCalendarPinId(pinId);
    setCalendarDetailLoading(true);
    try {
      const response = await apiClient.getPinDetail(pinId);
      setCalendarPinDetail(response.data);
    } catch (error) {
      console.error('Failed to load pin detail:', error);
      setCalendarPinDetail(null);
    } finally {
      setCalendarDetailLoading(false);
    }
  }

  function closeCalendarPinDetail() {
    setSelectedCalendarPinId(null);
    setCalendarPinDetail(null);
    setCalendarDetailLoading(false);
  }

  function closeRegenerateModal() {
    setRegenOpen(false);
    setRegenPinId(null);
    setRegenTemplateId(null);
    setRegenImageUrl('');
    setRegenCandidate(null);
    setRegenAvailableImages([]);
    setRegenError('');
    setRegenLoading(false);
    setRegenApplying(false);
  }

  async function loadRegenerateCandidate(pinId: number, options?: {
    templateId?: number | null;
    imageUrl?: string | null;
    regenerateAi?: boolean;
  }) {
    setRegenLoading(true);
    setRegenError('');
    try {
      const response = await apiClient.regeneratePinPreview(pinId, {
        template_id: options?.templateId ?? regenTemplateId,
        selected_image_url: options?.imageUrl ?? regenImageUrl,
        regenerate_ai_content: options?.regenerateAi ?? regenAiContent,
      });
      const data = response.data;
      setRegenTemplateId(data.template_id);
      setRegenImageUrl(data.selected_image_url || '');
      setRegenAvailableImages(data.available_images || []);
      setRegenCandidate(data.candidate);
    } catch (error) {
      console.error('Failed to generate pin replacement candidate:', error);
      setRegenError('Failed to generate replacement candidate.');
    } finally {
      setRegenLoading(false);
    }
  }

  async function openRegenerateModal(pin: PinDraft) {
    setRegenOpen(true);
    setRegenPinId(pin.id);
    setRegenTemplateId(pin.template_id ?? null);
    setRegenImageUrl(pin.selected_image_url || '');
    setRegenCandidate(null);
    setRegenAvailableImages([]);
    setRegenError('');
    setRegenLoading(true);
    try {
      const [detailRes, templatesRes] = await Promise.all([
        apiClient.getPinDetail(pin.id),
        apiClient.getPlaygroundTemplates(),
      ]);
      setRegenDetail(detailRes.data);
      setRegenTemplates(templatesRes.data.templates || []);
      await loadRegenerateCandidate(pin.id, {
        templateId: pin.template_id ?? null,
        imageUrl: pin.selected_image_url,
        regenerateAi: regenAiContent,
      });
    } catch (error) {
      console.error('Failed to open regenerate modal:', error);
      setRegenError('Failed to load regenerate form.');
      setRegenLoading(false);
    }
  }

  async function applyRegenerateCandidate() {
    if (!regenPinId || !regenCandidate) return;
    setRegenApplying(true);
    setRegenError('');
    try {
      await apiClient.regeneratePinApply(regenPinId, {
        template_id: regenTemplateId,
        selected_image_url: regenImageUrl || null,
        title: regenCandidate.title,
        description: regenCandidate.description,
        board_name: regenCandidate.board_name,
      });
      if (activeWebsiteId) {
        await refreshPins(activeWebsiteId);
      }
      if (selectedCalendarPinId === regenPinId) {
        await openCalendarPinDetail(regenPinId);
      }
      closeRegenerateModal();
      setStatus({ type: 'success', message: 'Pin regeneration started. Rendering in background.' });
    } catch (error) {
      console.error('Failed to apply regenerate candidate:', error);
      setRegenError('Failed to apply changes.');
    } finally {
      setRegenApplying(false);
    }
  }

  async function updateCalendarPinStatus(pin: PinDraft, approved: boolean) {
    if (!activeWebsiteId) return;
    setCalendarPinMutationId(pin.id);
    try {
      await apiClient.updatePin(pin.id, {
        is_selected: approved,
        status: approved ? 'ready' : 'skipped',
      });
      await refreshPins(activeWebsiteId);
      if (selectedCalendarPinId === pin.id) {
        await openCalendarPinDetail(pin.id);
      }
    } catch (error) {
      console.error('Failed to update pin status:', error);
      setStatus({ type: 'error', message: 'Failed to update pin status.' });
    } finally {
      setCalendarPinMutationId(null);
    }
  }

  async function approveAllCalendarPins() {
    if (pins.length === 0 || !activeWebsiteId) return;
    setCalendarPinMutationId(-1);
    try {
      await Promise.all(
        pins.map((pin) => apiClient.updatePin(pin.id, { is_selected: true, status: 'ready' })),
      );
      await refreshPins(activeWebsiteId);
    } catch (error) {
      console.error('Failed to approve all pins:', error);
      setStatus({ type: 'error', message: 'Failed to approve all pins.' });
    } finally {
      setCalendarPinMutationId(null);
    }
  }

  async function rejectAllCalendarPins() {
    if (pins.length === 0 || !activeWebsiteId) return;
    setCalendarPinMutationId(-2);
    try {
      await Promise.all(
        pins.map((pin) => apiClient.updatePin(pin.id, { is_selected: false, status: 'skipped' })),
      );
      await refreshPins(activeWebsiteId);
    } catch (error) {
      console.error('Failed to reject all pins:', error);
      setStatus({ type: 'error', message: 'Failed to reject all pins.' });
    } finally {
      setCalendarPinMutationId(null);
    }
  }

  async function exportGeneratedCsv() {
    if (!activeWebsiteId) return;
    const selectedIds = pins.filter((pin) => pin.is_selected).map((pin) => pin.id);
    if (selectedIds.length === 0) {
      setStatus({ type: 'error', message: 'No approved pins selected for export.' });
      return;
    }
    setExporting(true);
    try {
      const response = await apiClient.exportCsv({
        selected_only: true,
        pin_ids: selectedIds,
        website_id: activeWebsiteId,
      });
      window.open(response.data.download_url, '_blank');
      setStatus({
        type: 'success',
        message: `CSV exported with ${response.data.pins_count} approved pins.`,
      });
      await refreshPins(activeWebsiteId);
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (error as Error)?.message ||
        'CSV export failed';
      setStatus({ type: 'error', message });
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="text-slate-500">Loading calendar...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Publishing Calendar</CardTitle>
              <CardDescription>
                {activeWebsite ? `Website: ${activeWebsite.name}` : 'No active website selected'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => window.location.assign('/playground')}>
                Open Playground
              </Button>
              <Button variant="outline" onClick={() => window.location.assign('/pages')}>
                Open Pages
              </Button>
              <Button variant="outline" onClick={() => window.location.assign('/settings')}>
                Open Settings / Workflow
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-slate-500">All Pins</p>
              <p className="text-2xl font-semibold text-slate-900">{pins.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Approved for export</p>
              <p className="text-2xl font-semibold text-slate-900">{approvedPinsCount}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Selected</p>
              <p className="text-2xl font-semibold text-slate-900">{selectedForExportCount}</p>
            </div>
            <div className="flex items-center justify-end rounded-md border border-slate-200 p-3">
              <Button onClick={() => void exportGeneratedCsv()} disabled={exporting || selectedForExportCount === 0}>
                {exporting ? 'Exporting...' : 'Export Approved'}
              </Button>
            </div>
          </div>

          {status.type !== 'idle' && (
            <div
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                status.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              {status.message}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void approveAllCalendarPins()}
          disabled={pins.length === 0 || calendarPinMutationId !== null}
        >
          {calendarPinMutationId === -1 ? 'Approving...' : 'Approve All'}
        </Button>
        <Button
          variant="outline"
          onClick={() => void rejectAllCalendarPins()}
          disabled={pins.length === 0 || calendarPinMutationId !== null}
        >
          {calendarPinMutationId === -2 ? 'Rejecting...' : 'Reject All'}
        </Button>
      </div>

      {calendarDayGroups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-slate-500">
            No generated pins found for this website yet. Use Workflow settings to generate the next batch.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {calendarDayGroups.map((group) => (
            <Card key={group.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {group.label} ({group.pins.length} {group.pins.length === 1 ? 'pin' : 'pins'})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {group.pins.map((pin) => {
                    const pinApproved = pin.is_selected && pin.status !== 'skipped';
                    return (
                      <div key={pin.id} className="space-y-2 rounded-lg border border-slate-200 p-2">
                        <button
                          onClick={() => void openCalendarPinDetail(pin.id)}
                          className="block w-full overflow-hidden rounded-md border border-slate-200"
                          title="Open details"
                        >
                          {pin.media_url ? (
                            <img src={pin.media_url} alt="" className="h-36 w-full object-cover" />
                          ) : (
                            <div className="flex h-36 w-full items-center justify-center text-xs text-slate-500">No media</div>
                          )}
                        </button>
                        <div className="space-y-0.5 text-xs">
                          <div className="truncate font-medium text-slate-900">{pin.title || 'Untitled'}</div>
                          <div className="truncate text-slate-500">{pin.board_name || 'No board'}</div>
                          <div className="text-slate-400">
                            {pin.publish_date ? new Date(pin.publish_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}
                          </div>
                        </div>
                        <Badge variant={pinApproved ? 'secondary' : 'outline'}>
                          {pinApproved ? 'Approved' : 'Rejected'}
                        </Badge>
                        <div className="grid grid-cols-3 gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openRegenerateModal(pin)}
                            disabled={calendarPinMutationId !== null}
                          >
                            Regen
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateCalendarPinStatus(pin, true)}
                            disabled={calendarPinMutationId !== null}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateCalendarPinStatus(pin, false)}
                            disabled={calendarPinMutationId !== null}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCalendarPinId && (
        <div className="fixed inset-0 z-50 bg-slate-900/45" onClick={closeCalendarPinDetail}>
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Pin details</h3>
              <Button variant="outline" size="sm" onClick={closeCalendarPinDetail}>Close</Button>
            </div>
            {calendarDetailLoading ? (
              <div className="mt-4 text-sm text-slate-500">Loading pin details...</div>
            ) : !calendarPinDetail ? (
              <div className="mt-4 text-sm text-red-600">Unable to load pin details.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-md border border-slate-200 p-2">
                  {calendarPinDetail.pin.media_url ? (
                    <img src={calendarPinDetail.pin.media_url} alt="" className="max-h-[320px] w-full rounded-md bg-slate-50 object-contain" />
                  ) : (
                    <div className="flex h-40 items-center justify-center text-slate-500">No rendered media</div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-3"><span className="text-slate-500">Pinterest Title</span><div className="font-medium text-slate-900">{calendarPinDetail.pin.title || '-'}</div></div>
                  <div className="rounded-md border border-slate-200 p-3"><span className="text-slate-500">Board</span><div className="font-medium text-slate-900">{calendarPinDetail.pin.board_name || '-'}</div></div>
                  <div className="rounded-md border border-slate-200 p-3 md:col-span-2"><span className="text-slate-500">Description</span><div className="text-slate-700">{calendarPinDetail.pin.description || '-'}</div></div>
                  <div className="rounded-md border border-slate-200 p-3 md:col-span-2">
                    <span className="text-slate-500">Outbound URL</span>
                    <div className="flex items-center gap-2 truncate text-slate-700">
                      {calendarPinDetail.pin.link || calendarPinDetail.page.url || '-'}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3"><span className="text-slate-500">Date To Publish</span><div className="text-slate-700">{calendarPinDetail.pin.publish_date ? new Date(calendarPinDetail.pin.publish_date).toLocaleString() : 'Not scheduled'}</div></div>
                  <div className="rounded-md border border-slate-200 p-3"><span className="text-slate-500">Text Align</span><div className="text-slate-700">{calendarPinDetail.pin.text_align || 'left'}</div></div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Images</p>
                  <div className="grid grid-cols-3 gap-2">
                    {calendarPinDetail.images.map((image) => {
                      const isSelected = image.url === calendarPinDetail.pin.selected_image_url;
                      return (
                        <div key={image.id} className={`rounded border p-1 ${isSelected ? 'border-slate-400 ring-1 ring-slate-300' : 'border-slate-200'}`}>
                          <img src={apiClient.proxyImageUrl(image.url)} alt="" className="h-20 w-full rounded object-cover" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {regenOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 p-4" onClick={closeRegenerateModal}>
          <div
            className="mx-auto mt-6 w-full max-w-4xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Regenerate Pin</h3>
              <Button size="sm" variant="outline" onClick={closeRegenerateModal}>Close</Button>
            </div>
            {regenError && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{regenError}</div>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Template</label>
                  <select
                    value={regenTemplateId ?? ''}
                    onChange={(event) => setRegenTemplateId(Number(event.target.value))}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    {regenTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Selected Image</label>
                  <select
                    value={regenImageUrl}
                    onChange={(event) => setRegenImageUrl(event.target.value)}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    {regenAvailableImages.map((url) => (
                      <option key={url} value={url}>{url}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={regenAiContent}
                    onChange={(event) => setRegenAiContent(event.target.checked)}
                  />
                  Regenerate AI title/description
                </label>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (regenPinId) {
                      void loadRegenerateCandidate(regenPinId, {
                        templateId: regenTemplateId,
                        imageUrl: regenImageUrl,
                        regenerateAi: regenAiContent,
                      });
                    }
                  }}
                  disabled={regenLoading || !regenPinId}
                >
                  {regenLoading ? 'Generating...' : 'Generate Candidate'}
                </Button>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Page Images</div>
                  <div className="grid grid-cols-4 gap-2">
                    {(regenDetail?.images || []).map((image) => (
                      <button
                        key={image.id}
                        className={`overflow-hidden rounded border ${regenImageUrl === image.url ? 'border-slate-500 ring-1 ring-slate-300' : 'border-slate-200'}`}
                        onClick={() => setRegenImageUrl(image.url)}
                        title={image.url}
                      >
                        <img src={apiClient.proxyImageUrl(image.url)} alt="" className="h-16 w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-1 text-xs font-medium text-slate-500">Pinterest Title</div>
                  <div className="text-sm text-slate-900">{regenCandidate?.title || '-'}</div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-1 text-xs font-medium text-slate-500">Description</div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{regenCandidate?.description || '-'}</div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-1 text-xs font-medium text-slate-500">Board</div>
                  <div className="text-sm text-slate-900">{regenCandidate?.board_name || '-'}</div>
                </div>
                <Button onClick={() => void applyRegenerateCandidate()} disabled={regenApplying || regenLoading || !regenCandidate}>
                  {regenApplying ? 'Applying...' : 'Apply and Re-render'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
