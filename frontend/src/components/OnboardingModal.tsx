import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import apiClient, {
  Page,
  PlaygroundFontSet,
  PlaygroundPageItem,
  PlaygroundSettings,
  PlaygroundTemplateItem,
  ScheduleSettings,
  Website,
} from '../services/api';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import SvgRenderer from './playground/SvgRenderer';
import PreviewSidebar from './playground/PreviewSidebar';
import {
  filterPages,
  groupPages,
  type PageGroupingMode,
  type PageSelectionFilter,
} from '../utils/pageGrouping';
import {
  DEFAULT_PLAYGROUND_TEXT_SETTINGS,
  clampLineHeightMultiplier,
  clampTitlePaddingX,
  clampTitleScale,
  normalizeFontSets,
} from '../utils/playgroundSettings';

type OnboardingModalProps = {
  open: boolean;
  website: Website | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
};

type WorkflowDraft = {
  daily_pin_count: number;
  scheduling_window_days: number;
  start_hour: number;
  end_hour: number;
  timezone: string;
  floating_days: boolean;
  randomize_posting_times: boolean;
  max_floating_minutes: number;
};

const STEPS = [
  { title: 'Pin Preview', subtitle: 'Customize pin appearance' },
  { title: 'Generation Settings', subtitle: 'Configure scheduling' },
  { title: 'Pages To Use', subtitle: 'Select pages' },
  { title: 'Boards To Use', subtitle: 'Choose boards or CSV names' },
  { title: 'Review & Generate', subtitle: 'Start generating pins' },
];

