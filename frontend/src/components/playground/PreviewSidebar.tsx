import { Trash2 } from 'lucide-react';
import type { PlaygroundFontSet, PlaygroundTemplateItem } from '../../services/api';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import type { ImageSettingsState } from './types';
import SvgRenderer from './SvgRenderer';

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
  onDeleteTemplate?: (id: number) => void;
  titleScale: number;
  titlePaddingX: number;
  lineHeightMultiplier: number;
  onResetTextSettings?: () => void;
  previewImages?: string[];
  previewTitle?: string;
  activeFontFamily?: string;
  activeFontFile?: string | null;
  imageSettings?: ImageSettingsState;
};

const SAMPLE_TEMPLATE_IMAGES = [
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%23f59e0b"/%3E%3Cstop offset="1" stop-color="%23dc2626"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="900" height="1200" fill="url(%23g)"/%3E%3Ccircle cx="700" cy="240" r="180" fill="%23fff7ed" opacity=".35"/%3E%3Ccircle cx="230" cy="760" r="260" fill="%23ffffff" opacity=".22"/%3E%3C/svg%3E',
];

function TemplateMiniCard({
  template,
  active,
  onClick,
  pageImages,
  title,
  fontFamily,
  fontSetId,
  fontFile,
  textColor,
  imageSettings,
}: {
  template: PlaygroundTemplateItem;
  active: boolean;
  onClick: () => void;
  pageImages: string[];
  title: string;
  fontFamily: string;
  fontSetId: string;
  fontFile?: string | null;
  textColor: string;
  imageSettings?: ImageSettingsState;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border p-1 text-left ${active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="h-16 overflow-hidden rounded border border-slate-200 bg-slate-100">
        <SvgRenderer
          templatePath={template.path}
          pageImages={pageImages.length > 0 ? pageImages : SAMPLE_TEMPLATE_IMAGES}
          title={title}
          fontFamily={fontFamily}
          fontSetId={fontSetId}
          fontFile={fontFile}
          textColor={textColor}
          imageSettings={imageSettings}
          zoom={0.6}
          className="w-[135px]"
        />
      </div>
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
  onDeleteTemplate,
  titleScale,
  titlePaddingX,
  lineHeightMultiplier,
  onResetTextSettings,
  previewImages = [],
  previewTitle = 'Sample Pin Title',
  activeFontFamily,
  activeFontFile,
  imageSettings,
}: PreviewSidebarProps) {
  const quickTemplates = templates;
  const quickColors = ['#111827', '#1f2937', '#0f766e', '#0369a1', '#be123c', '#f97316', '#7c3aed', '#ffffff'];
  const rendererFontFamily = activeFontFamily || 'Bebas Neue';

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
        <div className="grid max-h-[260px] grid-cols-2 gap-1.5 overflow-y-auto pr-1">
          {quickTemplates.map((template) => (
            <div key={template.id} className="space-y-1 rounded-md border border-slate-100 p-1">
              <div className="relative">
                <TemplateMiniCard
                  template={template}
                  active={activeTemplateId === template.id}
                  onClick={() => onSelectTemplate(template.id)}
                  pageImages={previewImages}
                  title={previewTitle}
                  fontFamily={rendererFontFamily}
                  fontSetId={activeFontSetId}
                  fontFile={activeFontFile}
                  textColor={activeFontColor}
                  imageSettings={imageSettings}
                />
                {onDeleteTemplate && (
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded border border-red-200 bg-white/95 p-1 text-red-600 shadow hover:bg-red-50"
                    title={`Delete template ${template.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteTemplate(template.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
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
