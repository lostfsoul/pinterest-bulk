import { Badge } from '../ui/badge';
import type { PlaygroundFontSet } from '../../services/api';

type FontPickerProps = {
  fontSets: PlaygroundFontSet[];
  selectedFontSetId: string;
  onSelect: (fontSetId: string) => void;
};

export default function FontPicker({ fontSets, selectedFontSetId, onSelect }: FontPickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Choose Fonts</h4>
        <Badge variant="secondary">{fontSets.length}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {fontSets.map((font) => {
          const isSelected = selectedFontSetId === font.id;
          return (
            <button
              key={font.id}
              onClick={() => onSelect(font.id)}
              className={`rounded-md border p-3 text-left ${isSelected ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div style={{ fontFamily: font.main }} className="text-sm font-semibold text-slate-900">{font.main}</div>
              <div style={{ fontFamily: font.secondary }} className="text-xs text-slate-600">{font.secondary}</div>
              <div style={{ fontFamily: font.accent }} className="text-xs italic text-slate-500">{font.accent}</div>
            </button>
          );
        })}
      </div>
      <button className="text-xs text-blue-600 hover:underline">Or use custom font upload settings</button>
    </div>
  );
}
