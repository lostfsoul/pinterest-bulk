import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildOverlayCanvas,
  injectGoogleFont,
  ensureLocalFontLoaded,
  parseSVG,
  renderPin,
  type ParsedSvgData,
} from '../../utils/pinRenderer';

type SvgRendererProps = {
  templatePath: string;
  pageImages: string[];
  title: string;
  fontFamily: string;
  fontSetId?: string;
  fontFile?: string | null;
  textColor: string;
  titleScale?: number;
  titlePaddingX?: number;
  lineHeightMultiplier?: number;
  onTitleScaleChange?: (value: number) => void;
  onTitlePaddingXChange?: (value: number) => void;
  onLineHeightMultiplierChange?: (value: number) => void;
  showDragControls?: boolean;
  imageSettings?: {
    ignoreSmallWidth?: boolean;
    minWidth?: number;
    ignoreSmallHeight?: boolean;
    minHeight?: number;
    allowedOrientations?: Array<'portrait' | 'square' | 'landscape'>;
    limitImagesPerPage?: boolean;
  };
  zoom: 0.6 | 0.8 | 1;
  className?: string;
};

export default function SvgRenderer({
  templatePath,
  pageImages,
  title,
  fontFamily,
  fontSetId,
  fontFile,
  textColor,
  titleScale = 1,
  titlePaddingX = 15,
  lineHeightMultiplier = 1,
  onTitleScaleChange,
  onTitlePaddingXChange,
  onLineHeightMultiplierChange,
  showDragControls = false,
  imageSettings,
  zoom,
  className = '',
}: SvgRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [svgData, setSvgData] = useState<ParsedSvgData | null>(null);
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragStateRef = useRef<{
    key: 'scale' | 'padding' | 'lineHeight';
    startX: number;
    startY: number;
    startValue: number;
    direction: number;
  } | null>(null);

  const templateUrl = useMemo(() => {
    if (!templatePath) return '';
    if (templatePath.startsWith('/')) return templatePath;
    return `/static/templates/${templatePath}`;
  }, [templatePath]);

  useEffect(() => {
    let active = true;
    const loadTemplate = async () => {
      if (!templateUrl) {
        setSvgData(null);
        setOverlayCanvas(null);
        return;
      }
      setError(null);
      try {
        const response = await fetch(templateUrl);
        if (!response.ok) throw new Error(`Failed to fetch template: ${response.status}`);
        const svgText = await response.text();
        if (!active) return;
        const parsed = parseSVG(svgText);
        setSvgData(parsed);
      } catch (loadError) {
        if (!active) return;
        setError('Failed to load template preview.');
        setSvgData(null);
        setOverlayCanvas(null);
      }
    };
    void loadTemplate();
    return () => {
      active = false;
    };
  }, [templateUrl]);

  useEffect(() => {
    let active = true;
    const rebuildOverlay = async () => {
      if (!svgData) return;
      const overlay = await buildOverlayCanvas(svgData);
      if (!active) return;
      setOverlayCanvas(overlay);
    };
    void rebuildOverlay();
    return () => {
      active = false;
    };
  }, [svgData]);

  useEffect(() => {
    let active = true;
    const draw = async () => {
      if (!svgData || !overlayCanvas || !canvasRef.current || pageImages.length === 0) return;
      setRendering(true);
      setError(null);
      try {
        const primaryFontName = fontFamily.match(/"([^"]+)"/)?.[1]
          || fontFamily.split(',')[0].replace(/"/g, '').trim();
        if (fontFile) {
          await ensureLocalFontLoaded(primaryFontName, fontFile);
        } else if (fontSetId && fontSetId.startsWith('custom:')) {
          const filename = fontSetId.replace('custom:', '');
          await ensureLocalFontLoaded(primaryFontName, filename);
        } else {
          injectGoogleFont(primaryFontName);
        }
        const rendered = await renderPin(pageImages, title, svgData, overlayCanvas, {
          fontFamily,
          textColor,
          titleScale,
          titlePaddingX,
          lineHeightMultiplier,
          imageSettings,
        });
        if (!active || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = svgData.canvasW;
        canvas.height = svgData.canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(rendered, 0, 0);
      } catch (drawError) {
        if (!active) return;
        setError('Failed to render preview.');
      } finally {
        if (active) setRendering(false);
      }
    };
    void draw();
    return () => {
      active = false;
    };
  }, [svgData, overlayCanvas, pageImages, title, fontFamily, fontSetId, fontFile, textColor, titleScale, titlePaddingX, lineHeightMultiplier, imageSettings]);

  useEffect(() => {
    return () => {
      dragStateRef.current = null;
    };
  }, []);

  function startDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    key: 'scale' | 'padding' | 'lineHeight',
    value: number,
    direction = 1,
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      key,
      startX: event.clientX,
      startY: event.clientY,
      startValue: value,
      direction,
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaX = moveEvent.clientX - drag.startX;
      const deltaY = moveEvent.clientY - drag.startY;
      if (drag.key === 'scale' && onTitleScaleChange) {
        const next = Math.max(0.7, Math.min(1.6, drag.startValue - (deltaY * 0.003)));
        onTitleScaleChange(Number(next.toFixed(2)));
      } else if (drag.key === 'padding' && onTitlePaddingXChange) {
        const next = Math.max(8, Math.min(36, drag.startValue + (deltaX * 0.12 * drag.direction)));
        onTitlePaddingXChange(Math.round(next));
      } else if (drag.key === 'lineHeight' && onLineHeightMultiplierChange) {
        const next = Math.max(0.8, Math.min(1.35, drag.startValue + (deltaY * 0.002)));
        onLineHeightMultiplierChange(Number(next.toFixed(2)));
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  if (!templateUrl) {
    return <div className={`text-xs text-gray-500 ${className}`}>No template selected.</div>;
  }

  return (
    <div className={className}>
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      <div className="relative">
        <div
          className="relative origin-top"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
          }}
        >
          <canvas ref={canvasRef} className="block w-full h-auto" />
          {showDragControls && svgData && (
            <div
              className="absolute border border-dashed border-sky-400/90 bg-sky-500/5"
              style={{
                left: `${(svgData.textZoneX / svgData.canvasW) * 100}%`,
                top: `${(svgData.textZoneY / svgData.canvasH) * 100}%`,
                width: `${(svgData.textZoneW / svgData.canvasW) * 100}%`,
                height: `${(svgData.textZoneH / svgData.canvasH) * 100}%`,
                touchAction: 'none',
              }}
            >
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, 'padding', titlePaddingX, 1)}
                className="absolute left-0 top-1/2 h-9 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-sky-500 bg-white shadow"
                title="Drag to change side padding"
                aria-label="Change title side padding"
              />
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, 'padding', titlePaddingX, -1)}
                className="absolute right-0 top-1/2 h-9 w-3 -translate-y-1/2 translate-x-1/2 cursor-ew-resize rounded-full border border-sky-500 bg-white shadow"
                title="Drag to change side padding"
                aria-label="Change title side padding"
              />
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, 'scale', titleScale)}
                className="absolute left-1/2 top-0 h-3 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border border-sky-500 bg-white shadow"
                title="Drag up/down to change title size"
                aria-label="Change title size"
              />
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, 'lineHeight', lineHeightMultiplier)}
                className="absolute bottom-0 left-1/2 h-3 w-10 -translate-x-1/2 translate-y-1/2 cursor-ns-resize rounded-full border border-sky-500 bg-white shadow"
                title="Drag up/down to change line spacing"
                aria-label="Change line spacing"
              />
            </div>
          )}
        </div>
        {showDragControls && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 space-y-2">
            <div className="rounded border border-slate-300 bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
              Size {Math.round(titleScale * 100)}%
            </div>
            <div className="rounded border border-slate-300 bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
              Padding {Math.round(titlePaddingX)}px
            </div>
            <div className="rounded border border-slate-300 bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
              Spacing {lineHeightMultiplier.toFixed(2)}x
            </div>
          </div>
        )}
      </div>
      {rendering && <div className="text-[11px] text-gray-500 mt-2">Rendering...</div>}
    </div>
  );
}
