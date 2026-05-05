import { useEffect, useState } from 'react';
import apiClient, { GlobalExcludedImage, PageImage } from '../../services/api';
import { Button } from '../ui/button';

type GlobalExclusionsPanelProps = {
  selectedPageId: number | null;
  previewImages?: string[];
  previewImageRows?: PageImage[];
  onChanged?: () => void | Promise<void>;
  showPreviewImageActions?: boolean;
};

function filenamePatternFromUrl(url: string): string {
  const clean = url.split('?', 1)[0].split('#', 1)[0];
  const filename = clean.split('/').pop() || clean;
  return filename.replace(/\.(jpe?g|png|webp|gif|avif)$/i, '');
}

export default function GlobalExclusionsPanel({
  selectedPageId,
  previewImages = [],
  previewImageRows = [],
  onChanged,
  showPreviewImageActions = false,
}: GlobalExclusionsPanelProps) {
  const [globalRules, setGlobalRules] = useState<GlobalExcludedImage[]>([]);
  const [excludedImages, setExcludedImages] = useState<PageImage[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    url_pattern: '',
    name_pattern: '',
    reason: 'other' as GlobalExcludedImage['reason'],
  });
  const [rulesMessage, setRulesMessage] = useState('');

  async function notifyChanged() {
    if (onChanged) await onChanged();
  }

  async function loadGlobalRules() {
    setRulesLoading(true);
    try {
      const response = await apiClient.listGlobalExclusions();
      setGlobalRules(response.data || []);
    } finally {
      setRulesLoading(false);
    }
  }

  async function loadExcludedImages(pageId: number | null) {
    if (!pageId) {
      setExcludedImages([]);
      return;
    }
    setImagesLoading(true);
    try {
      const response = await apiClient.getPageImages(pageId);
      const rows = (response.data || []).filter((img) => img.is_excluded || img.excluded_by_global_rule);
      setExcludedImages(rows);
    } finally {
      setImagesLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadGlobalRules(), loadExcludedImages(selectedPageId)]);
  }

  useEffect(() => {
    void loadGlobalRules();
  }, []);

  useEffect(() => {
    void loadExcludedImages(selectedPageId);
  }, [selectedPageId]);

  async function handleAddGlobalRule() {
    if (!ruleForm.url_pattern.trim() && !ruleForm.name_pattern.trim()) {
      setRulesMessage('Add URL pattern or name pattern.');
      return;
    }
    setRulesMessage('Saving global exclusion...');
    try {
      const created = await apiClient.createGlobalExclusion({
        url_pattern: ruleForm.url_pattern.trim() || undefined,
        name_pattern: ruleForm.name_pattern.trim() || undefined,
        reason: ruleForm.reason,
      });
      await apiClient.applyGlobalExclusion(created.data.id);
      await refreshAll();
      await notifyChanged();
      setRuleForm({ url_pattern: '', name_pattern: '', reason: 'other' });
      setRulesMessage('Global exclusion added and applied.');
    } catch (_error) {
      setRulesMessage('Failed to save global exclusion.');
    }
  }

  async function handleDeleteGlobalRule(ruleId: number) {
    setRulesMessage('Removing global exclusion...');
    try {
      await apiClient.deleteGlobalExclusion(ruleId);
      await refreshAll();
      await notifyChanged();
      setRulesMessage('Global exclusion removed.');
    } catch (_error) {
      setRulesMessage('Failed to remove global exclusion.');
    }
  }

  async function handleApplyRule(ruleId: number) {
    setRulesMessage('Applying global exclusion...');
    try {
      await apiClient.applyGlobalExclusion(ruleId);
      await loadExcludedImages(selectedPageId);
      await notifyChanged();
      setRulesMessage('Rule applied to existing images.');
    } catch (_error) {
      setRulesMessage('Failed to apply rule.');
    }
  }

  async function handleExcludePreviewImage(imageUrl: string) {
    const pattern = filenamePatternFromUrl(imageUrl);
    if (!pattern) return;
    setRulesMessage('Creating exclusion from image...');
    try {
      const created = await apiClient.createGlobalExclusion({
        name_pattern: pattern,
        reason: 'other',
      });
      await apiClient.applyGlobalExclusion(created.data.id);
      await refreshAll();
      await notifyChanged();
      setRulesMessage('Image exclusion added and applied.');
    } catch (_error) {
      setRulesMessage('Failed to exclude image.');
    }
  }

  const previewRows = previewImageRows.length > 0
    ? previewImageRows
    : previewImages.map((url, index) => ({
      id: -index - 1,
      page_id: selectedPageId ?? 0,
      url,
      is_excluded: false,
      width: null,
      height: null,
      file_size: null,
      mime_type: null,
      format: null,
      is_article_image: false,
      is_hq: false,
      category: 'other' as PageImage['category'],
      excluded_by_global_rule: false,
      created_at: '',
    }));

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium text-slate-700">Global Exclusions</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          value={ruleForm.url_pattern}
          onChange={(event) => setRuleForm((prev) => ({ ...prev, url_pattern: event.target.value }))}
          placeholder="URL pattern"
          className="h-9 rounded-md border border-slate-300 px-2 text-xs"
        />
        <input
          value={ruleForm.name_pattern}
          onChange={(event) => setRuleForm((prev) => ({ ...prev, name_pattern: event.target.value }))}
          placeholder="Name pattern"
          className="h-9 rounded-md border border-slate-300 px-2 text-xs"
        />
        <select
          value={ruleForm.reason}
          onChange={(event) => setRuleForm((prev) => ({ ...prev, reason: event.target.value as GlobalExcludedImage['reason'] }))}
          className="h-9 rounded-md border border-slate-300 px-2 text-xs"
        >
          <option value="other">other</option>
          <option value="affiliate">affiliate</option>
          <option value="logo">logo</option>
          <option value="tracking">tracking</option>
          <option value="icon">icon</option>
          <option value="ad">ad</option>
        </select>
      </div>
      <Button size="sm" variant="outline" onClick={() => void handleAddGlobalRule()}>
        Add Global Exclusion
      </Button>
      {rulesMessage && <div className="text-xs text-slate-600">{rulesMessage}</div>}

      {showPreviewImageActions && previewRows.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-700">Current Preview Images</div>
          <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-4">
            {previewRows.map((image) => (
              <div key={`${image.id}-${image.url}`} className="rounded-md border border-slate-200 p-1">
                <img src={apiClient.proxyImageUrl(image.url)} alt="" className="h-20 w-full rounded object-cover" />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-7 w-full text-[10px]"
                  onClick={() => void handleExcludePreviewImage(image.url)}
                >
                  Exclude globally
                </Button>
                <div className="mt-1 truncate text-[10px] text-slate-500">
                  {image.width || '?'}x{image.height || '?'} · {image.category}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-h-44 space-y-2 overflow-y-auto">
        {rulesLoading && <div className="text-xs text-slate-500">Loading rules...</div>}
        {!rulesLoading && globalRules.length === 0 && <div className="text-xs text-slate-500">No global exclusions yet.</div>}
        {globalRules.map((rule) => (
          <div key={rule.id} className="space-y-2 rounded-md border border-slate-200 p-2 text-xs">
            <div className="text-slate-700">
              <div><span className="font-medium">URL:</span> {rule.url_pattern || '-'}</div>
              <div><span className="font-medium">Name:</span> {rule.name_pattern || '-'}</div>
              <div><span className="font-medium">Reason:</span> {rule.reason}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleApplyRule(rule.id)}>Apply</Button>
              <Button size="sm" variant="outline" onClick={() => void handleDeleteGlobalRule(rule.id)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs font-medium text-slate-700">Excluded Images (Selected Page)</div>
      <div className="max-h-64 overflow-y-auto">
        {imagesLoading && <div className="text-xs text-slate-500">Loading excluded images...</div>}
        {!imagesLoading && excludedImages.length === 0 && <div className="text-xs text-slate-500">No excluded images for this page.</div>}
        {!imagesLoading && excludedImages.length > 0 && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {excludedImages.map((img) => (
              <div key={img.id} className="rounded-md border border-slate-200 p-1">
                <img src={apiClient.proxyImageUrl(img.url)} alt="" className="h-20 w-full rounded object-cover" />
                <div className="mt-1 text-[10px] text-slate-500">{img.excluded_by_global_rule ? 'Global rule' : 'Manually excluded'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
