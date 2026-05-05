import { Download, Shuffle, Upload, X } from 'lucide-react';
import type { PlaygroundFontSet, PlaygroundPageItem, PlaygroundPreviewMeta, PlaygroundTemplateItem } from '../../services/api';
import { Button } from '../ui/button';
import type { ImageSettingsState, ZoomLevel } from './types';
import SvgRenderer from './SvgRenderer';
import PreviewSidebar from './PreviewSidebar';
import PinMetadata from './PinMetadata';

type RightPanelProps = {
  open: boolean;
  onClose: () => void;
  selectedPage: PlaygroundPageItem | null;
  activeTemplate: PlaygroundTemplateItem | null;
  templates: PlaygroundTemplateItem[];
  selectedTemplateIds: number[];
  fontSets: PlaygroundFontSet[];
  activeFontSetId: string;
  onSelectFontSet: (id: string) => void;
  activeFontColor: string;
  onFontColorChange: (color: string) => void;
  defaultTemplateId: number | null;
  onSetDefaultTemplate: (id: number) => void;
  titleScale: number;
  onTitleScaleChange: (value: number) => void;
  titlePaddingX: number;
  onTitlePaddingXChange: (value: number) => void;
  lineHeightMultiplier: number;
  onLineHeightMultiplierChange: (value: number) => void;
  onResetTextSettings: () => void;
  metadata: PlaygroundPreviewMeta | null;
  loading: boolean;
  zoom: ZoomLevel;
  onZoomChange: (zoom: ZoomLevel) => void;
  variantIndex: number;
  variantTotal: number;
  onPrevVariant: () => void;
  onNextVariant: () => void;
  onRandomize: () => void;
  onClearChanges: () => void;
  onSelectTemplate: (id: number) => void;
  onToggleTemplateSelection: (id: number) => void;
  onDeleteTemplate?: (id: number) => void;
  scheduledDate: string | null;
  onChangeDate: (value: string | null) => void;
  activeFontFamily: string;
  activeFontFile?: string | null;
  pageImages: string[];
  scrapedTitle: string;
  imageSettings: ImageSettingsState;
  onGenerateAiContent: () => void;
  generatingAi: boolean;
};

export default function RightPanel({
  open,
  onClose,
  selectedPage,
  activeTemplate,
  templates,
  selectedTemplateIds,
  fontSets,
  activeFontSetId,
  onSelectFontSet,
  activeFontColor,
  onFontColorChange,
  defaultTemplateId,
  onSetDefaultTemplate,
  titleScale,
  onTitleScaleChange,
  titlePaddingX,
  onTitlePaddingXChange,
  lineHeightMultiplier,
  onLineHeightMultiplierChange,
  onResetTextSettings,
  metadata,
  loading,
  zoom,
  onZoomChange,
  variantIndex,
  variantTotal,
  onPrevVariant,
  onNextVariant,
  onRandomize,
  onClearChanges,
  onSelectTemplate,
  onToggleTemplateSelection,
  onDeleteTemplate,
  scheduledDate,
  onChangeDate,
  activeFontFamily,
  activeFontFile,
  pageImages,
  scrapedTitle,
  imageSettings,
  onGenerateAiContent,
  generatingAi,
}: RightPanelProps) {
  if (!open) return null;

  const previewTitle = metadata?.title || scrapedTitle || selectedPage?.title || 'Sample Pin Title';
  const previewImage = metadata?.image_url || selectedPage?.images?.[0] || '';
  const rendererImages = pageImages.length > 0 ? pageImages : (previewImage ? [previewImage] : []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-3">
      <aside className="max-h-[94vh] w-full max-w-[1440px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRandomize}>
                <Shuffle className="h-4 w-4" />
                Randomize Images
              </Button>
              <Button
                size="sm"
                onClick={onGenerateAiContent}
                disabled={generatingAi}
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {generatingAi ? 'Generating AI...' : 'Generate AI Content'}
              </Button>
              <Button variant="outline" size="icon" title="Download" disabled>
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="Upload" disabled>
                <Upload className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={onClearChanges}>Clear Changes</Button>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onPrevVariant}>‹</Button>
            <button className={`rounded-md px-3 py-1.5 text-xs ${zoom === 0.6 ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}`} onClick={() => onZoomChange(0.6)}>0.6x</button>
            <button className={`rounded-md px-3 py-1.5 text-xs ${zoom === 0.8 ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}`} onClick={() => onZoomChange(0.8)}>0.8x</button>
            <button className={`rounded-md px-3 py-1.5 text-xs ${zoom === 1 ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}`} onClick={() => onZoomChange(1)}>1x</button>
            <Button variant="outline" size="sm" onClick={onNextVariant}>›</Button>
            <span className="text-xs text-slate-500">Variant {Math.min(variantTotal, variantIndex + 1)} / {variantTotal}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="rounded-lg border border-slate-200 bg-slate-950 p-3 text-white">
              <div className="mx-auto w-full max-w-[520px]">
                <div className="min-h-[620px] overflow-auto rounded-md border border-white/20 bg-black/60 p-2">
                  {activeTemplate ? (
                    <SvgRenderer
                      templatePath={activeTemplate.path}
                      pageImages={rendererImages}
                      title={previewTitle}
                      fontFamily={activeFontFamily}
                      fontSetId={activeFontSetId}
                      fontFile={activeFontFile}
                      textColor={activeFontColor}
                      titleScale={titleScale}
                      titlePaddingX={titlePaddingX}
                      lineHeightMultiplier={lineHeightMultiplier}
                      onTitleScaleChange={onTitleScaleChange}
                      onTitlePaddingXChange={onTitlePaddingXChange}
                      onLineHeightMultiplierChange={onLineHeightMultiplierChange}
                      showDragControls
                      imageSettings={imageSettings}
                      zoom={zoom}
                      className="w-full"
                    />
                  ) : (
                    <div className="p-4 text-xs text-slate-300">Select a template to preview.</div>
                  )}
                </div>
                <Button variant="outline" size="sm" className="mt-2 border-white/30 bg-white/10 text-white hover:bg-white/20">
                  Show Block Styles (1)
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <PreviewSidebar
                fontSets={fontSets}
                activeFontSetId={activeFontSetId}
                onSelectFontSet={onSelectFontSet}
                activeFontColor={activeFontColor}
                onFontColorChange={onFontColorChange}
                templates={templates}
                selectedTemplateIds={selectedTemplateIds}
                activeTemplateId={activeTemplate?.id ?? null}
                onSelectTemplate={onSelectTemplate}
                onToggleTemplateSelection={onToggleTemplateSelection}
                defaultTemplateId={defaultTemplateId}
                onSetDefaultTemplate={onSetDefaultTemplate}
                onDeleteTemplate={onDeleteTemplate}
                titleScale={titleScale}
                titlePaddingX={titlePaddingX}
                lineHeightMultiplier={lineHeightMultiplier}
                onResetTextSettings={onResetTextSettings}
                previewImages={rendererImages}
                previewTitle={previewTitle}
                activeFontFamily={activeFontFamily}
                activeFontFile={activeFontFile}
                imageSettings={imageSettings}
              />
            </div>
          </div>

          {loading && <div className="text-xs text-slate-500">Loading preview metadata...</div>}
          <PinMetadata
            metadata={metadata}
            images={rendererImages}
            scheduledDate={scheduledDate}
            onChangeDate={onChangeDate}
          />
        </div>
      </aside>
    </div>
  );
}
