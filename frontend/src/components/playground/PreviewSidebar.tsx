import type { PlaygroundFontSet, PlaygroundTemplateItem } from '../../services/api';
import { Badge } from '../ui/badge';

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
  defaultTemplateId: number | null;
  onSetDefaultTemplate: (id: number) => void;
  titleScale: number;
  onTitleScaleChange: (value: number) => void;
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
  defaultTemplateId,
  onSetDefaultTemplate,
  titleScale,
  onTitleScaleChange,
}: PreviewSidebarProps) {
  const quickTemplates = templates.filter((template) => selectedTemplateIds.includes(template.id));

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
        <input
          type="color"
          value={activeFontColor}
          onChange={(event) => onFontColorChange(event.target.value)}
          className="h-12 w-12 rounded-full border border-slate-200"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">Templates</div>
          <Badge variant="secondary" className="text-[10px]">{quickTemplates.length}</Badge>
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
                onClick={() => onSetDefaultTemplate(template.id)}
                className={`w-full rounded border px-1 py-1 text-[10px] ${defaultTemplateId === template.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {defaultTemplateId === template.id ? 'Default' : 'Set Default'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700">Title Size</div>
        <input
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={titleScale}
          onChange={(event) => onTitleScaleChange(Number(event.target.value))}
          className="w-full"
        />
        <div className="text-[10px] text-slate-500">{Math.round(titleScale * 100)}%</div>
      </div>
    </div>
  );
}
