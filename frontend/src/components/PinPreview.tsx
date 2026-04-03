import { useEffect, useRef, useState } from 'react';
import { Template, TemplateZone } from '../services/api';

interface PinPreviewSettings {
  textZoneY: number;
  textZoneHeight: number;
  textZonePadLeft: number;
  textZonePadRight: number;
  textZoneBgColor: string;
  fontFamily: string;
  textColor: string;
  textAlign?: 'left' | 'center';
  textEffect?: 'none' | 'drop' | 'echo' | 'outline';
  textEffectColor?: string;
  textEffectOffsetX?: number;
  textEffectOffsetY?: number;
  textEffectBlur?: number;
  customFontFile?: string | null;
}

interface PinPreviewProps {
  template: Template;
  imageUrls?: string[];
  title?: string;
  settings: PinPreviewSettings;
  onZoneChange?: (zone: keyof PinPreviewSettings, value: number | string) => void;
  className?: string;
}

type DragMode = 'move' | 'top' | 'bottom' | 'left' | 'right' | null;

const MIN_TEXT_ZONE_HEIGHT = 40;

function drawCoverCenter(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  zone: TemplateZone,
) {
  if (!img.naturalWidth || !img.naturalHeight) return;

  const scale = Math.max(zone.width / img.naturalWidth, zone.height / img.naturalHeight);
  const scaledWidth = img.naturalWidth * scale;
  const scaledHeight = img.naturalHeight * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.width, zone.height);
  ctx.clip();
  ctx.drawImage(
    img,
    zone.x - (scaledWidth - zone.width) / 2,
    zone.y - (scaledHeight - zone.height) / 2,
    scaledWidth,
    scaledHeight,
  );
  ctx.restore();
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const tryLoad = (withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (withCors) {
          tryLoad(false);
          return;
        }
        resolve(null);
      };
      img.src = url;
    };
    tryLoad(true);
  });
}

function parseNumericAttr(tag: string, name: string): number | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseStringAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? String(match[1]) : null;
}

function parseSvgCoordinateSpace(svg: string): { width: number; height: number } | null {
  const svgOpen = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgOpen) return null;

  const width = parseNumericAttr(svgOpen, 'width');
  const height = parseNumericAttr(svgOpen, 'height');
  const viewBoxRaw = parseStringAttr(svgOpen, 'viewBox');
  if (viewBoxRaw) {
    const parts = viewBoxRaw
      .trim()
      .split(/[\s,]+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  if (width && height && width > 0 && height > 0) return { width, height };
  return null;
}

function overlayHasOccludingImagePlaceholders(
  svg: string,
  imageZones: TemplateZone[],
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  if (!svg || imageZones.length === 0) return false;
  if (/zoomAndPan\s*=\s*["']magnify["']/i.test(svg)) {
    return true;
  }
  const svgSpace = parseSvgCoordinateSpace(svg);
  const scaleX = svgSpace?.width ? canvasWidth / svgSpace.width : 1;
  const scaleY = svgSpace?.height ? canvasHeight / svgSpace.height : 1;
  const rectTags = svg.match(/<rect\b[^>]*>/gi) || [];
  if (rectTags.length === 0) return false;

  const near = (a: number, b: number) => Math.abs(a - b) <= 3;
  for (const tag of rectTags) {
    const fill = (parseStringAttr(tag, 'fill') || '').trim().toLowerCase();
    const fillOpacityRaw = parseStringAttr(tag, 'fill-opacity');
    const fillOpacity = fillOpacityRaw != null ? Number(fillOpacityRaw) : 1;
    if (fill === 'none' || (Number.isFinite(fillOpacity) && fillOpacity <= 0.01)) continue;

    const x = (parseNumericAttr(tag, 'x') ?? 0) * scaleX;
    const y = (parseNumericAttr(tag, 'y') ?? 0) * scaleY;
    const width = (parseNumericAttr(tag, 'width') ?? 0) * scaleX;
    const height = (parseNumericAttr(tag, 'height') ?? 0) * scaleY;
    if (width <= 1 || height <= 1) continue;

    const overlapsZone = imageZones.some((zone) =>
      near(x, zone.x) &&
      near(y, zone.y) &&
      near(width, zone.width) &&
      near(height, zone.height),
    );
    if (overlapsZone) return true;
  }
  return false;
}

function sortImageZones(zones: TemplateZone[]): TemplateZone[] {
  return [...zones].sort((a, b) => {
    const aIndex = Number((a.props as Record<string, unknown> | null)?.zone_index ?? 9999);
    const bIndex = Number((b.props as Record<string, unknown> | null)?.zone_index ?? 9999);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.id - b.id;
  });
}

function findMaxFontSize(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  usableWidth: number,
  usableHeight: number,
  fontFamily: string,
) {
  let low = 12;
  let high = 200;
  let best = 12;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    ctx.font = `900 ${mid}px ${fontFamily}`;
    const lineHeight = mid;
    const totalHeight = lines.length * lineHeight;
    const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));

    if (maxWidth <= usableWidth && totalHeight <= usableHeight) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function safeUpperCase(text: string): string {
  // Remove characters that toUpperCase() can't handle properly
  // This includes certain emojis, special symbols, and problematic unicode
  const safe = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u2060\uFE00-\uFE0F]/g, '');
  try {
    return safe.toUpperCase();
  } catch (e) {
    // Fallback for any remaining issues
    return safe.replace(/[^\x00-\x7F]/g, '').toUpperCase();
  }
}

