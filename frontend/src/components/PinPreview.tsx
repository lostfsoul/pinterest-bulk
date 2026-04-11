import { useEffect, useMemo, useRef, useState } from 'react';
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
  link?: string;
  settings: PinPreviewSettings;
  secondarySlotsOverride?: SecondarySlot[];
  secondaryDefaultsOverride?: Record<string, string>;
  onZoneChange?: (zone: keyof PinPreviewSettings, value: number | string) => void;
  className?: string;
}

type DragMode = 'move' | 'top' | 'bottom' | 'left' | 'right' | null;

const MIN_TEXT_ZONE_HEIGHT = 40;

type SecondarySlot = {
  slot_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  mask_original: boolean;
  text_align: 'left' | 'center' | 'right';
  font_family: string;
  font_weight: string;
  font_size: number;
  text_color: string;
  text_effect: 'none' | 'drop' | 'echo' | 'outline';
  text_effect_color: string;
  text_effect_offset_x: number;
  text_effect_offset_y: number;
  text_effect_blur: number;
  max_lines: number;
  uppercase: boolean;
  default_text: string;
  custom_font_file?: string | null;
};

const FALLBACK_SLOT: SecondarySlot = {
  slot_id: '',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  enabled: true,
  mask_original: true,
  text_align: 'center',
  font_family: '"Poppins", "Segoe UI", Arial, sans-serif',
  font_weight: '700',
  font_size: 24,
  text_color: '#000000',
  text_effect: 'none',
  text_effect_color: '#000000',
  text_effect_offset_x: 2,
  text_effect_offset_y: 2,
  text_effect_blur: 0,
  max_lines: 2,
  uppercase: false,
  default_text: '',
  custom_font_file: null,
};

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

function normalizeSecondarySlots(value: unknown): SecondarySlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((slot): slot is Record<string, unknown> => Boolean(slot && typeof slot === 'object'))
    .map((slot) => {
      const textAlign = String(slot.text_align || 'center').toLowerCase();
      const effect = String(slot.text_effect || 'none').toLowerCase();
      return {
        ...FALLBACK_SLOT,
        slot_id: String(slot.slot_id || ''),
        x: Number(slot.x || 0),
        y: Number(slot.y || 0),
        width: Number(slot.width || 0),
        height: Number(slot.height || 0),
        enabled: slot.enabled !== false,
        mask_original: slot.mask_original !== false,
        text_align: textAlign === 'left' || textAlign === 'right' ? textAlign : 'center',
        font_family: String(slot.font_family || FALLBACK_SLOT.font_family),
        font_weight: String(slot.font_weight || FALLBACK_SLOT.font_weight),
        font_size: Number(slot.font_size || FALLBACK_SLOT.font_size),
        text_color: String(slot.text_color || FALLBACK_SLOT.text_color),
        text_effect: effect === 'drop' || effect === 'echo' || effect === 'outline' ? effect : 'none',
        text_effect_color: String(slot.text_effect_color || FALLBACK_SLOT.text_effect_color),
        text_effect_offset_x: Number(slot.text_effect_offset_x || FALLBACK_SLOT.text_effect_offset_x),
        text_effect_offset_y: Number(slot.text_effect_offset_y || FALLBACK_SLOT.text_effect_offset_y),
        text_effect_blur: Number(slot.text_effect_blur || FALLBACK_SLOT.text_effect_blur),
        max_lines: Math.max(1, Number(slot.max_lines || FALLBACK_SLOT.max_lines)),
        uppercase: Boolean(slot.uppercase),
        default_text: String(slot.default_text || ''),
        custom_font_file: slot.custom_font_file ? String(slot.custom_font_file) : null,
      };
    });
}

function normalizeSecondaryDefaults(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [slotId, slotValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(slotId || '').trim();
    if (!key) continue;
    result[key] = String(slotValue || '');
  }
  return result;
}

