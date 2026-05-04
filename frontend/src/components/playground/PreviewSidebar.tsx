import type { PlaygroundFontSet, PlaygroundTemplateItem } from '../../services/api';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';

type PreviewSidebarProps = {
  fontSets: PlaygroundFontSet[];
  activeFontSetId: string;
  onSelectFontSet: (id: string) => void;
  activeFontColor: string;
  onFontColorChange: (color: string) => void;
  templates: PlaygroundTemplateItem[];
  selectedTemplateIds: number[];
  activeTemplateId: number | null;
  onSelectTemplate: (id: number) => void;
  onToggleTemplateSelection: (id: number) => void;
  defaultTemplateId: number | null;
  onSetDefaultTemplate: (id: number) => void;
  titleScale: number;
  titlePaddingX: number;
  lineHeightMultiplier: number;
  onResetTextSettings?: () => void;
};

function TemplateMiniCard({
  template,
  active,
  onClick,
}: {
  template: PlaygroundTemplateItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border p-1 text-left ${active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <img src={template.thumbnail_url} alt={template.name} className="h-20 w-full rounded border border-slate-200 object-cover" />
      <div className="mt-1 truncate text-[10px] text-slate-700">{template.name}</div>
    </button>
  );
}

export default function PreviewSidebar({
  fontSets,
  activeFontSetId,
  onSelectFontSet,
  activeFontColor,
  onFontColorChange,
  templates,
  selectedTemplateIds,
  activeTemplateId,
  onSelectTemplate,
  onToggleTemplateSelection,
  defaultTemplateId,
  onSetDefaultTemplate,
  titleScale,
  titlePaddingX,
  lineHeightMultiplier,
  onResetTextSettings,
}: PreviewSidebarProps) {
  const quickTemplates = templates;
  const quickColors = ['#111827', '#1f2937', '#0f766e', '#0369a1', '#be123c', '#f97316', '#7c3aed', '#ffffff'];

  const normalizeHex = (value: string): string => {
    const raw = value.trim().toLowerCase();
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9a-f]{3}$/.test(withHash)) {
      return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`;
    }
    if (/^#[0-9a-f]{6}$/.test(withHash)) return withHash;
    return activeFontColor;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700">Custom Fonts</div>
        <select
          value={activeFontSetId}
          onChange={(event) => onSelectFontSet(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {fontSets.map((font) => (
            <option key={font.id} value={font.id}>{font.main}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700">Font Color</div>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center gap-2">
            <div
              className="h-10 w-10 rounded-md border border-slate-300"
              style={{ backgroundColor: activeFontColor }}
              aria-label="Selected font color preview"
              title={activeFontColor}
            />
            <Input
              value={activeFontColor}
              onChange={(event) => onFontColorChange(normalizeHex(event.target.value))}
              className="h-10"
              placeholder="#1a1a1a"
            />
            <label className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white text-[11px] text-slate-600 hover:bg-slate-100">
              Pick
              <input
                type="color"
                value={activeFontColor}
                onChange={(event) => onFontColorChange(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {quickColors.map((color) => (
              <button
                key={color}
                onClick={() => onFontColorChange(color)}
                className={`h-6 rounded-md border ${activeFontColor.toLowerCase() === color ? 'border-slate-800 ring-1 ring-slate-500' : 'border-slate-300'}`}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Set font color ${color}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">Templates</div>
          <Badge variant="secondary" className="text-[10px]">{selectedTemplateIds.length} selected</Badge>
        </div>
        <div className="grid max-h-[320px] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {quickTemplates.map((template) => (
            <div key={template.id} className="space-y-1">
              <TemplateMiniCard
                template={template}
                active={activeTemplateId === template.id}
                onClick={() => onSelectTemplate(template.id)}
              />
              <button
                onClick={() => onToggleTemplateSelection(template.id)}
                className={`w-full rounded border px-1 py-1 text-[10px] ${
                  selectedTemplateIds.includes(template.id)
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {selectedTemplateIds.includes(template.id) ? 'Selected' : 'Select'}
              </button>
              <button
                onClick={() => onSetDefaultTemplate(template.id)}
                className={`w-full rounded border px-1 py-1 text-[10px] ${defaultTemplateId === template.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {defaultTemplateId === template.id ? 'Default' : 'Set Default'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700">Title Controls</div>
          {onResetTextSettings && (
            <button
              type="button"
              onClick={onResetTextSettings}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Reset
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-600">Drag the labels on the canvas: Size / Padding / Spacing.</div>
        <div className="text-[10px] text-slate-500">
          {Math.round(titleScale * 100)}% · {Math.round(titlePaddingX)}px · {lineHeightMultiplier.toFixed(2)}x
        </div>
      </div>
    </div>
  );
}
