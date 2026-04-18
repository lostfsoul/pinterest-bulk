import type { PlaygroundPreviewMeta } from '../../services/api';

type PinMetadataProps = {
  metadata: PlaygroundPreviewMeta | null;
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

export default function PinMetadata({ metadata, scheduledDate, onChangeDate }: PinMetadataProps) {
  void onChangeDate;
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
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {metadata?.image_url ? (
            <img src={metadata.image_url} alt="" className="h-12 w-12 rounded border border-slate-200 object-cover" />
          ) : (
            <div className="h-12 w-12 rounded border border-slate-200 bg-white" />
          )}
          <span>Cover · Center Center</span>
        </div>
      </div>
    </div>
  );
}
