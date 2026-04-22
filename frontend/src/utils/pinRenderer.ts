export type SvgZone = { x: number; y: number; width: number; height: number };

export type SvgTextElement = {
  text: string;
  x: number;
  y: number;
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textAnchor: CanvasTextAlign;
};

export type ParsedSvgData = {
  canvasW: number;
  canvasH: number;
  zones: SvgZone[];
  textZoneX: number;
  textZoneW: number;
  textZoneY: number;
  textZoneH: number;
  textZoneBorderColor: string | null;
  textZoneBorderWidth: number;
  textZoneTextColor: string | null;
  strippedSvg: string;
  textElements: SvgTextElement[];
};

export type RenderSettings = {
  fontFamily: string;
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
};

function orientationOfImage(img: HTMLImageElement): 'portrait' | 'square' | 'landscape' {
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (w <= 0 || h <= 0) return 'portrait';
  const ratio = w / h;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

function readNum(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePathBBox(pathData: string): SvgZone | null {
  const nums = pathData.match(/-?\d+(\.\d+)?/g) || [];
  if (nums.length < 4) return null;
  const values = nums.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (values.length < 4) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < values.length - 1; i += 2) {
    xs.push(values[i]);
    ys.push(values[i + 1]);
  }
  if (xs.length === 0 || ys.length === 0) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width <= 10 || height <= 10) return null;
  return { x, y, width, height };
}

function parseClipPathMap(doc: Document): Record<string, SvgZone> {
  const result: Record<string, SvgZone> = {};
  const clipPaths = Array.from(doc.querySelectorAll('clipPath[id]'));
  for (const clipPath of clipPaths) {
    const id = clipPath.getAttribute('id');
    if (!id) continue;
    let bbox: SvgZone | null = null;
    const pathNode = clipPath.querySelector('path[d]');
    if (pathNode) {
      bbox = parsePathBBox(pathNode.getAttribute('d') || '');
    }
    if (!bbox) {
      const rectNode = clipPath.querySelector('rect');
      if (rectNode) {
        const x = readNum(rectNode.getAttribute('x'));
        const y = readNum(rectNode.getAttribute('y'));
        const width = readNum(rectNode.getAttribute('width'));
        const height = readNum(rectNode.getAttribute('height'));
        if (width > 10 && height > 10) bbox = { x, y, width, height };
      }
    }
    if (bbox) result[id] = bbox;
  }
  return result;
}