const DEFAULT_WORKFLOW: WorkflowDraft = {
  daily_pin_count: 5,
  scheduling_window_days: 3,
  start_hour: 8,
  end_hour: 20,
  timezone: 'UTC',
  floating_days: true,
  randomize_posting_times: true,
  max_floating_minutes: 45,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mergeRecords(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function splitBoards(value: string): string[] {
  const seen = new Set<string>();
  const boards: string[] = [];
  for (const item of value.split(/[,\n]+/)) {
    const board = item.trim().replace(/\s+/g, ' ');
    if (!board) continue;
    const key = board.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push(board);
  }
  return boards;
}

export function shouldShowOnboarding(website: Website | null): boolean {
  if (!website?.generation_settings) return false;
  const onboarding = asRecord(website.generation_settings.onboarding);
  return Boolean(onboarding.required) && !Boolean(onboarding.completed);
}

export default function OnboardingModal({
  open,
  website,
  onOpenChange,
  onCompleted,
}: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);
  const [templates, setTemplates] = useState<PlaygroundTemplateItem[]>([]);
  const [fontSets, setFontSets] = useState<PlaygroundFontSet[]>([]);
  const [playgroundPages, setPlaygroundPages] = useState<PlaygroundPageItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [activeFontSetId, setActiveFontSetId] = useState('');
  const [activeFontColor, setActiveFontColor] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor);
  const [titleScale, setTitleScale] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titleScale);
  const [titlePaddingX, setTitlePaddingX] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titlePaddingX);
  const [lineHeightMultiplier, setLineHeightMultiplier] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.lineHeightMultiplier);
  const [workflow, setWorkflow] = useState<WorkflowDraft>(DEFAULT_WORKFLOW);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [boardsText, setBoardsText] = useState('');
  const [pageQuery, setPageQuery] = useState('');
  const [pageGroupMode, setPageGroupMode] = useState<PageGroupingMode>('prefix');
  const [pageSelectionFilter, setPageSelectionFilter] = useState<PageSelectionFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const activeFontSet = useMemo(
    () => fontSets.find((font) => font.id === activeFontSetId) ?? null,
    [activeFontSetId, fontSets],
  );
  const activeFontFamily = activeFontSet?.main || 'Bebas Neue';
  const boards = useMemo(() => splitBoards(boardsText), [boardsText]);
  const enabledPagesCount = selectedPageIds.size;
  const previewPage = useMemo(() => {
    return pages.find((page) => selectedPageIds.has(page.id)) ?? pages[0] ?? null;
  }, [pages, selectedPageIds]);
  const previewImages = useMemo(() => {
    const sampleImages = [
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%23f59e0b"/%3E%3Cstop offset="1" stop-color="%23dc2626"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="900" height="1200" fill="url(%23g)"/%3E%3Ccircle cx="700" cy="240" r="180" fill="%23fff7ed" opacity=".35"/%3E%3Ccircle cx="230" cy="760" r="260" fill="%23ffffff" opacity=".22"/%3E%3C/svg%3E',
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="1" x2="0" y1="0" y2="1"%3E%3Cstop stop-color="%230f766e"/%3E%3Cstop offset="1" stop-color="%2384cc16"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="900" height="1200" fill="url(%23g)"/%3E%3Ccircle cx="230" cy="260" r="190" fill="%23ecfccb" opacity=".33"/%3E%3Ccircle cx="670" cy="820" r="240" fill="%23ffffff" opacity=".2"/%3E%3C/svg%3E',
    ];
    const pageImages = playgroundPages.find((page) => page.url === previewPage?.url)?.images;
    return Array.isArray(pageImages) && pageImages.length > 0 ? pageImages : sampleImages;
  }, [playgroundPages, previewPage]);
  const filteredPages = useMemo(() => {
    const pageItems = pages.map((page) => ({
      ...page,
      is_enabled: selectedPageIds.has(page.id),
    }));
    return filterPages(pageItems, pageQuery, pageSelectionFilter);
  }, [pageQuery, pageSelectionFilter, pages, selectedPageIds]);
  const pageGroups = useMemo(() => {
    return groupPages(filteredPages, pageGroupMode);
  }, [filteredPages, pageGroupMode]);

  useEffect(() => {
    if (!open || !website) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setStatus('');
      setStep(0);
      try {
        const [settingsRes, templatesRes, fontsRes, scheduleRes, pagesRes, playgroundPagesRes] = await Promise.all([
          apiClient.getWebsiteGenerationSettings(website.id),
          apiClient.getPlaygroundTemplates(),
          apiClient.getPlaygroundFonts(),
          apiClient.getScheduleSettings(),
          apiClient.listWebsitePages(website.id),
          apiClient.getPlaygroundPages(website.id).catch(() => ({ data: [] as PlaygroundPageItem[] })),
        ]);
        if (!active) return;

        const nextSettings = settingsRes.data.settings || {};
        const generation = asRecord(nextSettings.generation);
        const ai = asRecord(nextSettings.ai);
        const playground = await apiClient.getPlaygroundSettings(website.id).catch(() => null);
        const playgroundSettings = playground?.data;
        const templateItems = templatesRes.data.templates || [];
        const selectedFromPlayground = Array.isArray(playgroundSettings?.selected_templates)
          ? playgroundSettings?.selected_templates
          : [];
        const defaultTemplate = Number(playgroundSettings?.default_template_id);
        const fallbackTemplateId = Number.isFinite(defaultTemplate)
          ? defaultTemplate
          : Number(selectedFromPlayground[0] ?? templateItems[0]?.id);
        const filteredFonts = normalizeFontSets(fontsRes.data.filter((font) => (
          String(font.id || '').startsWith('custom:')
          || String(font.id || '').startsWith('font_combo_')
        )));
        const persistedFontSetId = String(playgroundSettings?.font_set || '');
        const fallbackFontSetId = filteredFonts.some((font) => font.id === persistedFontSetId)
          ? persistedFontSetId
          : (filteredFonts[0]?.id || '');

        setSettings(nextSettings);
        setSchedule(scheduleRes.data);
        setTemplates(templateItems);
        setFontSets(filteredFonts);
        setPlaygroundPages(playgroundPagesRes.data || []);
        setSelectedTemplateId(Number.isFinite(fallbackTemplateId) ? fallbackTemplateId : null);
        setActiveFontSetId(fallbackFontSetId);
        setActiveFontColor(String(playgroundSettings?.font_color || DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor));
        setTitleScale(clampTitleScale(playgroundSettings?.title_scale));
        setTitlePaddingX(clampTitlePaddingX(playgroundSettings?.title_padding_x));
        setLineHeightMultiplier(clampLineHeightMultiplier(playgroundSettings?.line_height_multiplier));
        setWorkflow({
          daily_pin_count: clamp(Number(generation.daily_pin_count || DEFAULT_WORKFLOW.daily_pin_count), 1, 100),
          scheduling_window_days: clamp(Number(generation.scheduling_window_days || DEFAULT_WORKFLOW.scheduling_window_days), 2, 60),
          start_hour: clamp(Number(generation.start_hour ?? scheduleRes.data.start_hour ?? DEFAULT_WORKFLOW.start_hour), 0, 23),
          end_hour: clamp(Number(generation.end_hour ?? scheduleRes.data.end_hour ?? DEFAULT_WORKFLOW.end_hour), 0, 23),
          timezone: String(generation.timezone || scheduleRes.data.timezone || DEFAULT_WORKFLOW.timezone),
          floating_days: Boolean(generation.floating_days ?? scheduleRes.data.floating_days ?? DEFAULT_WORKFLOW.floating_days),
          randomize_posting_times: Boolean(generation.randomize_posting_times ?? scheduleRes.data.random_minutes ?? DEFAULT_WORKFLOW.randomize_posting_times),
          max_floating_minutes: clamp(Number(generation.max_floating_minutes ?? scheduleRes.data.max_floating_minutes ?? DEFAULT_WORKFLOW.max_floating_minutes), 0, 240),
        });
        const pageItems = pagesRes.data || [];
        setPages(pageItems);
        setSelectedPageIds(new Set(pageItems.filter((page) => page.is_enabled).map((page) => page.id)));
        setPageQuery('');
        setPageGroupMode('prefix');
        setPageSelectionFilter('all');
        setCollapsedGroups(new Set());
        const existingBoards = Array.isArray(ai.board_candidates) ? ai.board_candidates.map(String) : [];
        setBoardsText(existingBoards.join('\n'));
      } catch (error) {
        console.error('Failed to load onboarding data:', error);
        setStatus('Failed to load onboarding data.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [open, website]);

  async function saveSettingsPatch(
    patch: Record<string, unknown>,
    baseSettings: Record<string, unknown> = settings,
  ): Promise<Record<string, unknown>> {
    if (!website) return baseSettings;
    const next = mergeRecords(baseSettings, patch);
    await apiClient.updateWebsiteGenerationSettings(website.id, next);
    setSettings(next);
    return next;
  }

  async function saveTemplateStep() {
    if (!website || !selectedTemplateId) {
      setStatus('Choose a template before continuing.');
      return false;
    }
    const existing = await apiClient.getPlaygroundSettings(website.id).catch(() => null);
    const current = existing?.data;
    const selected = Array.isArray(current?.selected_templates)
      ? Array.from(new Set([...current.selected_templates, selectedTemplateId]))
      : [selectedTemplateId];
    const payload: PlaygroundSettings = {
      selected_templates: selected,
      default_template_id: selectedTemplateId,
      font_set: activeFontSetId || current?.font_set || '',
      font_color: activeFontColor || DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor,
      title_scale: titleScale,
      title_padding_x: titlePaddingX,
      line_height_multiplier: lineHeightMultiplier,
      ai_settings: current?.ai_settings || {},
      image_settings: current?.image_settings || {},
      display_settings: current?.display_settings || {},
      advanced_settings: current?.advanced_settings || {},
    };
    await apiClient.savePlaygroundSettings(website.id, payload);
    await saveSettingsPatch({
      design: { template_ids: selected },
      onboarding: { current_step: 1 },
    });
    return true;
  }

  async function saveWorkflowStep() {
    if (!website || !schedule) return false;
    await saveSettingsPatch({
      generation: {
        daily_pin_count: workflow.daily_pin_count,
        scheduling_window_days: workflow.scheduling_window_days,
        start_hour: workflow.start_hour,
        end_hour: workflow.end_hour,
        timezone: workflow.timezone.trim() || 'UTC',
        floating_days: workflow.floating_days,
        randomize_posting_times: workflow.randomize_posting_times,
        max_floating_minutes: workflow.max_floating_minutes,
      },
      onboarding: { current_step: 2 },
    });
    await apiClient.updateScheduleSettings({
      pins_per_day: workflow.daily_pin_count,
      start_hour: workflow.start_hour,
      end_hour: workflow.end_hour,
      min_days_reuse: schedule.min_days_reuse,
      timezone: workflow.timezone.trim() || 'UTC',
      random_minutes: workflow.randomize_posting_times,
      warmup_month: schedule.warmup_month,
      floating_days: workflow.floating_days,
      max_floating_minutes: workflow.max_floating_minutes,
    });
    return true;
  }

  async function importPages() {
    if (!website) return;
    setImporting(true);
    setStatus('Importing sitemap pages...');
    try {
      const result = await apiClient.importSitemap(website.id);
      const [pagesRes, playgroundPagesRes] = await Promise.all([
        apiClient.listWebsitePages(website.id),
        apiClient.getPlaygroundPages(website.id).catch(() => ({ data: [] as PlaygroundPageItem[] })),
      ]);
      const nextPages = pagesRes.data || [];
      setPages(nextPages);
      setPlaygroundPages(playgroundPagesRes.data || []);
      setSelectedPageIds(new Set(nextPages.filter((page) => page.is_enabled).map((page) => page.id)));
      setCollapsedGroups(new Set());
      setStatus(`Imported ${result.data.total_urls} URL(s).`);
    } catch (error) {
      console.error('Failed to import pages:', error);
      setStatus('Failed to import sitemap pages.');
    } finally {
      setImporting(false);
    }
  }

  async function savePagesStep() {
    if (!website) return false;
    if (selectedPageIds.size === 0) {
      setStatus('Select at least one page before continuing.');
      return false;
    }
    const allIds = pages.map((page) => page.id);
    const selectedIds = Array.from(selectedPageIds);
    if (allIds.length > 0) {
      await apiClient.updatePagesBulk({ page_ids: allIds, is_enabled: false });
      await apiClient.updatePagesBulk({ page_ids: selectedIds, is_enabled: true });
      const pagesRes = await apiClient.listWebsitePages(website.id);
      setPages(pagesRes.data || []);
    }
    await saveSettingsPatch({ onboarding: { current_step: 3 } });
    return true;
  }

  async function saveBoardsStep() {
    await saveSettingsPatch({
      ai: { board_candidates: boards },
      onboarding: { current_step: 4 },
    });
    return true;
  }

  async function markCompleted(baseSettings: Record<string, unknown> = settings) {
    if (!website) return;
    await saveSettingsPatch({
      onboarding: {
        required: true,
        completed: true,
        completed_at: new Date().toISOString(),
      },
    }, baseSettings);
    onCompleted();
  }

  async function nextStep() {
    setSaving(true);
    setStatus('');
    try {
      const ok =
        step === 0 ? await saveTemplateStep()
          : step === 1 ? await saveWorkflowStep()
            : step === 2 ? await savePagesStep()
              : step === 3 ? await saveBoardsStep()
                : true;
      if (ok) setStep((prev) => Math.min(STEPS.length - 1, prev + 1));
    } catch (error) {
      console.error('Failed to save onboarding step:', error);
      setStatus('Failed to save this step.');
    } finally {
      setSaving(false);
    }
  }

  async function generateFirstPins() {
    if (!website) return;
    setGenerating(true);
    setStatus('Starting first pin generation...');
    try {
      await saveBoardsStep();
      const response = await apiClient.generateWorkflowNextBatch(website.id);
      if (response.data.job_id != null) {
        localStorage.setItem('active_generation_job_id', String(response.data.job_id));
        window.dispatchEvent(new CustomEvent<number>('generation-job-change', { detail: response.data.job_id }));
      }
      const nextSettings = mergeRecords(settings, { ai: { board_candidates: boards } });
      await markCompleted(nextSettings);
      setStatus(response.data.message || 'First generation started.');
      onOpenChange(false);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      console.error('Failed to start first generation:', error);
      setStatus(detail || 'Failed to start first generation.');
    } finally {
      setGenerating(false);
    }
  }

  function togglePage(id: number) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setPagesSelection(pageIds: number[], selected: boolean) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function resetTextSettings() {
    setTitleScale(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titleScale);
    setTitlePaddingX(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titlePaddingX);
    setLineHeightMultiplier(DEFAULT_PLAYGROUND_TEXT_SETTINGS.lineHeightMultiplier);
    setActiveFontColor(DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor);
  }

  const canContinue =
    step === 0 ? Boolean(selectedTemplateId)
      : step === 2 ? selectedPageIds.size > 0
        : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Onboarding</DialogTitle>
          <DialogDescription>
            Set up {website?.name || 'this website'} for its first pin generation.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-2 grid grid-cols-5 gap-2 border-b border-slate-200 pb-5">
          <div className="absolute left-8 right-8 top-4 h-0.5 bg-slate-200" />
          <div
            className="absolute left-8 top-4 h-0.5 bg-pink-600 transition-all"
            style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
          />
          {STEPS.map((item, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <button
                key={item.title}
                type="button"
                className="relative z-10 flex flex-col items-center gap-1 text-center"
                onClick={() => setStep(index)}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold ${
                  done || active ? 'border-pink-600 bg-pink-600 text-white' : 'border-slate-300 bg-slate-800 text-slate-300'
                }`}>
                  {done ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className={`text-xs font-semibold ${active ? 'text-slate-950' : 'text-slate-500'}`}>{item.title}</span>
                <span className="hidden text-[10px] text-slate-500 md:block">{item.subtitle}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading onboarding...
          </div>
        ) : (
          <div className="min-h-[420px]">
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Choose and preview the first pin template</h3>
                  <p className="text-sm text-slate-500">This uses the same renderer as Playground and becomes the default template for first generation.</p>
                </div>
                {templates.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                    No templates available. Upload a template in Playground first.
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="rounded-xl border border-slate-200 bg-slate-950 p-4">
                      {selectedTemplate ? (
                        <div className="mx-auto max-h-[560px] max-w-[430px] overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-3">
                          <SvgRenderer
                            templatePath={selectedTemplate.path}
                            pageImages={previewImages}
                            title={previewPage?.title || 'Your First Pinterest Pin'}
                            fontFamily={activeFontFamily}
                            fontSetId={activeFontSetId}
                            fontFile={activeFontSet?.font_file || null}
                            textColor={activeFontColor}
                            titleScale={titleScale}
                            titlePaddingX={titlePaddingX}
                            lineHeightMultiplier={lineHeightMultiplier}
                            onTitleScaleChange={setTitleScale}
                            onTitlePaddingXChange={setTitlePaddingX}
                            onLineHeightMultiplierChange={setLineHeightMultiplier}
                            showDragControls
                            imageSettings={{
                              ignoreSmallWidth: true,
                              minWidth: 200,
                              ignoreSmallHeight: false,
                              minHeight: 200,
                              allowedOrientations: ['portrait', 'square', 'landscape'],
                            }}
                            zoom={0.8}
                            className="mx-auto"
                          />
                        </div>
                      ) : (
                        <div className="flex h-[460px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-400">
                          Choose a template to preview.
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <PreviewSidebar
                        fontSets={fontSets}
                        activeFontSetId={activeFontSetId}
                        onSelectFontSet={setActiveFontSetId}
                        activeFontColor={activeFontColor}
                        onFontColorChange={setActiveFontColor}
                        templates={templates}
                        selectedTemplateIds={selectedTemplateId ? [selectedTemplateId] : []}
                        activeTemplateId={selectedTemplateId}
                        onSelectTemplate={setSelectedTemplateId}
                        onToggleTemplateSelection={(id) => setSelectedTemplateId((prev) => (prev === id ? null : id))}
                        defaultTemplateId={selectedTemplateId}
                        onSetDefaultTemplate={setSelectedTemplateId}
                        titleScale={titleScale}
                        titlePaddingX={titlePaddingX}
                        lineHeightMultiplier={lineHeightMultiplier}
                        onResetTextSettings={resetTextSettings}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Configure the first schedule</h3>
                  <p className="text-sm text-slate-500">These values are saved to the same Workflow settings used later.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Pins per day</span>
                    <input type="number" min={1} max={100} value={workflow.daily_pin_count} onChange={(e) => setWorkflow((prev) => ({ ...prev, daily_pin_count: clamp(Number(e.target.value) || 1, 1, 100) }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Generate for days</span>
                    <input type="number" min={2} max={60} value={workflow.scheduling_window_days} onChange={(e) => setWorkflow((prev) => ({ ...prev, scheduling_window_days: clamp(Number(e.target.value) || 2, 2, 60) }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Start hour</span>
                    <input type="number" min={0} max={23} value={workflow.start_hour} onChange={(e) => setWorkflow((prev) => ({ ...prev, start_hour: clamp(Number(e.target.value) || 0, 0, 23) }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">End hour</span>
                    <input type="number" min={0} max={23} value={workflow.end_hour} onChange={(e) => setWorkflow((prev) => ({ ...prev, end_hour: clamp(Number(e.target.value) || 0, 0, 23) }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Timezone</span>
                    <input value={workflow.timezone} onChange={(e) => setWorkflow((prev) => ({ ...prev, timezone: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Max floating minutes</span>
                    <input type="number" min={0} max={240} value={workflow.max_floating_minutes} onChange={(e) => setWorkflow((prev) => ({ ...prev, max_floating_minutes: clamp(Number(e.target.value) || 0, 0, 240) }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={workflow.floating_days} onChange={(e) => setWorkflow((prev) => ({ ...prev, floating_days: e.target.checked }))} />
                    Use floating days
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={workflow.randomize_posting_times} onChange={(e) => setWorkflow((prev) => ({ ...prev, randomize_posting_times: e.target.checked }))} />
                    Randomize posting times
                  </label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Import and select pages</h3>
                    <p className="text-sm text-slate-500">Enabled pages become candidates for first generation.</p>
                  </div>
                  <Button variant="outline" onClick={() => void importPages()} disabled={importing || !website}>
                    {importing ? 'Importing...' : 'Import Sitemap Pages'}
                  </Button>
                </div>
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={pageQuery}
                      onChange={(event) => setPageQuery(event.target.value)}
                      placeholder="Search by URL or title"
                      className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                      {([
                        ['prefix', 'Prefix'],
                        ['sitemap', 'Sitemap'],
                        ['categories', 'Categories'],
                      ] as Array<[PageGroupingMode, string]>).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setPageGroupMode(value)}
                          className={`rounded px-3 py-1.5 text-xs ${pageGroupMode === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                      {([
                        ['all', 'All'],
                        ['enabled', 'Selected'],
                        ['disabled', 'Non Selected'],
                      ] as Array<[PageSelectionFilter, string]>).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setPageSelectionFilter(value)}
                          className={`rounded px-3 py-1.5 text-xs ${pageSelectionFilter === value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span>{selectedPageIds.size} of {pages.length} selected</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setPagesSelection(filteredPages.map((page) => page.id), true)}>Enable Visible</Button>
                    <Button size="sm" variant="outline" onClick={() => setPagesSelection(filteredPages.map((page) => page.id), false)}>Disable Visible</Button>
                  </div>
                </div>
                <div className="max-h-[420px] overflow-y-auto rounded-md border border-slate-200">
                  {pages.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">Import sitemap pages to continue.</div>
                  ) : pageGroups.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">No pages match the current filters.</div>
                  ) : pageGroups.map((group) => {
                    const selectedInGroup = group.pages.filter((page) => selectedPageIds.has(page.id)).length;
                    const fullySelected = selectedInGroup === group.pages.length && group.pages.length > 0;
                    const collapsed = collapsedGroups.has(group.key);
                    return (
                      <div key={group.key} className="border-b border-slate-200 last:border-b-0">
                        <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={fullySelected}
                              onChange={() => setPagesSelection(group.pages.map((page) => page.id), !fullySelected)}
                            />
                            <button
                              className="truncate text-left text-sm font-medium text-slate-900"
                              onClick={() => setPagesSelection(group.pages.map((page) => page.id), !fullySelected)}
                            >
                              {group.label}
                            </button>
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
                              {selectedInGroup}/{group.pages.length} selected
                            </span>
                          </div>
                          <button
                            className="rounded-md border border-slate-300 p-1 text-slate-600"
                            onClick={() => {
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.key)) next.delete(group.key);
                                else next.add(group.key);
                                return next;
                              });
                            }}
                          >
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>
                        {!collapsed && group.pages.map((page) => (
                          <label key={page.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <input type="checkbox" checked={selectedPageIds.has(page.id)} onChange={() => togglePage(page.id)} />
                              <span className="truncate text-sm text-slate-700">{page.title || page.url}</span>
                            </span>
                            <span className="hidden max-w-xs shrink-0 truncate text-xs text-slate-500 md:block">{page.url}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Add board candidates</h3>
                  <p className="text-sm text-slate-500">Generation will choose from this list. Leave blank to use General.</p>
                </div>
                <textarea
                  value={boardsText}
                  onChange={(e) => setBoardsText(e.target.value)}
                  placeholder="Air Fryer Recipes&#10;Quick Dinners&#10;Easy Desserts"
                  className="min-h-[260px] w-full rounded-md border border-slate-300 p-3 text-sm"
                />
                <div className="text-sm text-slate-500">{boards.length} board candidate(s)</div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Review first generation</h3>
                  <p className="text-sm text-slate-500">The normal Calendar workflow will run using these saved settings.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Template</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{selectedTemplate?.name || 'No template selected'}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Schedule</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{workflow.daily_pin_count} pins/day for {workflow.scheduling_window_days} days</div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Pages</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{enabledPagesCount} selected page(s)</div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Boards</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{boards.length ? boards.slice(0, 3).join(', ') : 'General'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {status && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {status}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || generating}>
            Close for now
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep((prev) => Math.max(0, prev - 1))} disabled={step === 0 || saving || generating}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => void nextStep()} disabled={!canContinue || saving || loading}>
                {saving ? 'Saving...' : 'Next'}
              </Button>
            ) : (
              <Button onClick={() => void generateFirstPins()} disabled={generating || saving || !selectedTemplateId || selectedPageIds.size === 0}>
                {generating ? 'Starting...' : 'Generate First Pins'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