function resolveTemplateText(rawValue: string, link?: string): string {
  const outbound = String(link || '').trim();
  let domain = '';
  if (outbound) {
    try {
      domain = new URL(outbound).hostname.replace(/^www\./i, '');
    } catch (error) {
      domain = outbound;
    }
  }
  return String(rawValue || '')
    .replace(/\{\{\s*link\s*\}\}/gi, outbound)
    .replace(/\{\{\s*site_url\s*\}\}/gi, domain || outbound)
    .replace(/\{\{\s*domain\s*\}\}/gi, domain || outbound)
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFontAliasPart(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'slot';
}

function primaryFontFamily(fontFamily: string): string {
  return normalizeFontFamily(fontFamily).split(',')[0].trim();
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

function trimWithEllipsis(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let working = raw;
  const ellipsis = '...';
  while (working) {
    const candidate = `${working.trimEnd()}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
    working = working.slice(0, -1);
  }
  return ellipsis;
}

function wrapWords(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const value = String(text || '').trim();
  if (!value) return [''];
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(probe).width <= maxWidth) {
      current = probe;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const adjusted: string[] = [];
  for (const line of lines) {
    if (ctx.measureText(line).width <= maxWidth) {
      adjusted.push(line);
      continue;
    }
    let chunk = '';
    for (const char of line) {
      const probe = `${chunk}${char}`;
      if (chunk && ctx.measureText(probe).width > maxWidth) {
        adjusted.push(chunk);
        chunk = char;
      } else {
        chunk = probe;
      }
    }
    if (chunk) adjusted.push(chunk);
  }

  if (adjusted.length > maxLines) {
    const sliced = adjusted.slice(0, maxLines);
    sliced[sliced.length - 1] = trimWithEllipsis(ctx, sliced[sliced.length - 1], maxWidth);
    return sliced;
  }

  return adjusted;
}

function fitTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    zoneWidth: number;
    zoneHeight: number;
    fontFamily: string;
    fontWeight?: string;
    maxLines?: number;
    uppercase?: boolean;
    effectOffsetX?: number;
    effectOffsetY?: number;
    effectBlur?: number;
    preferredFontSize?: number;
  },
) {
  const fontFamily = normalizeFontFamily(options.fontFamily);
  const fontWeight = options.fontWeight || '900';
  const maxLines = Math.max(1, Number(options.maxLines || 3));
  const uppercase = Boolean(options.uppercase);
  const effectMarginX = Math.abs(Number(options.effectOffsetX || 0));
  const effectMarginY = Math.abs(Number(options.effectOffsetY || 0)) + Math.abs(Number(options.effectBlur || 0));
  const source = uppercase ? safeUpperCase(text) : String(text || '').trim();
  const usableWidth = Math.max(20, Number(options.zoneWidth || 0) - 30 - (2 * effectMarginX));
  const usableHeight = Math.max(20, Number(options.zoneHeight || 0) - (2 * effectMarginY));

  let best = { lines: [source], fontSize: 12, fontFamily, fontWeight };
  let low = 8;
  let high = Number.isFinite(Number(options.preferredFontSize)) && Number(options.preferredFontSize) > 0
    ? Math.max(8, Math.min(220, Number(options.preferredFontSize)))
    : 220;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    ctx.font = `${fontWeight} ${mid}px ${fontFamily}`.trim();
    const lines = wrapWords(ctx, source, usableWidth, maxLines);
    const lineHeight = mid * 1.0;
    const totalHeight = lineHeight * lines.length;
    const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
    const fits = lines.length <= maxLines && maxWidth <= usableWidth && totalHeight <= usableHeight;
    if (fits) {
      best = { lines, fontSize: mid, fontFamily, fontWeight };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  ctx.font = `${best.fontWeight} ${best.fontSize}px ${best.fontFamily}`.trim();
  best.lines = best.lines.slice(0, maxLines).map((line) => trimWithEllipsis(ctx, line, usableWidth));
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

function drawTextWithEffectAtPositions(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  positions: Array<{ x: number; y: number }>,
  style: {
    textAlign: 'left' | 'center' | 'right';
    textColor: string;
    textEffect: 'none' | 'drop' | 'echo' | 'outline';
    textEffectColor: string;
    textEffectOffsetX: number;
    textEffectOffsetY: number;
    textEffectBlur: number;
  },
) {
  const effect = style.textEffect || 'none';
  const effectColor = style.textEffectColor || '#000000';
  const offsetX = Number(style.textEffectOffsetX || 2);
  const offsetY = Number(style.textEffectOffsetY || 2);
  const blur = Number(style.textEffectBlur || 0);
  const textAlign = style.textAlign || 'center';

  if (effect !== 'none') {
    ctx.save();
    ctx.fillStyle = effectColor;
    ctx.strokeStyle = effectColor;
    ctx.lineJoin = 'round';
    ctx.shadowBlur = effect === 'drop' ? blur : 0;
    ctx.shadowColor = effectColor;
    ctx.textAlign = textAlign;
    lines.forEach((line, index) => {
      const point = positions[index];
      if (!point) return;
      const { x, y } = point;
      if (effect === 'drop') {
        ctx.fillText(line, x + offsetX, y + offsetY);
      } else if (effect === 'echo') {
        ctx.fillText(line, x + offsetX, y + offsetY);
        ctx.fillText(line, x - offsetX, y - offsetY);
      } else if (effect === 'outline') {
        ctx.lineWidth = Math.max(1, Math.abs(offsetX) || Math.abs(offsetY) || 1);
        ctx.strokeText(line, x, y);
      }
    });
    ctx.restore();
  }

  ctx.fillStyle = style.textColor || '#000000';
  ctx.textAlign = textAlign;
  lines.forEach((line, index) => {
    const point = positions[index];
    if (!point) return;
    ctx.fillText(line, point.x, point.y);
  });
}

export function PinPreview({
  template,
  imageUrls = [],
  title = 'Sample Recipe Title',
  link,
  settings,
  secondarySlotsOverride,
  secondaryDefaultsOverride,
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
  const textZoneProps = (textZone?.props || {}) as Record<string, unknown>;
  const secondarySlots = useMemo(
    () => normalizeSecondarySlots(secondarySlotsOverride ?? textZoneProps.secondary_text_slots),
    [secondarySlotsOverride, textZoneProps.secondary_text_slots],
  );
  const secondaryDefaults = useMemo(
    () => normalizeSecondaryDefaults(secondaryDefaultsOverride ?? textZoneProps.secondary_text_defaults),
    [secondaryDefaultsOverride, textZoneProps.secondary_text_defaults],
  );
  const secondaryRenderKey = useMemo(
    () => JSON.stringify({ secondarySlots, secondaryDefaults }),
    [secondarySlots, secondaryDefaults],
  );
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
        const fontsToLoad: Array<{ file: string; family: string }> = [];
        const mainFontAlias = `PreviewMain_${sanitizeFontAliasPart(String(template.id))}`;
        const slotAliasById = new Map<string, string>();

        if (settings.customFontFile) {
          fontsToLoad.push({ file: settings.customFontFile, family: mainFontAlias });
        }

        secondarySlots.forEach((slot, index) => {
          if (!slot.custom_font_file) return;
          const slotId = String(slot.slot_id || `slot_${index + 1}`);
          const alias = `PreviewSlot_${sanitizeFontAliasPart(String(template.id))}_${sanitizeFontAliasPart(slotId)}`;
          slotAliasById.set(slotId, alias);
          fontsToLoad.push({ file: slot.custom_font_file, family: alias });
        });

        for (const item of fontsToLoad) {
          const key = `${item.file}:${item.family}`;
          if (loadedFontFilesRef.current.has(key)) continue;
          try {
            const face = new FontFace(
              item.family,
              `url(/api/templates/fonts/${encodeURIComponent(item.file)})`,
            );
            await face.load();
            document.fonts.add(face);
            loadedFontFilesRef.current.add(key);
          } catch (fontError) {
            console.warn('Custom font load failed:', item.file, fontError);
          }
        }

        await document.fonts.ready;
        const familiesToWarm = new Set<string>();
        const mainFamily = settings.customFontFile ? mainFontAlias : primaryFontFamily(normalizedFont);
        if (mainFamily && mainFamily !== 'sans-serif' && mainFamily !== 'serif' && mainFamily !== 'monospace') {
          familiesToWarm.add(mainFamily);
        }
        secondarySlots.forEach((slot) => {
          const slotId = String(slot.slot_id || '');
          const alias = slotAliasById.get(slotId);
          const family = alias || primaryFontFamily(slot.font_family);
          if (family && family !== 'sans-serif' && family !== 'serif' && family !== 'monospace') {
            familiesToWarm.add(family);
          }
        });
        for (const fontToLoad of familiesToWarm) {
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
        settings.customFontFile ? `PreviewMain_${sanitizeFontAliasPart(String(template.id))}` : normalizedFont,
      );
      const lineHeight = fontSize;
      const centerX = settings.textZonePadLeft + textAreaWidth / 2;
      const titleFontFamily = settings.customFontFile
        ? `PreviewMain_${sanitizeFontAliasPart(String(template.id))}`
        : normalizedFont;
      ctx.font = `900 ${fontSize}px ${titleFontFamily}`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText('A');
      const capAscent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
      const capDescent = metrics.actualBoundingBoxDescent || 0;
      const visualHeight = capAscent + capDescent + (lines.length - 1) * lineHeight;
      const firstBaseline = settings.textZoneY + (settings.textZoneHeight - visualHeight) / 2 + capAscent;

      // Clip title rendering to keep custom fonts/effects inside text zone.
      ctx.save();
      ctx.beginPath();
      ctx.rect(settings.textZonePadLeft, settings.textZoneY, textAreaWidth, settings.textZoneHeight);
      ctx.clip();
      drawTextWithEffect(ctx, lines, centerX, firstBaseline, lineHeight, settings);
      ctx.restore();

      // Render editable secondary slots on top of template overlay.
      secondarySlots.forEach((slot, index) => {
        if (!slot.enabled) return;
        if (slot.width <= 4 || slot.height <= 4) return;
        const defaultValue = secondaryDefaults[slot.slot_id] ?? slot.default_text ?? '';
        const slotText = resolveTemplateText(defaultValue, link);
        if (!slotText) return;

        if (slot.mask_original) {
          ctx.fillStyle = settings.textZoneBgColor || '#ffffff';
          ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
        }

        const slotId = String(slot.slot_id || `slot_${index + 1}`);
        const slotCustomAlias = slot.custom_font_file
          ? `PreviewSlot_${sanitizeFontAliasPart(String(template.id))}_${sanitizeFontAliasPart(slotId)}`
          : null;
        const slotFamily = slotCustomAlias || normalizeFontFamily(slot.font_family);
        const fitted = fitTextBlock(ctx, slotText, {
          zoneWidth: slot.width,
          zoneHeight: slot.height,
          fontFamily: slotFamily,
          fontWeight: slot.font_weight || '700',
          maxLines: slot.max_lines || 2,
          uppercase: slot.uppercase,
          effectOffsetX: slot.text_effect_offset_x,
          effectOffsetY: slot.text_effect_offset_y,
          effectBlur: slot.text_effect_blur,
          preferredFontSize: slot.font_size,
        });
        const align = slot.text_align === 'left' || slot.text_align === 'right' ? slot.text_align : 'center';
        ctx.font = `${slot.font_weight || '700'} ${fitted.fontSize}px ${slotFamily}`.trim();
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = align;
        const lineH = fitted.fontSize * 1.0;
        const m = ctx.measureText('A');
        const slotCapAscent = m.actualBoundingBoxAscent || fitted.fontSize * 0.72;
        const slotCapDescent = m.actualBoundingBoxDescent || 0;
        const slotVisualH = slotCapAscent + slotCapDescent + (fitted.lines.length - 1) * lineH;
        const firstSlotBaseline = slot.y + (slot.height - slotVisualH) / 2 + slotCapAscent;
        const positions = fitted.lines.map((_, index) => ({
          x: align === 'left' ? slot.x + 15 : align === 'right' ? slot.x + slot.width - 15 : slot.x + slot.width / 2,
          y: firstSlotBaseline + (index * lineH),
        }));

        ctx.save();
        ctx.beginPath();
        ctx.rect(slot.x, slot.y, slot.width, slot.height);
        ctx.clip();
        drawTextWithEffectAtPositions(ctx, fitted.lines, positions, {
          textAlign: align,
          textColor: slot.text_color || '#000000',
          textEffect: slot.text_effect || 'none',
          textEffectColor: slot.text_effect_color || '#000000',
          textEffectOffsetX: slot.text_effect_offset_x || 2,
          textEffectOffsetY: slot.text_effect_offset_y || 2,
          textEffectBlur: slot.text_effect_blur || 0,
        });
        ctx.restore();
      });
    };

    render().catch((error) => {
      console.error('Failed to render preview:', error);
    });
  }, [borderColor, borderWidth, imageUrls, link, loading, secondaryRenderKey, settings.customFontFile, settings.fontFamily, settings.textAlign, settings.textColor, settings.textEffect, settings.textEffectColor, settings.textEffectOffsetX, settings.textEffectOffsetY, settings.textEffectBlur, settings.textZoneBgColor, settings.textZoneHeight, settings.textZonePadLeft, settings.textZonePadRight, settings.textZoneY, template, templateSvg, title]);

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