function clipIdFromAttr(attr: string | null): string | null {
  if (!attr) return null;
  const match = attr.match(/url\(#([^)]+)\)/);
  return match ? match[1] : null;
}

function detectImageZones(doc: Document, cpMap: Record<string, SvgZone>): SvgZone[] {
  const zones: SvgZone[] = [];
  const seen = new Set<string>();
  const images = Array.from(doc.querySelectorAll('image'));
  for (const image of images) {
    let current: Element | null = image;
    let outermost: SvgZone | null = null;
    while (current) {
      const clipId = clipIdFromAttr(current.getAttribute('clip-path'));
      if (clipId && cpMap[clipId]) {
        outermost = cpMap[clipId];
      }
      current = current.parentElement;
    }
    if (!outermost) continue;
    const key = `${Math.round(outermost.x)}:${Math.round(outermost.y)}:${Math.round(outermost.width)}:${Math.round(outermost.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    zones.push(outermost);
  }
  zones.sort((a, b) => a.y - b.y);
  return zones;
}

function detectTextZone(canvasW: number, canvasH: number, zones: SvgZone[], cpMap: Record<string, SvgZone>) {
  let textZoneX = 0;
  let textZoneW = canvasW;
  let textZoneY = Math.round(canvasH * 0.44);
  let textZoneH = Math.round(canvasH * 0.12);
  if (zones.length >= 2) {
    const bottom1 = zones[0].y + zones[0].height;
    const top2 = zones[1].y;
    const gapCenter = (bottom1 + top2) / 2;
    let best: SvgZone | null = null;
    let bestArea = 0;
    for (const bbox of Object.values(cpMap)) {
      if (bbox.width < canvasW * 0.5) continue;
      if (bbox.height > canvasH * 0.25) continue;
      const centerY = bbox.y + (bbox.height / 2);
      if (Math.abs(centerY - gapCenter) > 40) continue;
      const area = bbox.width * bbox.height;
      if (area > bestArea) {
        bestArea = area;
        best = bbox;
      }
    }
    if (best) {
      textZoneX = Math.round(best.x);
      textZoneW = Math.round(best.width);
      textZoneY = Math.round(best.y);
      textZoneH = Math.round(best.height);
    } else if (top2 > bottom1) {
      textZoneY = Math.round(bottom1);
      textZoneH = Math.round(top2 - bottom1);
    }
  } else if (zones.length === 1) {
    textZoneY = Math.round(zones[0].y + zones[0].height);
    textZoneH = Math.round(canvasH * 0.12);
  }
  textZoneX = Math.max(0, textZoneX);
  textZoneW = Math.max(1, Math.min(canvasW, textZoneW));
  return { textZoneX, textZoneW, textZoneY, textZoneH };
}

function extractTranslateY(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/translate\(\s*[\d.-]+\s*,\s*([\d.-]+)\s*\)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectTextZoneTextColor(doc: Document, textZoneY: number, textZoneH: number): string | null {
  let bestColor: string | null = null;
  let bestOpacity = -1;
  const top = textZoneY - 10;
  const bottom = textZoneY + textZoneH + 10;

  for (const group of Array.from(doc.querySelectorAll('g[fill-opacity]'))) {
    if (group.getAttribute('clip-path')) continue;
    if (group.getAttribute('transform')) continue;
    const child = group.querySelector(':scope > g[transform]');
    if (!child) continue;
    const ty = extractTranslateY(child.getAttribute('transform'));
    if (ty === null || ty < top || ty > bottom) continue;
    const opacity = Number(group.getAttribute('fill-opacity') || '1');
    const fill = group.getAttribute('fill');
    if (fill && fill !== 'none' && opacity > bestOpacity) {
      bestColor = fill.toLowerCase();
      bestOpacity = opacity;
    }
  }
  return bestColor;
}

function detectTextZoneBorder(doc: Document, cpMap: Record<string, SvgZone>, textZoneY: number, textZoneH: number) {
  let color: string | null = null;
  let width = 0;
  for (const [clipId, bbox] of Object.entries(cpMap)) {
    if (Math.abs(bbox.y - textZoneY) > 60) continue;
    if (Math.abs(bbox.height - textZoneH) > 60) continue;
    const clipped = doc.querySelector(`[clip-path="url(#${clipId})"]`);
    if (!clipped) continue;
    const strokeNode = clipped.querySelector('[stroke]:not([stroke="none"])');
    if (!strokeNode) continue;
    const fill = strokeNode.getAttribute('fill');
    if (fill && fill !== 'none') continue;
    color = (strokeNode.getAttribute('stroke') || '').toLowerCase() || null;
    width = 4;
    break;
  }
  return { color, width };
}

function removePlaceholderElements(doc: Document, textZoneY: number, textZoneH: number) {
  Array.from(doc.querySelectorAll('image')).forEach((node) => node.remove());
  Array.from(doc.querySelectorAll('rect')).forEach((rect) => {
    const x = readNum(rect.getAttribute('x'));
    const y = readNum(rect.getAttribute('y'));
    if (x < -5 || y < -5) rect.remove();
  });
  const top = textZoneY - 10;
  const bottom = textZoneY + textZoneH + 10;
  Array.from(doc.querySelectorAll('g[fill-opacity]')).forEach((group) => {
    if (group.getAttribute('clip-path')) return;
    if (group.getAttribute('transform')) return;
    const child = group.querySelector(':scope > g[transform]');
    if (!child) return;
    const ty = extractTranslateY(child.getAttribute('transform'));
    if (ty !== null && ty >= top && ty <= bottom) group.remove();
  });
}

function extractTextElements(doc: Document, textZoneY: number, textZoneH: number): SvgTextElement[] {
  const top = textZoneY - 15;
  const bottom = textZoneY + textZoneH + 15;
  const items: SvgTextElement[] = [];
  Array.from(doc.querySelectorAll('text')).forEach((node) => {
    const x = readNum(node.getAttribute('x'), 0);
    const y = readNum(node.getAttribute('y'), 0);
    if (y >= top && y <= bottom) return;
    const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const textAnchorRaw = (node.getAttribute('text-anchor') || 'start').toLowerCase();
    const textAnchor: CanvasTextAlign = textAnchorRaw === 'middle' ? 'center' : textAnchorRaw === 'end' ? 'right' : 'left';
    items.push({
      text: value,
      x,
      y,
      fill: node.getAttribute('fill') || '#000000',
      fontFamily: node.getAttribute('font-family') || 'Poppins',
      fontSize: readNum(node.getAttribute('font-size'), 16),
      fontWeight: node.getAttribute('font-weight') || '400',
      textAnchor,
    });
  });
  return items;
}

export function parseSVG(svgText: string): ParsedSvgData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('Invalid SVG');
  const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map((value) => Number(value));
  const canvasW = Number.isFinite(vb[2]) ? Math.round(vb[2]) : Math.round(readNum(svg.getAttribute('width'), 1000));
  const canvasH = Number.isFinite(vb[3]) ? Math.round(vb[3]) : Math.round(readNum(svg.getAttribute('height'), 1500));

  const cpMap = parseClipPathMap(doc);
  const zones = detectImageZones(doc, cpMap);
  const { textZoneX, textZoneW, textZoneY, textZoneH } = detectTextZone(canvasW, canvasH, zones, cpMap);
  const textZoneTextColor = detectTextZoneTextColor(doc, textZoneY, textZoneH);
  const textElements = extractTextElements(doc, textZoneY, textZoneH);
  const { color: textZoneBorderColor, width: textZoneBorderWidth } = detectTextZoneBorder(doc, cpMap, textZoneY, textZoneH);

  const stripDoc = parser.parseFromString(svgText, 'image/svg+xml');
  removePlaceholderElements(stripDoc, textZoneY, textZoneH);
  const stripSvg = stripDoc.querySelector('svg');
  if (stripSvg) {
    stripSvg.setAttribute('width', String(canvasW));
    stripSvg.setAttribute('height', String(canvasH));
  }
  const strippedSvg = new XMLSerializer().serializeToString(stripDoc);

  return {
    canvasW,
    canvasH,
    zones,
    textZoneX,
    textZoneW,
    textZoneY,
    textZoneH,
    textZoneBorderColor,
    textZoneBorderWidth,
    textZoneTextColor,
    strippedSvg,
    textElements,
  };
}

export async function buildOverlayCanvas(svgData: ParsedSvgData): Promise<HTMLCanvasElement> {
  const blob = new Blob([svgData.strippedSvg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to build overlay canvas'));
    img.src = url;
  });
  URL.revokeObjectURL(url);
  const canvas = document.createElement('canvas');
  canvas.width = svgData.canvasW;
  canvas.height = svgData.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(img, 0, 0, svgData.canvasW, svgData.canvasH);
  return canvas;
}

export async function loadImage(url: string): Promise<{ img: HTMLImageElement | null; tainted: boolean }> {
  if (!url) return { img: null, tainted: false };
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise((resolve) => {
    img.onload = () => resolve({ img, tainted: false });
    img.onerror = () => {
      const fallback = new Image();
      fallback.onload = () => resolve({ img: fallback, tainted: true });
      fallback.onerror = () => resolve({ img: null, tainted: false });
      fallback.src = url;
    };
    img.src = url;
  });
}

export function drawCoverCenter(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = img.naturalWidth * scale;
  const sh = img.naturalHeight * scale;
  const sx = x + (w - sw) / 2;
  const sy = y + (h - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh);
  ctx.restore();
}

export function findMaxFontSize(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  usableW: number,
  usableH: number,
  fontFamily: string,
  lineHeightMultiplier = 1,
): number {
  let lo = 12;
  let hi = 200;
  let best = 12;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `900 ${mid}px ${fontFamily}`;
    const lineH = mid * lineHeightMultiplier;
    const totalH = lines.length * lineH;
    const maxW = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (maxW <= usableW && totalH <= usableH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function wrapWords(ctx: CanvasRenderingContext2D, text: string, usableW: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(probe).width <= usableW) {
      current = probe;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function linePenalty(ctx: CanvasRenderingContext2D, lines: string[]): number {
  if (!lines.length) return 1000;
  const widths = lines.map((line) => ctx.measureText(line).width);
  const maxW = Math.max(...widths, 1);
  let penalty = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const words = lines[i].split(/\s+/).filter(Boolean);
    if (words.length === 1 && lines.length > 1) penalty += 18;
    if (i === lines.length - 1 && widths[i] < maxW * 0.45 && lines.length > 1) penalty += 12;
  }
  const ratioSpread = widths.reduce((sum, width) => sum + Math.abs(maxW - width), 0) / Math.max(1, lines.length);
  penalty += ratioSpread / Math.max(1, maxW) * 10;
  return penalty;
}

export function fitTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  zoneW: number,
  zoneH: number,
  fontFamily: string,
  padX = 15,
  lineHeightMultiplier = 1,
): { lines: string[]; fontSize: number } {
  const upper = String(text || '').toUpperCase().trim() || 'SAMPLE TITLE';
  const usableW = Math.max(20, zoneW - (2 * Math.max(0, padX)));
  const usableH = zoneH;
  let lo = 12;
  let hi = 220;
  let best = { lines: [upper], fontSize: 12, penalty: 9999 };
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `900 ${mid}px ${fontFamily}`;
    const lines = wrapWords(ctx, upper, usableW);
    const lineH = mid * lineHeightMultiplier;
    const totalH = lines.length * lineH;
    const maxW = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
    const fits = lines.length <= 3 && maxW <= usableW && totalH <= usableH;
    if (fits) {
      const penalty = linePenalty(ctx, lines);
      best = { lines, fontSize: mid, penalty };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // If no fit found at >12, try smallest fallback.
  if (best.fontSize <= 12) {
    ctx.font = `900 12px ${fontFamily}`;
    const lines = wrapWords(ctx, upper, usableW).slice(0, 3);
    return { lines, fontSize: 12 };
  }
  return { lines: best.lines, fontSize: best.fontSize };
}

export async function ensureFontLoaded(fontFamily: string) {
  try {
    const name = fontFamily.match(/"([^"]+)"/)?.[1]
      || fontFamily.split(',')[0].replace(/"/g, '').trim();
    if (!name) return;
    if (['Impact', 'Arial Black', 'Arial', 'Haettenschweiler'].includes(name)) return;
    await document.fonts.load(`900 64px "${name}"`);
  } catch (_error) {
    // noop
  }
}

export async function ensureLocalFontLoaded(fontFamily: string, fontFilename?: string | null) {
  if (!fontFilename) return;
  const family = String(fontFamily || '').trim().replace(/^["']|["']$/g, '');
  if (!family) return;
  try {
    const fontFace = new FontFace(family, `url(/api/templates/fonts/${encodeURIComponent(fontFilename)})`, {
      weight: '900',
      style: 'normal',
    });
    await fontFace.load();
    document.fonts.add(fontFace);
    await document.fonts.load(`900 64px "${family}"`);
  } catch (_error) {
    // noop
  }
}

export function injectGoogleFont(fontName: string) {
  const name = String(fontName || '').trim();
  if (!name) return;
  const id = `gf-${name.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@900&display=swap`;
  document.head.appendChild(link);
}

export async function renderPin(
  pageImages: string[],
  title: string,
  svgData: ParsedSvgData,
  overlayCanvas: HTMLCanvasElement,
  settings: RenderSettings,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = svgData.canvasW;
  canvas.height = svgData.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, svgData.canvasW, svgData.canvasH);

  const minWidth = Number.isFinite(Number(settings.imageSettings?.minWidth))
    ? Math.max(1, Number(settings.imageSettings?.minWidth))
    : 200;
  const minHeight = Number.isFinite(Number(settings.imageSettings?.minHeight))
    ? Math.max(1, Number(settings.imageSettings?.minHeight))
    : 200;
  const allowedOrientations = Array.isArray(settings.imageSettings?.allowedOrientations)
    ? new Set(settings.imageSettings?.allowedOrientations)
    : new Set(['portrait', 'square', 'landscape']);
  const limitImages = Boolean(settings.imageSettings?.limitImagesPerPage);
  const sourceUrls = limitImages ? pageImages.slice(0, 3) : pageImages;
  const imageResults = await Promise.all(sourceUrls.map((url) => loadImage(url || '')));
  const candidates = imageResults
    .map((item) => item.img)
    .filter((img): img is HTMLImageElement => Boolean(img));
  const filteredCandidates = candidates.filter((img) => {
    if (settings.imageSettings?.ignoreSmallWidth && img.naturalWidth < minWidth) return false;
    if (settings.imageSettings?.ignoreSmallHeight && img.naturalHeight < minHeight) return false;
    const orientation = orientationOfImage(img);
    if (allowedOrientations.size > 0 && !allowedOrientations.has(orientation)) return false;
    return true;
  });
  const finalCandidates = filteredCandidates.length > 0 ? filteredCandidates : candidates;
  svgData.zones.forEach((zone, index) => {
    const img = finalCandidates[index] || finalCandidates[0] || null;
    if (img) drawCoverCenter(ctx, img, zone.x, zone.y, zone.width, zone.height);
  });

  ctx.drawImage(overlayCanvas, 0, 0);

  if (svgData.textZoneBorderColor) {
    const bw = svgData.textZoneBorderWidth || 4;
    const half = bw / 2;
    ctx.save();
    ctx.strokeStyle = svgData.textZoneBorderColor;
    ctx.lineWidth = bw;
    ctx.strokeRect(svgData.textZoneX + half, svgData.textZoneY + half, svgData.textZoneW - bw, svgData.textZoneH - bw);
    ctx.restore();
  }

  for (const item of svgData.textElements) {
    ctx.save();
    ctx.font = `${item.fontWeight} ${item.fontSize}px ${item.fontFamily}`;
    ctx.fillStyle = item.fill;
    ctx.textAlign = item.textAnchor;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  }

  await ensureFontLoaded(settings.fontFamily);
  const titlePaddingX = Number.isFinite(Number(settings.titlePaddingX))
    ? Math.max(0, Number(settings.titlePaddingX))
    : 15;
  const lineHeightMultiplier = Number.isFinite(Number(settings.lineHeightMultiplier))
    ? Math.max(0.8, Math.min(1.4, Number(settings.lineHeightMultiplier)))
    : 1;
  const { lines, fontSize } = fitTitle(
    ctx,
    title,
    svgData.textZoneW,
    svgData.textZoneH,
    settings.fontFamily,
    titlePaddingX,
    lineHeightMultiplier,
  );
  const titleScale = Number.isFinite(Number(settings.titleScale)) ? Number(settings.titleScale) : 1;
  const scaledFontSize = Math.max(12, Math.min(220, Math.round(fontSize * Math.max(0.6, Math.min(1.8, titleScale)))));
  const lineH = scaledFontSize * lineHeightMultiplier;
  const centerX = svgData.textZoneX + (svgData.textZoneW / 2);

  ctx.font = `900 ${scaledFontSize}px ${settings.fontFamily}`;
  ctx.fillStyle = settings.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const m = ctx.measureText('A');
  const capAscent = m.actualBoundingBoxAscent || scaledFontSize * 0.72;
  const capDescent = m.actualBoundingBoxDescent || 0;
  const capH = capAscent + capDescent;
  const visualH = capH + (lines.length - 1) * lineH;
  const firstBase = svgData.textZoneY + (svgData.textZoneH - visualH) / 2 + capAscent;
  lines.forEach((line, index) => ctx.fillText(line, centerX, firstBase + index * lineH));

  return canvas;
}
