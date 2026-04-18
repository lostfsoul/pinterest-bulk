import { useState } from 'react';
import type { PlaygroundFontSet, PlaygroundPageItem, PlaygroundTemplateItem } from '../../services/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type {
  AdvancedSettingsState,
  AiSettingsState,
  DisplaySettingsState,
  ImageSettingsState,
} from './types';
import AiSettings from './AiSettings';
import FontPicker from './FontPicker';
import ImageSettings from './ImageSettings';
import SelectPage from './SelectPage';
import TemplateGrid from './TemplateGrid';

type LeftPanelProps = {
  pages: PlaygroundPageItem[];
  selectedPageUrl: string;
  onSelectPage: (url: string) => void;
  aiSettings: AiSettingsState;
  onAiSettingsChange: (next: AiSettingsState) => void;
  fontSets: PlaygroundFontSet[];
  selectedFontSetId: string;
  onSelectFontSet: (id: string) => void;
  templates: PlaygroundTemplateItem[];
  selectedTemplateIds: number[];
  activeTemplateId: number | null;
  selectedPage: PlaygroundPageItem | null;
  fontFamily: string;
  fontColor: string;
  onSelectTemplates: (ids: number[]) => void;
  onTemplateOpen: (templateId: number) => void;
  imageSettings: ImageSettingsState;
  displaySettings: DisplaySettingsState;
  advancedSettings: AdvancedSettingsState;
  onImageSettingsChange: (next: ImageSettingsState) => void;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  onAdvancedSettingsChange: (next: AdvancedSettingsState) => void;
  onDeleteTemplate: (templateId: number) => void;
  onRemoveImages: () => void;
  onScrapeResult: (payload: { images: string[]; title: string; description: string }) => void;
  onSaveDraft: () => void;
  saving: boolean;
  onUploadTemplate: (name: string, file: File) => Promise<void>;
  onUploadFont: (file: File, family?: string) => Promise<void>;
  uploadingTemplate: boolean;
  uploadingFont: boolean;
};

export default function LeftPanel({
  pages,
  selectedPageUrl,
  onSelectPage,
  aiSettings,
  onAiSettingsChange,
  fontSets,
  selectedFontSetId,
  onSelectFontSet,
  templates,
  selectedTemplateIds,
  activeTemplateId,
  selectedPage,
  fontFamily,
  fontColor,
  onSelectTemplates,
  onTemplateOpen,
  imageSettings,
  displaySettings,
  advancedSettings,
  onImageSettingsChange,
  onDisplaySettingsChange,
  onAdvancedSettingsChange,
  onDeleteTemplate,
  onRemoveImages,
  onScrapeResult,
  onSaveDraft,
  saving,
  onUploadTemplate,
  onUploadFont,
  uploadingTemplate,
  uploadingFont,
}: LeftPanelProps) {
  const [templateName, setTemplateName] = useState('');
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [uploadFontFamily, setUploadFontFamily] = useState('');
  const [fontFile, setFontFile] = useState<File | null>(null);

  async function handleTemplateUpload() {
    if (!templateName.trim() || !templateFile) return;
    await onUploadTemplate(templateName.trim(), templateFile);
    setTemplateName('');
    setTemplateFile(null);
  }

  async function handleFontUpload() {
    if (!fontFile) return;
    await onUploadFont(fontFile, uploadFontFamily.trim() || undefined);
    setUploadFontFamily('');
    setFontFile(null);
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto pr-1">
      <SelectPage
        pages={pages}
        selectedPageUrl={selectedPageUrl}
        onSelectPage={onSelectPage}
        onRemoveImages={onRemoveImages}
        onScrapeResult={onScrapeResult}
      />

      <AiSettings value={aiSettings} onChange={onAiSettingsChange} />

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Design Customization</h3>
          <p className="text-xs text-slate-500">Choose templates and fonts for your pins.</p>
        </div>

        <FontPicker
          fontSets={fontSets}
          selectedFontSetId={selectedFontSetId}
          onSelect={onSelectFontSet}
        />

        <TemplateGrid
          templates={templates}
          selectedTemplateIds={selectedTemplateIds}
          selectedPage={selectedPage}
          activeTemplateId={activeTemplateId}
          fontFamily={fontFamily}
          fontColor={fontColor}
          imageSettings={imageSettings}
          onSelectTemplates={onSelectTemplates}
          onTemplateOpen={onTemplateOpen}
          onDeleteTemplate={onDeleteTemplate}
        />

        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <h4 className="text-sm font-semibold text-slate-800">Upload Template / Font</h4>

          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <p className="text-xs font-medium text-slate-600">SVG Template</p>
            <Input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Template name"
            />
            <input
              type="file"
              accept=".svg"
              onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
              className="w-full text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleTemplateUpload()}
              disabled={!templateName.trim() || !templateFile || uploadingTemplate}
            >
              {uploadingTemplate ? 'Uploading...' : 'Upload Template'}
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <p className="text-xs font-medium text-slate-600">Custom Font</p>
            <Input
              value={uploadFontFamily}
              onChange={(event) => setUploadFontFamily(event.target.value)}
              placeholder="Font family (optional)"
            />
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              onChange={(event) => setFontFile(event.target.files?.[0] || null)}
              className="w-full text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleFontUpload()}
              disabled={!fontFile || uploadingFont}
            >
              {uploadingFont ? 'Uploading...' : 'Upload Font'}
            </Button>
          </div>
        </div>

        <ImageSettings
          selectedPageId={selectedPage?.id ?? null}
          imageSettings={imageSettings}
          displaySettings={displaySettings}
          advancedSettings={advancedSettings}
          onImageSettingsChange={onImageSettingsChange}
          onDisplaySettingsChange={onDisplaySettingsChange}
          onAdvancedSettingsChange={onAdvancedSettingsChange}
        />

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Playground is for quick visual testing. Use Workflow for bulk generation.
        </div>
      </section>

      <Button onClick={onSaveDraft} disabled={saving}>
        {saving ? 'Saving Draft...' : 'Save Draft Settings'}
      </Button>
    </div>
  );
}
