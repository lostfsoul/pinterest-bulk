import { useEffect, useState } from 'react';
import apiClient, { AIPromptPreset, PlaceholderInfo } from '../services/api';
import type { AISettings } from '../services/api';
import { Button } from '../components/Button';
import { PlaceholderButtons } from '../components/PlaceholderButtons';

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian',
  'Dutch', 'Polish', 'Japanese', 'Korean', 'Chinese', 'Arabic', 'Hindi'
];

const TARGET_FIELD_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'board', label: 'Board Name' },
];

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast, Cost-effective)' },
  { value: 'gpt-4o', label: 'GPT-4o (Higher Quality)' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Legacy)' },
];

interface PresetFormData {
  name: string;
  target_field: 'title' | 'description' | 'board';
  prompt_template: string;
  model: string;
  temperature: number;
  max_tokens: number | null;
  language: string;
  is_default: boolean;
}

const defaultFormData: PresetFormData = {
  name: '',
  target_field: 'title',
  prompt_template: '',
  model: 'gpt-4o-mini',
  temperature: 0.4,
  max_tokens: null,
  language: 'English',
  is_default: false,
};

export default function AISettings() {
  const [presets, setPresets] = useState<AIPromptPreset[]>([]);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [placeholderInfo, setPlaceholderInfo] = useState<PlaceholderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingPreset, setEditingPreset] = useState<AIPromptPreset | null>(null);
  const [formData, setFormData] = useState<PresetFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterTarget, setFilterTarget] = useState<string>('');

  useEffect(() => {
    loadData().catch(console.error);
  }, []);

  async function loadData() {
    try {
      const [presetsRes, settingsRes, placeholdersRes] = await Promise.all([
        apiClient.listAIPresets(),
        apiClient.getAISettings(),
        apiClient.getPlaceholderInfo(),
      ]);
      setPresets(presetsRes.data);
      setSettings(settingsRes.data);
      setPlaceholderInfo(placeholdersRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingPreset) {
        await apiClient.updateAIPreset(editingPreset.id, formData);
      } else {
        await apiClient.createAIPreset(formData);
      }
      // Reload presets list only (ignore placeholders/settings errors)
      try {
        const presetsRes = await apiClient.listAIPresets();
        setPresets(presetsRes.data);
      } catch (err) {
        console.error('Failed to reload presets:', err);
      }
      resetForm();
    } catch (error) {
      console.error('Failed to save preset:', error);
      alert('Failed to save preset');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this preset?')) return;
    try {
      await apiClient.deleteAIPreset(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete preset:', error);
      alert('Failed to delete preset');
    }
  }

  async function handleSetDefault(id: number) {
    try {
      await apiClient.setDefaultAIPreset(id);
      await loadData();
    } catch (error) {
      console.error('Failed to set default:', error);
      alert('Failed to set default preset');
    }
  }

  async function handleUpdateSettings(field: string, value: unknown) {
    if (!settings) return;
    try {
      const update: Record<string, unknown> = { [field]: value };
      const res = await apiClient.updateAISettings(update);
      setSettings(res.data);
    } catch (error) {
      console.error('Failed to update settings:', error);
      alert('Failed to update settings');
    }
  }

  function startEdit(preset: AIPromptPreset) {
    setEditingPreset(preset);
    setFormData({
      name: preset.name,
      target_field: preset.target_field,
      prompt_template: preset.prompt_template,
      model: preset.model,
      temperature: preset.temperature,
      max_tokens: preset.max_tokens,
      language: preset.language,
      is_default: preset.is_default,
    });
    setShowForm(true);
  }

  function resetForm() {
    setEditingPreset(null);
    setFormData(defaultFormData);
    setShowForm(false);
  }

  function insertPlaceholder(placeholder: string) {
    setFormData(prev => ({
      ...prev,
      prompt_template: prev.prompt_template + `{{ ${placeholder} }}`,
    }));
  }

  const filteredPresets = filterTarget
    ? presets.filter(p => p.target_field === filterTarget)
    : presets;

  const presetsByTarget = {
    title: presets.filter(p => p.target_field === 'title'),
    description: presets.filter(p => p.target_field === 'description'),
    board: presets.filter(p => p.target_field === 'board'),
  };

  if (loading) {
    return <div className="text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
        <p className="text-gray-500 mt-1">Manage AI prompt presets for generating titles, descriptions, and board names</p>
      </div>

      {/* Global Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Global Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Language</label>
            <select
              value={settings?.default_language || 'English'}
              onChange={(e) => handleUpdateSettings('default_language', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              {LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center pt-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.use_ai_by_default ?? true}
                onChange={(e) => handleUpdateSettings('use_ai_by_default', e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-gray-700">Use AI by default</span>
            </label>
          </div>
        </div>
      </div>

      {/* Default Presets */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Default Presets</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title Preset</label>
            <select
              value={settings?.default_title_preset_id || ''}
              onChange={(e) => handleUpdateSettings('default_title_preset_id', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Use Default (No AI)</option>
              {presetsByTarget.title.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.is_default ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description Preset</label>
            <select
              value={settings?.default_description_preset_id || ''}
              onChange={(e) => handleUpdateSettings('default_description_preset_id', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Use Default (Fallback)</option>
              {presetsByTarget.description.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.is_default ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Board Preset</label>
            <select
              value={settings?.default_board_preset_id || ''}
              onChange={(e) => handleUpdateSettings('default_board_preset_id', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Use Default (Manual Entry)</option>
              {presetsByTarget.board.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.is_default ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Preset List */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-gray-900">Prompt Presets</h2>
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            Add New Preset
          </Button>
        </div>

        {/* Filter */}
        <div className="mb-4">
          <select
            value={filterTarget}
            onChange={(e) => setFilterTarget(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All Presets</option>
            <option value="title">Title Presets</option>
            <option value="description">Description Presets</option>
            <option value="board">Board Presets</option>
          </select>
        </div>

        {filteredPresets.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No presets yet. Create your first preset to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPresets.map(preset => (
              <div key={preset.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{preset.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        preset.target_field === 'title' ? 'bg-blue-100 text-blue-700' :
                        preset.target_field === 'description' ? 'bg-green-100 text-green-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {preset.target_field}
                      </span>
                      {preset.is_default && (
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">Default</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{preset.prompt_template}</p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>Model: {preset.model}</span>
                      <span>Temp: {preset.temperature}</span>
                      <span>Lang: {preset.language}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!preset.is_default && (
                      <Button variant="secondary" size="sm" onClick={() => handleSetDefault(preset.id)}>
                        Set Default
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => startEdit(preset)}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(preset.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preset Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingPreset ? 'Edit Preset' : 'Create New Preset'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preset Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="e.g., SEO Title Generator"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Field</label>
                <select
                  value={formData.target_field}
                  onChange={(e) => setFormData(prev => ({ ...prev, target_field: e.target.value as 'title' | 'description' | 'board' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {TARGET_FIELD_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Template</label>
                <PlaceholderButtons
                  onInsert={insertPlaceholder}
                  placeholders={placeholderInfo?.placeholders || []}
                />
                <textarea
                  value={formData.prompt_template}
                  onChange={(e) => setFormData(prev => ({ ...prev, prompt_template: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md h-48 font-mono text-sm"
                  placeholder="You are a Pinterest SEO expert. Write 5 distinct pin titles in {language}...."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                  <select
                    value={formData.model}
                    onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                  <select
                    value={formData.language}
                    onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {LANGUAGES.map(lang => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Temperature: {formData.temperature}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={formData.temperature}
                    onChange={(e) => setFormData(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">Lower = more focused, Higher = more creative</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens (0 = unlimited)</label>
                  <input
                    type="number"
                    min="0"
                    max="4000"
                    value={formData.max_tokens || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, max_tokens: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={formData.is_default}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))}
                  className="h-4 w-4"
                />
                <label htmlFor="is_default" className="text-sm font-medium text-gray-700">
                  Set as default for {formData.target_field}
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Preset'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}