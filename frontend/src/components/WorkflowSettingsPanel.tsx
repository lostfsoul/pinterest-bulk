import { useEffect, useMemo, useState } from 'react';
import apiClient, {
  ScheduleSettings,
  Website,
  WorkflowPinCountPreviewResponse,
  WorkflowStatusResponse,
  WorkflowTimeWindowPreviewResponse,
} from '../services/api';
import { Button } from './Button';

type WorkflowForm = {
  daily_pin_count: number;
  scheduling_window_days: number;
  auto_regeneration_enabled: boolean;
  auto_regeneration_days_before_deadline: number;
  timezone: string;
  start_hour: number;
  end_hour: number;
  desired_gap_days: number;
  lifetime_limit_enabled: boolean;
  lifetime_limit_count: number;
  monthly_limit_enabled: boolean;
  monthly_limit_count: number;
  floating_days: boolean;
  randomize_posting_times: boolean;
  max_floating_minutes: number;
  no_link_pins: boolean;
  floating_start_end_hours: boolean;
  start_window_flex_minutes: number;
  end_window_flex_minutes: number;
};

const DEFAULT_FORM: WorkflowForm = {
  daily_pin_count: 5,
  scheduling_window_days: 33,
  auto_regeneration_enabled: false,
  auto_regeneration_days_before_deadline: 3,
  timezone: 'UTC',
  start_hour: 13,
  end_hour: 21,
  desired_gap_days: 14,
  lifetime_limit_enabled: false,
  lifetime_limit_count: 0,
  monthly_limit_enabled: false,
  monthly_limit_count: 0,
  floating_days: true,
  randomize_posting_times: true,
  max_floating_minutes: 45,
  no_link_pins: false,
  floating_start_end_hours: false,
  start_window_flex_minutes: 60,
  end_window_flex_minutes: 120,
};

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDateLabel(value: string | null): string {
  if (!value) return 'Not scheduled yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled yet';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatMonthLabel(value: Date): string {
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function buildMonthGrid<T>(monthDate: Date, byDay: Record<number, T>): Array<Array<{ day: number; value: T | null } | null>> {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; value: T | null } | null> = [];

  for (let i = 0; i < firstDayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, value: byDay[day] ?? null });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: Array<Array<{ day: number; value: T | null } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function hourToLabel(hour: number): string {
  const h = clamp(hour, 0, 23);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:00 ${suffix}`;
}

export default function WorkflowSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [websites, setWebsites] = useState<Website[]>([]);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(null);
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatusResponse | null>(null);
  const [websiteSettingsRaw, setWebsiteSettingsRaw] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<WorkflowForm>(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState<WorkflowForm>(DEFAULT_FORM);
  const [previewMonth, setPreviewMonth] = useState<Date>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [showPinCountPreview, setShowPinCountPreview] = useState(true);
  const [showWindowPreview, setShowWindowPreview] = useState(true);
  const [pinCountPreview, setPinCountPreview] = useState<WorkflowPinCountPreviewResponse | null>(null);
  const [timeWindowPreview, setTimeWindowPreview] = useState<WorkflowTimeWindowPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const [websitesRes, scheduleRes] = await Promise.all([
          apiClient.listWebsites(),
          apiClient.getScheduleSettings(),
        ]);
        if (!mounted) return;
        setWebsites(websitesRes.data);
        setScheduleSettings(scheduleRes.data);
        const stored = localStorage.getItem('active_website_id');
        const storedId = stored ? Number(stored) : null;
        const resolvedWebsiteId = (
          storedId && websitesRes.data.some((site) => site.id === storedId)
            ? storedId
            : (websitesRes.data[0]?.id ?? null)
        );
        setActiveWebsiteId(resolvedWebsiteId);
      } catch (error) {
        console.error('Failed to load workflow settings:', error);
        setStatus('Failed to load workflow settings.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
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
    if (!activeWebsiteId) {
      setWorkflowStatus(null);
      setPinCountPreview(null);
      setTimeWindowPreview(null);
      return;
    }
    let mounted = true;
    const loadWebsiteData = async () => {
      try {
        const [settingsRes, workflowRes] = await Promise.all([
          apiClient.getWebsiteGenerationSettings(activeWebsiteId),
          apiClient.getWorkflowStatus(activeWebsiteId),
        ]);
        if (!mounted) return;

        const raw = (settingsRes.data.settings || {}) as Record<string, unknown>;
        setWebsiteSettingsRaw(raw);
        setWorkflowStatus(workflowRes.data);

        const generation = (raw.generation && typeof raw.generation === 'object')
          ? (raw.generation as Record<string, unknown>)
          : {};
        const content = (raw.content && typeof raw.content === 'object')
          ? (raw.content as Record<string, unknown>)
          : {};

        const nextForm: WorkflowForm = {
          daily_pin_count: toNumber(generation.daily_pin_count, workflowRes.data.pins_per_day ?? DEFAULT_FORM.daily_pin_count),
          scheduling_window_days: toNumber(generation.scheduling_window_days, workflowRes.data.window_days ?? DEFAULT_FORM.scheduling_window_days),
          auto_regeneration_enabled: Boolean(generation.auto_regeneration_enabled ?? workflowRes.data.auto_regen_enabled ?? DEFAULT_FORM.auto_regeneration_enabled),
          auto_regeneration_days_before_deadline: toNumber(
            generation.auto_regeneration_days_before_deadline,
            workflowRes.data.auto_regen_days_before_deadline ?? DEFAULT_FORM.auto_regeneration_days_before_deadline,
          ),
          timezone: String(generation.timezone ?? scheduleSettings?.timezone ?? DEFAULT_FORM.timezone),
          start_hour: toNumber(generation.start_hour, scheduleSettings?.start_hour ?? DEFAULT_FORM.start_hour),
          end_hour: toNumber(generation.end_hour, scheduleSettings?.end_hour ?? DEFAULT_FORM.end_hour),
          desired_gap_days: toNumber(content.desired_gap_days, workflowRes.data.desired_gap_days ?? DEFAULT_FORM.desired_gap_days),
          lifetime_limit_enabled: Boolean(content.lifetime_limit_enabled ?? DEFAULT_FORM.lifetime_limit_enabled),
          lifetime_limit_count: toNumber(content.lifetime_limit_count, DEFAULT_FORM.lifetime_limit_count),
          monthly_limit_enabled: Boolean(content.monthly_limit_enabled ?? DEFAULT_FORM.monthly_limit_enabled),
          monthly_limit_count: toNumber(content.monthly_limit_count, DEFAULT_FORM.monthly_limit_count),
          floating_days: Boolean(generation.floating_days ?? scheduleSettings?.floating_days ?? DEFAULT_FORM.floating_days),
          randomize_posting_times: Boolean(generation.randomize_posting_times ?? scheduleSettings?.random_minutes ?? DEFAULT_FORM.randomize_posting_times),
          max_floating_minutes: toNumber(generation.max_floating_minutes, scheduleSettings?.max_floating_minutes ?? DEFAULT_FORM.max_floating_minutes),
          no_link_pins: Boolean(content.no_link_pins ?? DEFAULT_FORM.no_link_pins),
          floating_start_end_hours: Boolean(generation.floating_start_end_hours ?? generation.enable_start_end_hours ?? DEFAULT_FORM.floating_start_end_hours),
          start_window_flex_minutes: toNumber(generation.start_window_flex_minutes, DEFAULT_FORM.start_window_flex_minutes),
          end_window_flex_minutes: toNumber(generation.end_window_flex_minutes, DEFAULT_FORM.end_window_flex_minutes),
        };
        setForm(nextForm);
        setSavedForm(nextForm);
      } catch (error) {
        console.error('Failed to load website workflow data:', error);
        setStatus('Failed to load website workflow data.');
      }
    };
    void loadWebsiteData();
    return () => {
      mounted = false;
    };
  }, [activeWebsiteId, scheduleSettings]);

  useEffect(() => {
    if (!activeWebsiteId) return;
    if (!showPinCountPreview && !showWindowPreview) return;

    let mounted = true;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const year = previewMonth.getFullYear();
        const month = previewMonth.getMonth() + 1;
        const [countRes, windowRes] = await Promise.all([
          showPinCountPreview
            ? apiClient.getWorkflowPinCountPreview({
              website_id: activeWebsiteId,
              year,
              month,
              daily_pin_count: form.daily_pin_count,
              floating_days: form.floating_days,
              warmup_month: false,
            })
            : Promise.resolve(null),
          showWindowPreview
            ? apiClient.getWorkflowTimeWindowPreview({
              website_id: activeWebsiteId,
              year,
              month,
              start_hour: form.start_hour,
              end_hour: form.end_hour,
              floating_start_end_hours: form.floating_start_end_hours,
              start_window_flex_minutes: form.start_window_flex_minutes,
              end_window_flex_minutes: form.end_window_flex_minutes,
            })
            : Promise.resolve(null),
        ]);
        if (!mounted) return;
        if (countRes) setPinCountPreview(countRes.data);
        if (windowRes) setTimeWindowPreview(windowRes.data);
      } catch (error) {
        if (!mounted) return;
        console.error('Failed to load preview:', error);
        setPreviewError('Failed to load schedule previews.');
      } finally {
        if (mounted) setPreviewLoading(false);
      }
    }, 260);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [
    activeWebsiteId,
    previewMonth,
    showPinCountPreview,
    showWindowPreview,
    form.daily_pin_count,
    form.floating_days,
    form.floating_start_end_hours,
    form.start_hour,
    form.end_hour,
    form.start_window_flex_minutes,
    form.end_window_flex_minutes,
  ]);

  const activeWebsite = useMemo(
    () => websites.find((website) => website.id === activeWebsiteId) ?? null,
    [websites, activeWebsiteId],
  );
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );

  const pinCountByDay = useMemo(() => {
    const map: Record<number, number> = {};
    for (const day of pinCountPreview?.days || []) map[day.day] = day.count;
    return map;
  }, [pinCountPreview]);

  const timeWindowByDay = useMemo(() => {
    const map: Record<number, { start_time: string; end_time: string }> = {};
    for (const day of timeWindowPreview?.days || []) {
      map[day.day] = { start_time: day.start_time, end_time: day.end_time };
    }
    return map;
  }, [timeWindowPreview]);

  const pinCountGrid = useMemo(
    () => buildMonthGrid(previewMonth, pinCountByDay),
    [previewMonth, pinCountByDay],
  );
  const timeWindowGrid = useMemo(
    () => buildMonthGrid(previewMonth, timeWindowByDay),
    [previewMonth, timeWindowByDay],
  );

  async function refreshWorkflowStatus() {
    if (!activeWebsiteId) return;
    try {
      const response = await apiClient.getWorkflowStatus(activeWebsiteId);
      setWorkflowStatus(response.data);
    } catch (error) {
      console.error('Failed to refresh workflow status:', error);
    }
  }

  async function saveWorkflowSettings() {
    if (!activeWebsiteId || !scheduleSettings) {
      setStatus('No active website selected.');
      return;
    }
    setSaving(true);
    setStatus('Saving workflow settings...');
    try {
      const mergedWebsiteSettings: Record<string, unknown> = {
        ...websiteSettingsRaw,
        generation: {
          ...(websiteSettingsRaw.generation && typeof websiteSettingsRaw.generation === 'object'
            ? (websiteSettingsRaw.generation as Record<string, unknown>)
            : {}),
          daily_pin_count: clamp(form.daily_pin_count, 1, 100),
          scheduling_window_days: clamp(form.scheduling_window_days, 2, 60),
          auto_regeneration_enabled: form.auto_regeneration_enabled,
          auto_regeneration_days_before_deadline: clamp(form.auto_regeneration_days_before_deadline, 0, 60),
          timezone: form.timezone.trim() || 'UTC',
          start_hour: clamp(form.start_hour, 0, 23),
          end_hour: clamp(form.end_hour, 0, 23),
          floating_days: form.floating_days,
          randomize_posting_times: form.randomize_posting_times,
          max_floating_minutes: clamp(form.max_floating_minutes, 0, 240),
          floating_start_end_hours: form.floating_start_end_hours,
          start_window_flex_minutes: clamp(form.start_window_flex_minutes, 0, 240),
          end_window_flex_minutes: clamp(form.end_window_flex_minutes, 0, 240),
        },
        content: {
          ...(websiteSettingsRaw.content && typeof websiteSettingsRaw.content === 'object'
            ? (websiteSettingsRaw.content as Record<string, unknown>)
            : {}),
          desired_gap_days: clamp(form.desired_gap_days, 0, 365),
          lifetime_limit_enabled: form.lifetime_limit_enabled,
          lifetime_limit_count: Math.max(0, form.lifetime_limit_count),
          monthly_limit_enabled: form.monthly_limit_enabled,
          monthly_limit_count: Math.max(0, form.monthly_limit_count),
          no_link_pins: form.no_link_pins,
        },
      };

      await apiClient.updateWebsiteGenerationSettings(activeWebsiteId, mergedWebsiteSettings);
      await apiClient.updateScheduleSettings({
        pins_per_day: clamp(form.daily_pin_count, 1, 100),
        start_hour: clamp(form.start_hour, 0, 23),
        end_hour: clamp(form.end_hour, 0, 23),
        min_days_reuse: clamp(form.desired_gap_days, 0, 365),
        timezone: form.timezone.trim() || 'UTC',
        random_minutes: form.randomize_posting_times,
        warmup_month: false,
        floating_days: form.floating_days,
        max_floating_minutes: clamp(form.max_floating_minutes, 0, 240),
      });
      setWebsiteSettingsRaw(mergedWebsiteSettings);
      setSavedForm(form);
      await refreshWorkflowStatus();
      setStatus('Workflow settings saved.');
    } catch (error) {
      console.error('Failed to save workflow settings:', error);
      setStatus('Failed to save workflow settings.');
    } finally {
      setSaving(false);
    }
  }

  async function generateNextBatch() {
    if (!activeWebsiteId) return;
    if (hasUnsavedChanges) {
      setStatus('You have unsaved workflow changes. Save changes before generating pins.');
      return;
    }
    setRunning(true);
    setStatus('Starting next batch generation...');
    try {
      const response = await apiClient.generateWorkflowNextBatch(activeWebsiteId);
      if (response.data.job_id != null) {
        localStorage.setItem('active_generation_job_id', String(response.data.job_id));
        window.dispatchEvent(new CustomEvent<number>('generation-job-change', { detail: response.data.job_id }));
      }
      const staleInfo = response.data.expired_stale_jobs
        ? ` Cleared ${response.data.expired_stale_jobs} stale job(s).`
        : '';
      setStatus((response.data.message || `Generation job #${response.data.job_id} queued.`) + staleInfo);
      await refreshWorkflowStatus();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        try {
          const forced = await apiClient.generateWorkflowNextBatch(activeWebsiteId, true);
          if (forced.data.job_id != null) {
            localStorage.setItem('active_generation_job_id', String(forced.data.job_id));
            window.dispatchEvent(new CustomEvent<number>('generation-job-change', { detail: forced.data.job_id }));
          }
          const staleInfo = forced.data.expired_stale_jobs
            ? ` Cleared ${forced.data.expired_stale_jobs} stale job(s).`
            : '';
          setStatus((forced.data.message || `Generation job #${forced.data.job_id} queued.`) + staleInfo);
          await refreshWorkflowStatus();
          return;
        } catch (forceError: unknown) {
          const forceDetail = (forceError as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setStatus(forceDetail || detail || 'Failed to start generation.');
          return;
        }
      }
      setStatus(detail || 'Failed to start generation.');
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Loading workflow settings...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-semibold uppercase mb-1 text-gray-500">Active Website</p>
            <div className="h-10 min-w-[280px] px-3 rounded-md border border-gray-300 bg-gray-50 text-sm text-gray-700 flex items-center">
              {activeWebsite?.name || 'No active website selected'}
            </div>
          </div>
          <Button onClick={() => void saveWorkflowSettings()} disabled={saving || !activeWebsiteId}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
        <div className="text-xs text-gray-500">
          {activeWebsite ? `Workflow settings for ${activeWebsite.name}` : 'No active website selected.'}
        </div>
        {hasUnsavedChanges && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You have unsaved workflow changes. Save changes before generating pins.
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">How many pins do you want to create daily?</span>
          <input
            type="number"
            min={1}
            max={100}
            value={form.daily_pin_count}
            onChange={(event) => setForm((prev) => ({ ...prev, daily_pin_count: clamp(Number(event.target.value) || 1, 1, 100) }))}
            className="mt-2 h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        </label>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold">Scheduling</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">Current Timezone</span>
            <input value={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'} readOnly className="h-10 w-full px-3 rounded-md border border-gray-300 bg-gray-50 text-gray-500" />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">New Timezone</span>
            <input
              value={form.timezone}
              onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
              className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
              placeholder="Select a timezone"
            />
          </label>
        </div>

        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">Pin scheduling window ({form.scheduling_window_days} days)</span>
          <input
            type="range"
            min={2}
            max={60}
            value={form.scheduling_window_days}
            onChange={(event) => setForm((prev) => ({ ...prev, scheduling_window_days: clamp(Number(event.target.value) || 2, 2, 60) }))}
            className="w-full"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.auto_regeneration_enabled}
            onChange={(event) => setForm((prev) => ({ ...prev, auto_regeneration_enabled: event.target.checked }))}
          />
          Enable automatic pin regeneration (background scheduler)
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            Regenerate when days ahead &lt;=
          </span>
          <input
            type="number"
            min={0}
            max={60}
            value={form.auto_regeneration_days_before_deadline}
            onChange={(event) => setForm((prev) => ({
              ...prev,
              auto_regeneration_days_before_deadline: clamp(Number(event.target.value) || 0, 0, 60),
            }))}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 md:w-56"
          />
        </label>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.floating_days}
            onChange={(event) => setForm((prev) => ({ ...prev, floating_days: event.target.checked }))}
          />
          Use floating days (randomize daily pin count ±2)
        </label>
        <p className="text-sm text-gray-500">Number of daily pins will vary by ±2 to create natural posting patterns.</p>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={showPinCountPreview}
            onChange={(event) => setShowPinCountPreview(event.target.checked)}
          />
          Show/Hide Pin Schedule Preview
        </label>
        {showPinCountPreview && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <button className="h-8 w-8 border border-gray-200 rounded-md" onClick={() => setPreviewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>‹</button>
              <p className="text-sm font-semibold">Est. pin counts for {formatMonthLabel(previewMonth)} (Base: {form.daily_pin_count})</p>
              <button className="h-8 w-8 border border-gray-200 rounded-md" onClick={() => setPreviewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>›</button>
            </div>
            <div className="space-y-2">
              {pinCountGrid.map((week, index) => (
                <div key={index} className="grid grid-cols-7 gap-2">
                  {week.map((dayCell, cellIndex) => (
                    <div key={cellIndex} className="h-14 border border-gray-200 rounded-md bg-white flex flex-col items-center justify-center text-xs">
                      {dayCell ? (
                        <>
                          <div className="font-medium">{dayCell.day}</div>
                          <div className="text-gray-500">{dayCell.value ?? '-'}</div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={form.floating_start_end_hours}
              onChange={(event) => setForm((prev) => ({ ...prev, floating_start_end_hours: event.target.checked }))}
            />
            Enable floating start/end hours
          </label>
          <button
            className="text-sm text-gray-500"
            onClick={() => setForm((prev) => ({ ...prev, floating_start_end_hours: false, start_window_flex_minutes: 60, end_window_flex_minutes: 120 }))}
          >
            Clear
          </button>
        </div>
        <p className="text-sm text-gray-500">
          Let your start and end times shift daily so the schedule feels more human.
          Current drift lets the start window flex ±{form.start_window_flex_minutes} minutes and the end window flex ±{form.end_window_flex_minutes} minutes.
        </p>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
          We randomize around your base window ({hourToLabel(form.start_hour)} - {hourToLabel(form.end_hour)}) using the limits below so every day feels unique.
          All times stay between 12:00 AM and 11:59 PM.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="block text-xs font-semibold uppercase text-gray-500">Start window flex (minutes)</span>
            <input
              type="number"
              min={0}
              max={240}
              value={form.start_window_flex_minutes}
              onChange={(event) => setForm((prev) => ({ ...prev, start_window_flex_minutes: clamp(Number(event.target.value) || 0, 0, 240) }))}
              className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
            />
            <p className="text-xs text-gray-500">Example window: {hourToLabel(clamp(form.start_hour - 1, 0, 23))} - {hourToLabel(clamp(form.start_hour + 1, 0, 23))}</p>
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-xs font-semibold uppercase text-gray-500">End window flex (minutes)</span>
            <input
              type="number"
              min={0}
              max={240}
              value={form.end_window_flex_minutes}
              onChange={(event) => setForm((prev) => ({ ...prev, end_window_flex_minutes: clamp(Number(event.target.value) || 0, 0, 240) }))}
              className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
            />
            <p className="text-xs text-gray-500">Example window: {hourToLabel(clamp(form.end_hour - 2, 0, 23))} - {hourToLabel(clamp(form.end_hour + 2, 0, 23))}</p>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={showWindowPreview}
            onChange={(event) => setShowWindowPreview(event.target.checked)}
          />
          {showWindowPreview ? 'Hide preview' : 'Show preview'}
        </label>
        {showWindowPreview && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <button className="h-8 w-8 border border-gray-200 rounded-md" onClick={() => setPreviewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>‹</button>
              <p className="text-sm font-semibold">Preview for {formatMonthLabel(previewMonth)}</p>
              <button className="h-8 w-8 border border-gray-200 rounded-md" onClick={() => setPreviewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>›</button>
            </div>
            <div className="space-y-2">
              {timeWindowGrid.map((week, index) => (
                <div key={index} className="grid grid-cols-7 gap-2">
                  {week.map((dayCell, cellIndex) => (
                    <div key={cellIndex} className="h-20 border border-gray-200 rounded-md bg-white flex flex-col items-center justify-center text-xs px-1">
                      {dayCell ? (
                        <>
                          <div className="font-medium">{dayCell.day}</div>
                          <div className="text-gray-500 text-center leading-tight">
                            {dayCell.value ? `${dayCell.value.start_time} - ${dayCell.value.end_time}` : '-'}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">Start Hour</span>
          <input
            type="number"
            min={0}
            max={23}
            value={form.start_hour}
            onChange={(event) => setForm((prev) => ({ ...prev, start_hour: clamp(Number(event.target.value) || 0, 0, 23) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">End Hour</span>
          <input
            type="number"
            min={0}
            max={23}
            value={form.end_hour}
            onChange={(event) => setForm((prev) => ({ ...prev, end_hour: clamp(Number(event.target.value) || 0, 0, 23) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.randomize_posting_times}
            onChange={(event) => setForm((prev) => ({ ...prev, randomize_posting_times: event.target.checked }))}
          />
          Use floating minutes
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">Maximum floating minutes</span>
          <input
            type="number"
            min={0}
            max={240}
            value={form.max_floating_minutes}
            onChange={(event) => setForm((prev) => ({ ...prev, max_floating_minutes: clamp(Number(event.target.value) || 0, 0, 240) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        </label>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase mb-1 text-gray-500">Desired days between pins from same URL</span>
          <input
            type="number"
            min={0}
            max={365}
            value={form.desired_gap_days}
            onChange={(event) => setForm((prev) => ({ ...prev, desired_gap_days: clamp(Number(event.target.value) || 0, 0, 365) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.lifetime_limit_enabled}
            onChange={(event) => setForm((prev) => ({ ...prev, lifetime_limit_enabled: event.target.checked }))}
          />
          Lifetime pin limit per URL
        </label>
        {form.lifetime_limit_enabled && (
          <input
            type="number"
            min={1}
            value={form.lifetime_limit_count}
            onChange={(event) => setForm((prev) => ({ ...prev, lifetime_limit_count: Math.max(1, Number(event.target.value) || 1) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.monthly_limit_enabled}
            onChange={(event) => setForm((prev) => ({ ...prev, monthly_limit_enabled: event.target.checked }))}
          />
          Monthly pin limit per URL
        </label>
        {form.monthly_limit_enabled && (
          <input
            type="number"
            min={1}
            value={form.monthly_limit_count}
            onChange={(event) => setForm((prev) => ({ ...prev, monthly_limit_count: Math.max(1, Number(event.target.value) || 1) }))}
            className="h-10 w-full px-3 rounded-md border border-gray-300 bg-white"
          />
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.no_link_pins}
            onChange={(event) => setForm((prev) => ({ ...prev, no_link_pins: event.target.checked }))}
          />
          Upload without URL
        </label>
      </div>

      {previewLoading && <div className="text-xs text-gray-500">Loading schedule preview…</div>}
      {previewError && <div className="text-xs text-red-600">{previewError}</div>}
      {status && <div className="text-xs border border-gray-200 rounded-md px-3 py-2 bg-gray-50">{status}</div>}

      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Pins are currently generated until: <strong className="text-slate-900">{formatDateLabel(workflowStatus?.scheduled_until || null)}</strong>
        </p>
        <Button
          className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => void generateNextBatch()}
          disabled={running || !activeWebsiteId || Boolean(workflowStatus?.has_active_job) || hasUnsavedChanges}
        >
          {running
            ? 'Starting Generation...'
            : workflowStatus?.has_active_job
              ? 'Generation In Progress'
              : hasUnsavedChanges
                ? 'Save Changes Before Generating'
                : 'Generate Pins Now'}
        </Button>
      </div>
    </div>
  );
}
