import { useState } from 'react';
import { Button } from '../ui/button';
import GlobalExclusionsPanel from '../shared/GlobalExclusionsPanel';
import type { AdvancedSettingsState, DisplaySettingsState, ImageSettingsState, Orientation } from './types';

type ImageSettingsProps = {
  selectedPageId: number | null;
  imageSettings: ImageSettingsState;
  displaySettings: DisplaySettingsState;
  advancedSettings: AdvancedSettingsState;
  onImageSettingsChange: (next: ImageSettingsState) => void;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  onAdvancedSettingsChange: (next: AdvancedSettingsState) => void;
};

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <span>{label}</span>
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default function ImageSettings({
  selectedPageId,
  imageSettings,
  displaySettings,
  advancedSettings,
  onImageSettingsChange,
  onDisplaySettingsChange,
  onAdvancedSettingsChange,
}: ImageSettingsProps) {
  const [showImage, setShowImage] = useState(true);
  const [showDisplay, setShowDisplay] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [showDisabledImages, setShowDisabledImages] = useState(false);

  function toggleOrientation(orientation: Orientation) {
    if (imageSettings.allowedOrientations.includes(orientation)) {
      onImageSettingsChange({
        ...imageSettings,
        allowedOrientations: imageSettings.allowedOrientations.filter((value) => value !== orientation),
      });
      return;
    }
    onImageSettingsChange({
      ...imageSettings,
      allowedOrientations: [...imageSettings.allowedOrientations, orientation],
    });
  }

  return (
    <div className="space-y-3">
      <button
        className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800"
        onClick={() => setShowImage((prev) => !prev)}
      >
        Image Settings {showImage ? '▾' : '▸'}
      </button>
      {showImage && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span>Don&apos;t like website images? Use custom images.</span>
            <Button size="sm" variant="outline" disabled>Add Custom Images</Button>
          </div>

          <ToggleRow label="Fetch images from page by default" checked={imageSettings.fetchFromPage} onChange={(checked) => onImageSettingsChange({ ...imageSettings, fetchFromPage: checked })} />
          <ToggleRow label="Use hidden images" checked={imageSettings.useHiddenImages} onChange={(checked) => onImageSettingsChange({ ...imageSettings, useHiddenImages: checked })} />

          <div className="grid grid-cols-[1fr_88px] gap-2">
            <ToggleRow label="Ignore small-width images" checked={imageSettings.ignoreSmallWidth} onChange={(checked) => onImageSettingsChange({ ...imageSettings, ignoreSmallWidth: checked })} />
            <input
              type="number"
              value={imageSettings.minWidth}
              onChange={(event) => onImageSettingsChange({ ...imageSettings, minWidth: Number(event.target.value) })}
              className="rounded-md border border-slate-300 px-2 text-sm"
            />
          </div>

          <ToggleRow label="Ignore small-height images" checked={imageSettings.ignoreSmallHeight} onChange={(checked) => onImageSettingsChange({ ...imageSettings, ignoreSmallHeight: checked })} />
          <ToggleRow label="Limit images per page" checked={imageSettings.limitImagesPerPage} onChange={(checked) => onImageSettingsChange({ ...imageSettings, limitImagesPerPage: checked })} />

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-600">Allowed Image Orientations</div>
            <div className="flex gap-1">
              {(['portrait', 'square', 'landscape'] as Orientation[]).map((orientation) => (
                <button
                  key={orientation}
                  onClick={() => toggleOrientation(orientation)}
                  className={`rounded border px-2 py-1 text-xs ${imageSettings.allowedOrientations.includes(orientation) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {orientation}
                </button>
              ))}
            </div>
          </div>

          <ToggleRow label="Use featured image" checked={imageSettings.useFeaturedImage} onChange={(checked) => onImageSettingsChange({ ...imageSettings, useFeaturedImage: checked })} />
          <ToggleRow label="Use same image only once for image-only pins" checked={imageSettings.uniqueImagePerPin} onChange={(checked) => onImageSettingsChange({ ...imageSettings, uniqueImagePerPin: checked })} />
          <ToggleRow label="Ignore images with text overlay" checked={imageSettings.ignoreImagesWithTextOverlay} onChange={(checked) => onImageSettingsChange({ ...imageSettings, ignoreImagesWithTextOverlay: checked })} />
          <ToggleRow label="Avoid duplicate content" checked={imageSettings.noDuplicateContent} onChange={(checked) => onImageSettingsChange({ ...imageSettings, noDuplicateContent: checked })} />
        </div>
      )}

      <button className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800" onClick={() => setShowDisplay((prev) => !prev)}>
        Display Settings {showDisplay ? '▾' : '▸'}
      </button>
      {showDisplay && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <ToggleRow
            label="Show full image in pins"
            checked={displaySettings.showFullImage}
            onChange={(checked) => onDisplaySettingsChange({ showFullImage: checked })}
          />
        </div>
      )}

      <button className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800" onClick={() => setShowDisabledImages((prev) => !prev)}>
        Disabled Images {showDisabledImages ? '▾' : '▸'}
      </button>
      {showDisabledImages && (
        <GlobalExclusionsPanel selectedPageId={selectedPageId} />
      )}

      <button className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800" onClick={() => setShowAdvanced((prev) => !prev)}>
        Advanced Settings {showAdvanced ? '▾' : '▸'}
      </button>
      {showAdvanced && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <ToggleRow
            label="Enable Image Validation"
            checked={advancedSettings.enableImageValidation}
            onChange={(checked) => onAdvancedSettingsChange({ enableImageValidation: checked })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Disabling validation makes preview faster but may include broken images.
          </p>
        </div>
      )}
    </div>
  );
}
