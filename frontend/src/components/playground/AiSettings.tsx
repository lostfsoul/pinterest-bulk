import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import type { AiSettingsState, PromptStyle } from './types';

type AiSettingsProps = {
  value: AiSettingsState;
  onChange: (next: AiSettingsState) => void;
};

const styles: Array<{ id: PromptStyle; label: string; prompt: string }> = [
  {
    id: 'engaging',
    label: 'Engaging',
    prompt: 'Create emotionally compelling Pinterest copy with a strong hook and save-worthy wording.',
  },
  {
    id: 'informative',
    label: 'Informative',
    prompt: 'Generate clear and useful Pinterest title and description focused on practical value.',
  },
  {
    id: 'question',
    label: 'Question-Based',
    prompt: 'Create a curiosity-driven question title and an answer-oriented description.',
  },
  {
    id: 'listicle',
    label: 'Listicle Style',
    prompt: 'Generate list-style Pinterest copy with numbered or scannable benefit-focused phrasing.',
  },
  {
    id: 'ecommerce',
    label: 'E-commerce Product',
    prompt: 'Write conversion-focused Pinterest copy emphasizing product benefits and intent to buy.',
  },
];

const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Hindi', 'Japanese'];

export default function AiSettings({ value, onChange }: AiSettingsProps) {
  const activeStyle = styles.find((style) => style.id === value.promptStyle) || styles[1];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">AI Content Generation</h3>
        <p className="text-xs text-slate-500">Customize how AI generates pin titles and descriptions.</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={value.promptEnabled}
          onChange={(event) => onChange({ ...value, promptEnabled: event.target.checked })}
        />
        Use prompt guidance for title + description generation.
      </label>

      <div className="flex flex-wrap gap-2">
        {styles.map((style) => (
          <button
            key={style.id}
            onClick={() => onChange({ ...value, promptStyle: style.id, customPrompt: style.prompt })}
            className={`rounded-md border px-3 py-1.5 text-xs transition ${value.promptStyle === style.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {style.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Badge variant="secondary" className="mr-2">{activeStyle.label}</Badge>
        {activeStyle.prompt}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Custom Prompt</label>
          <Textarea
            value={value.customPrompt}
            onChange={(event) => onChange({ ...value, customPrompt: event.target.value })}
            placeholder="Enter your custom AI prompt here..."
            className="min-h-[90px]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Language</label>
          <select
            value={value.language}
            onChange={(event) => onChange({ ...value, language: event.target.value })}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            {languages.map((language) => (
              <option key={language} value={language}>{language}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
