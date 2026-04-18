import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { PlaygroundPageItem, PlaygroundTemplateItem } from '../../services/api';
import type { ImageSettingsState } from './types';
import SvgRenderer from './SvgRenderer';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

type TemplateGridProps = {
  templates: PlaygroundTemplateItem[];
  selectedTemplateIds: number[];
  selectedPage: PlaygroundPageItem | null;
  activeTemplateId: number | null;
  fontFamily: string;
  fontColor: string;
  imageSettings: ImageSettingsState;
  onSelectTemplates: (ids: number[]) => void;
  onTemplateOpen: (templateId: number) => void;
  onDeleteTemplate: (templateId: number) => void;
};

export default function TemplateGrid({
  templates,
  selectedTemplateIds,
  selectedPage,
  activeTemplateId,
  fontFamily,
  fontColor,
  imageSettings,
  onSelectTemplates,
  onTemplateOpen,
  onDeleteTemplate,
}: TemplateGridProps) {
  const [mode, setMode] = useState<'all' | 'selected'>('all');

  const grouped = useMemo(() => {
    const base = mode === 'selected'
      ? templates.filter((template) => selectedTemplateIds.includes(template.id))
      : templates;
    const byKey: Record<string, PlaygroundTemplateItem[]> = { '1': [], '2': [], '6': [], other: [] };
    for (const template of base) {
      const key = String(template.image_count);
      if (key in byKey) byKey[key].push(template);
      else byKey.other.push(template);
    }
    return byKey;
  }, [mode, selectedTemplateIds, templates]);

  function toggleTemplate(id: number) {
    if (selectedTemplateIds.includes(id)) {
      onSelectTemplates(selectedTemplateIds.filter((value) => value !== id));
      return;
    }
    onSelectTemplates([...selectedTemplateIds, id]);
  }

  const placeholderImage = selectedPage?.images?.[0] || '';
  const placeholderTitle = selectedPage?.title || 'Sample Pin Title';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Choose Templates To Use</h4>
        <Button size="sm" variant="outline" onClick={() => onSelectTemplates([])}>Clear All</Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-300 p-0.5">
          <button
            className={`rounded px-3 py-1 text-xs ${mode === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setMode('all')}
          >
            All Templates
          </button>
          <button
            className={`rounded px-3 py-1 text-xs ${mode === 'selected' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setMode('selected')}
          >
            Selected Only ({selectedTemplateIds.length})
          </button>
        </div>
        <Button size="sm" variant="outline" disabled>Import From Canva</Button>
      </div>

      {([
        ['1', '1 Image'],
        ['2', '2 Images'],
        ['6', '6 Images'],
        ['other', 'Other'],
      ] as Array<[string, string]>).map(([key, label]) => {
        const items = grouped[key] || [];
        if (items.length === 0) return null;
        return (
          <div key={key} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {items.map((template) => {
                const isSelected = selectedTemplateIds.includes(template.id);
                const isActive = activeTemplateId === template.id;
                return (
                  <div
                    key={template.id}
                    className={`space-y-2 rounded-lg border p-2 ${isActive ? 'border-blue-500 ring-1 ring-blue-500' : isSelected ? 'border-slate-300' : 'border-slate-200'}`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px]">High</Badge>
                      <button
                        type="button"
                        className="rounded border border-slate-300 p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Delete template"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteTemplate(template.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        toggleTemplate(template.id);
                        onTemplateOpen(template.id);
                      }}
                      className="block w-full text-left"
                    >
                      <div className="h-[180px] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <SvgRenderer
                          key={`${template.id}`}
                          templatePath={template.path}
                          pageImages={placeholderImage ? [placeholderImage] : []}
                          title={placeholderTitle}
                          fontFamily={fontFamily}
                          textColor={fontColor}
                          imageSettings={imageSettings}
                          zoom={1}
                          className="w-[380px]"
                        />
                      </div>
                    </button>

                    <div className="truncate text-[11px] text-slate-700">{template.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
