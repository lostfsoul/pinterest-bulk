import type { PlaygroundPreviewMeta } from '../../services/api';

type PinMetadataProps = {
  metadata: PlaygroundPreviewMeta | null;
  images: string[];
  scheduledDate: string | null;
  onChangeDate: (value: string | null) => void;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap">
        {value || '—'}
      </div>
    </div>
  );
}

export default function PinMetadata({ metadata, images, scheduledDate, onChangeDate }: PinMetadataProps) {
  void onChangeDate;
  const visibleImages = images.length > 0 ? images : (metadata?.image_url ? [metadata.image_url] : []);
  return (
    <div className="space-y-3">
      <Row label="Pinterest Title" value={metadata?.title || ''} />
      <Row label="Image Title" value={metadata?.image_title || ''} />
      <Row label="Description" value={metadata?.description || ''} />
      <Row label="Alt Text" value={metadata?.alt_text || ''} />
      <Row label="Outbound URL" value={metadata?.outbound_url || ''} />
      <Row label="Board to Pin" value={metadata?.board || ''} />
      <Row label="Date To Publish" value={scheduledDate || 'Not scheduled'} />
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-slate-600">Images</div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          {visibleImages.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {visibleImages.map((image, index) => (
                <div key={`${image}-${index}`} className="space-y-1">
                  <img src={image} alt="" className="h-16 w-full rounded border border-slate-200 bg-white object-cover" />
                  <div className="truncate text-[10px] text-slate-500">Image {index + 1}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No images found for selected page.</div>
          )}
        </div>
      </div>
    </div>
  );
}
