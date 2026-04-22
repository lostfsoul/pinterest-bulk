import { useEffect, useMemo, useRef, useState } from 'react';
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
  imageSettings,
  zoom,
  className = '',
}: SvgRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [svgData, setSvgData] = useState<ParsedSvgData | null>(null);
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!templateUrl) {
    return <div className={`text-xs text-gray-500 ${className}`}>No template selected.</div>;
  }

  return (
    <div className={className}>
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      <div
        className="origin-top"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'top center',
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-auto" />
      </div>
      {rendering && <div className="text-[11px] text-gray-500 mt-2">Rendering...</div>}
    </div>
  );
}