function normalizeFontFamily(fontFamily: string): string {
  // Normalize font family string - handle quoted font names for canvas
  return fontFamily
    .replace(/^["']|["']$/g, '')
    .replace(/["']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  zoneWidth: number,
  zoneHeight: number,
  fontFamily: string,
) {
  // Normalize font family for canvas
  fontFamily = normalizeFontFamily(fontFamily);

  const upper = safeUpperCase(text);
  const usableWidth = zoneWidth - 30;
  const usableHeight = zoneHeight;
  const words = upper.split(' ');
  let best = { lines: [upper], fontSize: 14 };

  const measureWidth = (lines: string[], fontSize: number) => {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    return Math.max(...lines.map((line) => ctx.measureText(line).width));
  };

  const tryLines = (lines: string[]) => {
    const fontSize = findMaxFontSize(ctx, lines, usableWidth, usableHeight, fontFamily);
    if (fontSize > best.fontSize) {
      best = { lines, fontSize };
      return;
    }
    if (fontSize === best.fontSize && lines.length === best.lines.length) {
      if (measureWidth(lines, fontSize) < measureWidth(best.lines, fontSize)) {
        best = { lines, fontSize };
      }
    }
  };

  tryLines([upper]);

  if (words.length >= 2) {
    for (let index = 1; index < words.length; index += 1) {
      tryLines([words.slice(0, index).join(' '), words.slice(index).join(' ')]);
    }
  }

  if (words.length >= 4) {
    for (let start = 1; start < words.length - 1; start += 1) {
      for (let end = start + 1; end < words.length; end += 1) {
        tryLines([
          words.slice(0, start).join(' '),
          words.slice(start, end).join(' '),
          words.slice(end).join(' '),
        ]);
      }
    }
  }

  return best;
}

function drawTextWithEffect(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  centerX: number,
  firstBaseline: number,
  lineHeight: number,
  settings: PinPreviewSettings,
) {
  const textColor = settings.textColor;
  const textAlign = settings.textAlign === 'left' ? 'left' : 'center';
  const effect = settings.textEffect || 'none';
  const effectColor = settings.textEffectColor || '#000000';
  const offsetX = Number(settings.textEffectOffsetX || 2);
  const offsetY = Number(settings.textEffectOffsetY || 2);
  const blur = Number(settings.textEffectBlur || 0);
  const textX = textAlign === 'left' ? settings.textZonePadLeft + 15 : centerX;

  if (effect !== 'none') {
    ctx.save();
    ctx.fillStyle = effectColor;
    ctx.strokeStyle = effectColor;
    ctx.lineJoin = 'round';
    ctx.shadowBlur = effect === 'drop' ? blur : 0;
    ctx.shadowColor = effectColor;
    ctx.textAlign = textAlign;
    lines.forEach((line, index) => {
      const y = firstBaseline + index * lineHeight;
      if (effect === 'drop') {
        ctx.fillText(line, textX + offsetX, y + offsetY);
      } else if (effect === 'echo') {
        ctx.fillText(line, textX + offsetX, y + offsetY);
        ctx.fillText(line, textX - offsetX, y - offsetY);
      } else if (effect === 'outline') {
        ctx.lineWidth = Math.max(1, Math.abs(offsetX) || Math.abs(offsetY) || 1);
        ctx.strokeText(line, textX, y);
      }
    });
    ctx.restore();
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = textAlign;
  lines.forEach((line, index) => {
    ctx.fillText(line, textX, firstBaseline + index * lineHeight);
  });
}

export function PinPreview({
  template,
  imageUrls = [],
  title = 'Sample Recipe Title',
  settings,
  onZoneChange,
  className = '',
}: PinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [templateSvg, setTemplateSvg] = useState<string | null>(null);
  const loadedFontFilesRef = useRef<Set<string>>(new Set());
  const dragModeRef = useRef<DragMode>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    zoneY: number;
    zoneHeight: number;
    padLeft: number;
    padRight: number;
  } | null>(null);

  const textZone = template.zones?.find((zone) => zone.zone_type === 'text');
  const borderColor = (textZone?.props?.border_color as string | undefined) || null;
  const borderWidth = Number(textZone?.props?.border_width ?? 4);

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${template.id}/overlay`);
        if (response.ok) {
          setTemplateSvg(await response.text());
        }
      } catch (error) {
        console.error('Failed to load template overlay:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTemplate();
  }, [template.id]);

  useEffect(() => {
    if (!canvasRef.current || loading) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const normalizedFont = normalizeFontFamily(settings.fontFamily);

    const render = async () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, template.width, template.height);

      let imageZones = sortImageZones(template.zones?.filter((zone) => zone.zone_type === 'image') || []);
      if (imageZones.length === 0) {
        const topHeight = Math.max(0, Math.round(settings.textZoneY));
        const bottomStart = Math.round(settings.textZoneY + settings.textZoneHeight);
        const bottomHeight = Math.max(0, Math.round(template.height - bottomStart));
        if (topHeight === 0 || bottomHeight === 0) {
          const zoneHeight = Math.round(template.height * 0.44);
          const gapHeight = Math.round(template.height * 0.12);
          imageZones = [
            { id: 1, zone_type: 'image', x: 0, y: 0, width: template.width, height: zoneHeight, props: null },
            { id: 2, zone_type: 'image', x: 0, y: zoneHeight + gapHeight, width: template.width, height: zoneHeight, props: null },
          ];
        } else {
          imageZones = [
            { id: 1, zone_type: 'image', x: 0, y: 0, width: template.width, height: topHeight, props: null },
            { id: 2, zone_type: 'image', x: 0, y: bottomStart, width: template.width, height: bottomHeight, props: null },
          ];
        }
      }

      const urlsToRender = imageUrls.length > 0
        ? Array.from({ length: imageZones.length }, (_, index) => imageUrls[index % imageUrls.length])
        : ['https://via.placeholder.com/800x600?text=Sample+Image'];
      const images = await Promise.all(urlsToRender.map(loadImage));

      const shouldDrawOverlayBeforeImages = Boolean(
        templateSvg && overlayHasOccludingImagePlaceholders(templateSvg, imageZones, template.width, template.height),
      );
      if (templateSvg && shouldDrawOverlayBeforeImages) {
        const blob = new Blob([templateSvg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(blob);
        const overlayImg = await loadImage(svgUrl);
        URL.revokeObjectURL(svgUrl);
        if (overlayImg) {
          ctx.drawImage(overlayImg, 0, 0, template.width, template.height);
        }
      }

      images.forEach((img, index) => {
        const zone = imageZones[index];
        if (img && zone) {
          drawCoverCenter(ctx, img, zone);
        }
      });

      if (templateSvg && !shouldDrawOverlayBeforeImages) {
        const blob = new Blob([templateSvg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(blob);
        const overlayImg = await loadImage(svgUrl);
        URL.revokeObjectURL(svgUrl);
        if (overlayImg) {
          ctx.drawImage(overlayImg, 0, 0, template.width, template.height);
        }
      }

      const textAreaWidth = template.width - settings.textZonePadLeft - settings.textZonePadRight;
      ctx.fillStyle = settings.textZoneBgColor || '#ffffff';
      ctx.fillRect(settings.textZonePadLeft, settings.textZoneY, textAreaWidth, settings.textZoneHeight);

      if (borderColor) {
        const half = borderWidth / 2;
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(
          settings.textZonePadLeft + half,
          settings.textZoneY + half,
          textAreaWidth - borderWidth,
          settings.textZoneHeight - borderWidth,
        );
        ctx.restore();
      }

      // Wait for fonts to be loaded before drawing text
      try {
        if (settings.customFontFile && !loadedFontFilesRef.current.has(settings.customFontFile)) {
          const family = normalizeFontFamily(settings.fontFamily).split(',')[0].trim();
          if (family) {
            try {
              const face = new FontFace(
                family,
                `url(/api/templates/fonts/${encodeURIComponent(settings.customFontFile)})`,
              );
              await face.load();
              document.fonts.add(face);
              loadedFontFilesRef.current.add(settings.customFontFile);
            } catch (fontError) {
              console.warn('Custom font load failed:', settings.customFontFile, fontError);
            }
          }
        }
        await document.fonts.ready;
        // Try to load the specific font if it's a custom font
        const fontToLoad = normalizedFont.split(',')[0].trim();
        if (fontToLoad && fontToLoad !== 'sans-serif' && fontToLoad !== 'serif' && fontToLoad !== 'monospace') {
          await document.fonts.load(`900 48px "${fontToLoad}"`).catch(() => {
            // Font might not be available, continue anyway
          });
        }
      } catch (e) {
        // Continue even if font loading fails
      }

      const { lines, fontSize } = fitTitle(
        ctx,
        title,
        textAreaWidth,
        settings.textZoneHeight,
        normalizedFont,
      );
      const lineHeight = fontSize;
      const centerX = settings.textZonePadLeft + textAreaWidth / 2;
      ctx.font = `900 ${fontSize}px ${normalizedFont}`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText('A');
      const capAscent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
      const capDescent = metrics.actualBoundingBoxDescent || 0;
      const visualHeight = capAscent + capDescent + (lines.length - 1) * lineHeight;
      const firstBaseline = settings.textZoneY + (settings.textZoneHeight - visualHeight) / 2 + capAscent;

      drawTextWithEffect(ctx, lines, centerX, firstBaseline, lineHeight, settings);
    };

    render().catch((error) => {
      console.error('Failed to render preview:', error);
    });
  }, [borderColor, borderWidth, imageUrls, loading, settings.customFontFile, settings.fontFamily, settings.textAlign, settings.textColor, settings.textEffect, settings.textEffectColor, settings.textEffectOffsetX, settings.textEffectOffsetY, settings.textEffectBlur, settings.textZoneBgColor, settings.textZoneHeight, settings.textZonePadLeft, settings.textZonePadRight, settings.textZoneY, template, templateSvg, title]);

  useEffect(() => {
    if (!onZoneChange) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current || !dragModeRef.current || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const scaleX = template.width / rect.width;
      const scaleY = template.height / rect.height;
      const dx = (event.clientX - dragStartRef.current.clientX) * scaleX;
      const dy = (event.clientY - dragStartRef.current.clientY) * scaleY;
      const start = dragStartRef.current;

      if (dragModeRef.current === 'move') {
        const zoneWidth = template.width - start.padLeft - start.padRight;
        const nextLeft = Math.max(0, Math.min(template.width - zoneWidth, Math.round(start.padLeft + dx)));
        const nextY = Math.max(0, Math.min(template.height - start.zoneHeight, Math.round(start.zoneY + dy)));
        onZoneChange('textZonePadLeft', nextLeft);
        onZoneChange('textZonePadRight', Math.max(0, template.width - zoneWidth - nextLeft));
        onZoneChange('textZoneY', nextY);
      } else if (dragModeRef.current === 'top') {
        const nextY = Math.max(0, Math.min(template.height - MIN_TEXT_ZONE_HEIGHT, Math.round(start.zoneY + dy)));
        onZoneChange('textZoneY', nextY);
        onZoneChange('textZoneHeight', Math.max(MIN_TEXT_ZONE_HEIGHT, Math.round(start.zoneHeight - (nextY - start.zoneY))));
      } else if (dragModeRef.current === 'bottom') {
        onZoneChange(
          'textZoneHeight',
          Math.max(MIN_TEXT_ZONE_HEIGHT, Math.min(template.height - start.zoneY, Math.round(start.zoneHeight + dy))),
        );
      } else if (dragModeRef.current === 'left') {
        const maxPad = template.width / 2 - 20;
        onZoneChange('textZonePadLeft', Math.round(Math.max(0, Math.min(maxPad, start.padLeft + dx))));
      } else if (dragModeRef.current === 'right') {
        const maxPad = template.width / 2 - 20;
        onZoneChange('textZonePadRight', Math.round(Math.max(0, Math.min(maxPad, start.padRight - dx))));
      }
    };

    const handleMouseUp = () => {
      dragModeRef.current = null;
      dragStartRef.current = null;
      document.body.classList.remove('select-none');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onZoneChange, template.height, template.width]);

  const startDrag = (mode: DragMode, event: React.MouseEvent) => {
    if (!onZoneChange) return;
    event.preventDefault();
    event.stopPropagation();
    dragModeRef.current = mode;
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      zoneY: settings.textZoneY,
      zoneHeight: settings.textZoneHeight,
      padLeft: settings.textZonePadLeft,
      padRight: settings.textZonePadRight,
    };
    document.body.classList.add('select-none');
  };

  const textZoneTopPct = (settings.textZoneY / template.height) * 100;
  const textZoneHeightPct = (settings.textZoneHeight / template.height) * 100;
  const leftPadPct = (settings.textZonePadLeft / template.width) * 100;
  const rightPadPct = (settings.textZonePadRight / template.width) * 100;

  return (
    <div className={`relative inline-block ${className}`}>
      <canvas
        ref={canvasRef}
        width={template.width}
        height={template.height}
        className="max-w-full h-auto border border-gray-300 rounded"
      />

      {onZoneChange && (
        <div ref={overlayRef} className="absolute inset-0">
          <div
            className="absolute border-2 border-yellow-500 bg-yellow-500/20 cursor-move"
            style={{
              top: `${textZoneTopPct}%`,
              height: `${textZoneHeightPct}%`,
              left: `${leftPadPct}%`,
              right: `${rightPadPct}%`,
            }}
            onMouseDown={(event) => startDrag('move', event)}
          >
            <div className="absolute inset-x-0 -top-1 h-2 cursor-ns-resize" onMouseDown={(event) => startDrag('top', event)} />
            <div className="absolute inset-x-0 -bottom-1 h-2 cursor-ns-resize" onMouseDown={(event) => startDrag('bottom', event)} />
            <div className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize" onMouseDown={(event) => startDrag('left', event)} />
            <div className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize" onMouseDown={(event) => startDrag('right', event)} />
            <span className="sr-only">Text zone</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <span className="text-gray-500">Loading preview...</span>
        </div>
      )}
    </div>
  );
}
