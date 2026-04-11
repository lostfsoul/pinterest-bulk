/**
 * Node.js Canvas-based Pin Renderer
 *
 * Uses the 'canvas' npm package to render Pinterest pins server-side.
 * Based on the reference React implementation.
 *
 * Usage: node render.js <data_file.json>
 */

const fs = require('fs');
const path = require('path');

// Check if canvas package is available
let canvasAvailable = false;
let Canvas, Image, ImageData, registerFont;
let resvgAvailable = false;
let Resvg;

try {
    const canvasModule = require('canvas');
    Canvas = canvasModule.Canvas;
    Image = canvasModule.Image;
    ImageData = canvasModule.ImageData;
    registerFont = canvasModule.registerFont;
    canvasAvailable = true;
} catch (e) {
    // Canvas not available, will exit gracefully
}

try {
    ({ Resvg } = require('@resvg/resvg-js'));
    resvgAvailable = true;
} catch (e) {
    // resvg not available; canvas can still be used only when explicitly requested
}

/**
 * Load an image from URL
 */
async function loadImage(url) {
    if (!url) return null;

    return new Promise((resolve) => {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            const timeout = setTimeout(() => {
                console.error(`[DEBUG] Image load timeout: ${url}`);
                resolve(null);
            }, 10000); // 10 second timeout

            img.onload = () => {
                clearTimeout(timeout);
                const width = img.width || img.naturalWidth || 0;
                const height = img.height || img.naturalHeight || 0;
                console.error(`[DEBUG] Image loaded successfully: ${url}, size: ${width}x${height}`);
                resolve(img);
            };

            img.onerror = (err) => {
                clearTimeout(timeout);
                console.error(`[DEBUG] Image load error: ${url}`, err);
                resolve(null);
            };

            // Try to load the image
            img.src = url;
        } catch (error) {
            console.error(`[DEBUG] Exception loading image: ${url}`, error);
            resolve(null);
        }
    });
}

/**
 * Draw image covering a zone (center-cropped)
 */
function drawCoverCenter(ctx, img, zoneX, zoneY, zoneW, zoneH) {
    const imgWidth = img ? (img.width || img.naturalWidth || 0) : 0;
    const imgHeight = img ? (img.height || img.naturalHeight || 0) : 0;
    if (!img || !imgWidth || !imgHeight) return;

    const scale = Math.max(zoneW / imgWidth, zoneH / imgHeight);
    const sw = imgWidth * scale;
    const sh = imgHeight * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(zoneX, zoneY, zoneW, zoneH);
    ctx.clip();
    ctx.drawImage(
        img,
        zoneX - (sw - zoneW) / 2,
        zoneY - (sh - zoneH) / 2,
        sw,
        sh
    );
    ctx.restore();
}

/**
 * Safely convert text to uppercase, handling Unicode properly
 */
function safeUpperCase(text) {
    // Remove characters that toUpperCase() can't handle (produces �)
    // This includes certain emojis, special symbols, and problematic unicode
    const safe = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u2060\uFE00-\uFE0F]/g, '');
    try {
        return safe.toUpperCase();
    } catch (e) {
        // Fallback for any remaining issues
        return safe.replace(/[^\x00-\x7F]/g, '').toUpperCase();
    }
}

function normalizeFontFamily(fontFamily) {
    return String(fontFamily || 'sans-serif')
        .replace(/^["']|["']$/g, '')
        .replace(/["']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimWithEllipsis(ctx, value, maxWidth) {
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

function wrapWords(ctx, text, maxWidth, maxLines) {
    const value = String(text || '').trim();
    if (!value) return [''];
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];

    const lines = [];
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

    const adjusted = [];
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

function fitTextBlock(ctx, text, options) {
    const {
        zoneW,
        zoneH,
        fontFamily,
        fontWeight = '900',
        maxLines = 3,
        padX = 15,
        padY = 0,
        effectMarginX = 0,
        effectMarginY = 0,
        uppercase = false,
        preferredFontSize = 0,
    } = options;

    const family = normalizeFontFamily(fontFamily);
    const source = uppercase ? safeUpperCase(text) : String(text || '').trim();
    const usableW = Math.max(20, Number(zoneW || 0) - (2 * Math.abs(padX)) - (2 * Math.abs(effectMarginX)));
    const usableH = Math.max(20, Number(zoneH || 0) - (2 * Math.abs(padY)) - (2 * Math.abs(effectMarginY)));
    const maxAllowedLines = Math.max(1, Number(maxLines || 1));

    let best = { lines: [source], fontSize: 12, family, weight: fontWeight };
    let lo = 8;
    let hi = Number.isFinite(Number(preferredFontSize)) && Number(preferredFontSize) > 0
        ? Math.max(8, Math.min(220, Number(preferredFontSize)))
        : 220;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        ctx.font = `${fontWeight} ${mid}px ${family}`.trim();
        const lines = wrapWords(ctx, source, usableW, maxAllowedLines);
        const lineH = mid * 1.0;
        const totalH = lineH * lines.length;
        const maxW = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
        const fits = lines.length <= maxAllowedLines && maxW <= usableW && totalH <= usableH;
        if (fits) {
            best = { lines, fontSize: mid, family, weight: fontWeight };
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    ctx.font = `${best.weight} ${best.fontSize}px ${best.family}`.trim();
    best.lines = best.lines.slice(0, maxAllowedLines).map((line) => trimWithEllipsis(ctx, line, usableW));
    return best;
}

function drawStaticText(ctx, textElements) {
    for (const t of textElements || []) {
        if (!t.content) continue;
        ctx.save();
        const weight = t.font_weight && t.font_weight !== 'normal' ? `${t.font_weight} ` : '';
        ctx.font = `${weight}${t.font_size || 16}px ${t.font_family || 'sans-serif'}`;
        ctx.fillStyle = t.fill || '#000000';
        ctx.textAlign = t.text_anchor === 'middle' ? 'center' : t.text_anchor === 'end' ? 'right' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(t.content, t.x || 0, t.y || 0);
        ctx.restore();
    }
}

function resolveTemplateText(rawValue, content) {
    const value = String(rawValue || '');
    const link = String(content?.link || '');
    let domain = '';
    try {
        domain = link ? new URL(link).hostname.replace(/^www\./i, '') : '';
    } catch (e) {
        domain = link;
    }
    return value
        .replace(/\{\{\s*link\s*\}\}/gi, link)
        .replace(/\{\{\s*site_url\s*\}\}/gi, domain || link)
        .replace(/\{\{\s*domain\s*\}\}/gi, domain || link)
        .replace(/\s+/g, ' ')
        .trim();
}

function drawTextWithEffect(ctx, lines, positions, style) {
    const effect = style.textEffect || 'none';
    const effectColor = style.textEffectColor || '#000000';
    const offX = Number(style.textEffectOffsetX || 2);
    const offY = Number(style.textEffectOffsetY || 2);
    const blur = Number(style.textEffectBlur || 0);
    const textColor = style.textColor || '#000000';
    const align = style.textAlign || 'center';

    if (effect !== 'none') {
        ctx.save();
        ctx.fillStyle = effectColor;
        ctx.strokeStyle = effectColor;
        ctx.lineJoin = 'round';
        ctx.textAlign = align;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const position = positions[i];
            if (!position) continue;
            const { x, y } = position;
            if (effect === 'drop') {
                ctx.shadowColor = effectColor;
                ctx.shadowBlur = blur;
                ctx.fillText(line, x + offX, y + offY);
            } else if (effect === 'echo') {
                ctx.fillText(line, x + offX, y + offY);
                ctx.fillText(line, x - offX, y - offY);
            } else if (effect === 'outline') {
                ctx.lineWidth = Math.max(1, Math.abs(offX) || Math.abs(offY) || 1);
                ctx.strokeText(line, x, y);
            }
        }
        ctx.restore();
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = align;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const position = positions[i];
        if (!position) continue;
        ctx.fillText(line, position.x, position.y);
    }
}

function drawFittedTextBlock(ctx, text, rect, style) {
    const x = Number(rect?.x || 0);
    const y = Number(rect?.y || 0);
    const width = Number(rect?.width || 0);
    const height = Number(rect?.height || 0);
    if (width <= 4 || height <= 4) return;

    const fitted = fitTextBlock(ctx, text, {
        zoneW: width,
        zoneH: height,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight || '900',
        maxLines: style.maxLines || 3,
        padX: 15,
        padY: 0,
        effectMarginX: Number(style.textEffectOffsetX || 2),
        effectMarginY: Number(style.textEffectOffsetY || 2) + Number(style.textEffectBlur || 0),
        uppercase: Boolean(style.uppercase),
        preferredFontSize: Number(style.preferredFontSize || 0),
    });

    const align = style.textAlign === 'left' ? 'left' : style.textAlign === 'right' ? 'right' : 'center';
    ctx.font = `${fitted.weight} ${fitted.fontSize}px ${fitted.family}`.trim();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = align;

    const lineH = fitted.fontSize * 1.0;
    const m = ctx.measureText('A');
    const capAscent = m.actualBoundingBoxAscent || fitted.fontSize * 0.72;
    const capDescent = m.actualBoundingBoxDescent || 0;
    const visualH = capAscent + capDescent + (fitted.lines.length - 1) * lineH;
    const firstBase = y + (height - visualH) / 2 + capAscent;
    const centerX = x + (width / 2);
    const leftX = x + 15;
    const rightX = x + width - 15;

    const positions = fitted.lines.map((line, index) => {
        const lineY = firstBase + index * lineH;
        if (align === 'left') return { x: leftX, y: lineY };
        if (align === 'right') return { x: rightX, y: lineY };
        return { x: centerX, y: lineY };
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    drawTextWithEffect(ctx, fitted.lines, positions, {
        textAlign: align,
        textColor: style.textColor,
        textEffect: style.textEffect,
        textEffectColor: style.textEffectColor,
        textEffectOffsetX: style.textEffectOffsetX,
        textEffectOffsetY: style.textEffectOffsetY,
        textEffectBlur: style.textEffectBlur,
    });
    ctx.restore();
}

function parseNumericAttr(tag, name) {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
    const m = tag.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
}

function parseStringAttr(tag, name) {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
    const m = tag.match(re);
    return m ? String(m[1]) : null;
}

function parseSvgCoordinateSpace(svgContent) {
    const open = (svgContent || '').match(/<svg\b[^>]*>/i);
    if (!open) return null;
    const tag = open[0];
    const width = parseNumericAttr(tag, 'width');
    const height = parseNumericAttr(tag, 'height');
    const viewBox = parseStringAttr(tag, 'viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
    }
    if (width && height && width > 0 && height > 0) return { width, height };
    return null;
}

function overlayHasOccludingImagePlaceholders(svgContent, zones, canvasW, canvasH) {
    if (!svgContent || !Array.isArray(zones) || zones.length === 0) return false;
    if (/zoomAndPan\s*=\s*["']magnify["']/i.test(svgContent)) {
        // Canva-like exports often include local-space placeholders that can
        // cover image slots if drawn after photos.
        return true;
    }
    const svgSpace = parseSvgCoordinateSpace(svgContent);
    const scaleX = svgSpace && svgSpace.width ? canvasW / svgSpace.width : 1;
    const scaleY = svgSpace && svgSpace.height ? canvasH / svgSpace.height : 1;
    const rectTags = svgContent.match(/<rect\b[^>]*>/gi) || [];
    if (rectTags.length === 0) return false;
    const near = (a, b) => Math.abs(a - b) <= 3;

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

        const overlapsZone = zones.some((zone) =>
            near(x, Number(zone.x || 0)) &&
            near(y, Number(zone.y || 0)) &&
            near(width, Number(zone.width || 0)) &&
            near(height, Number(zone.height || 0))
        );
        if (overlapsZone) return true;
    }
    return false;
}

/**
 * Render overlay SVG to canvas
 */
async function renderOverlaySVG(svgContent, width, height) {
    if (!svgContent) return null;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);

        // Convert SVG to data URL
        const svgBase64 = Buffer.from(svgContent).toString('base64');
        img.src = `data:image/svg+xml;base64,${svgBase64}`;
    });
}

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function xmlEscapeAttr(value) {
    return xmlEscape(value);
}

function safeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function fontMimeFromPath(fontPath) {
    const ext = path.extname(String(fontPath || '')).toLowerCase();
    if (ext === '.ttf') return 'font/ttf';
    if (ext === '.otf') return 'font/otf';
    if (ext === '.woff') return 'font/woff';
    if (ext === '.woff2') return 'font/woff2';
    return 'application/octet-stream';
}

function fontFormatFromPath(fontPath) {
    const ext = path.extname(String(fontPath || '')).toLowerCase();
    if (ext === '.ttf') return 'truetype';
    if (ext === '.otf') return 'opentype';
    if (ext === '.woff') return 'woff';
    if (ext === '.woff2') return 'woff2';
    return 'truetype';
}

function resolveFontPath(fontFile) {
    if (!fontFile) return null;
    const customPath = path.resolve(
        path.join(__dirname, '..', '..', 'storage', 'fonts', String(fontFile)),
    );
    if (!fs.existsSync(customPath)) return null;
    return customPath;
}

function stripOuterSvg(svgContent) {
    const raw = String(svgContent || '').trim();
    if (!raw || raw === '<svg></svg>') return '';
    const noXml = raw.replace(/<\?xml[\s\S]*?\?>/gi, '').trim();
    const wrappedMatch = noXml.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    if (wrappedMatch) return wrappedMatch[1] || '';
    return noXml;
}

function sanitizeAliasPart(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'font';
}

function buildSvgTextLayer({
    ctx,
    lines,
    positions,
    align,
    fontFamily,
    fontWeight,
    fontSize,
    textColor,
    textEffect,
    textEffectColor,
    textEffectOffsetX,
    textEffectOffsetY,
    textEffectBlur,
    clipId,
    maxTextWidth,
    effectFilterId,
}) {
    if (!Array.isArray(lines) || lines.length === 0) return '';
    const textAnchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const family = normalizeFontFamily(fontFamily || 'sans-serif');
    const weight = String(fontWeight || '700').trim() || '700';
    const fillColor = textColor || '#000000';
    const effect = String(textEffect || 'none');
    const effectColor = textEffectColor || '#000000';
    const offX = safeNumber(textEffectOffsetX, 2);
    const offY = safeNumber(textEffectOffsetY, 2);
    const maxWidth = Math.max(0, safeNumber(maxTextWidth, 0));

    const lineElements = ({
        dx = 0,
        dy = 0,
        fill = fillColor,
        stroke = null,
        strokeWidth = 0,
        extraAttrs = '',
        filterId = null,
    }) => lines.map((line, index) => {
        const point = positions[index];
        if (!point) return '';
        const x = safeNumber(point.x) + dx;
        const y = safeNumber(point.y) + dy;
        let textLengthAttr = '';
        if (ctx && maxWidth > 0) {
            ctx.font = `${weight} ${fontSize}px ${family}`.trim();
            const measured = ctx.measureText(line).width;
            if (measured >= maxWidth * 0.97) {
                textLengthAttr = ` textLength="${maxWidth.toFixed(2)}" lengthAdjust="spacingAndGlyphs"`;
            }
        }
        const strokeAttrs = stroke
            ? ` stroke="${xmlEscapeAttr(stroke)}" stroke-width="${safeNumber(strokeWidth, 1)}" paint-order="stroke fill"`
            : '';
        const filterAttr = filterId ? ` filter="url(#${xmlEscapeAttr(filterId)})"` : '';
        return (
            `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${textAnchor}"` +
            ` font-family="${xmlEscapeAttr(family)}" font-weight="${xmlEscapeAttr(weight)}"` +
            ` font-size="${safeNumber(fontSize, 12)}" fill="${xmlEscapeAttr(fill)}"${strokeAttrs}${filterAttr}${textLengthAttr}${extraAttrs}>` +
            `${xmlEscape(line)}` +
            `</text>`
        );
    }).join('');

    const effectChunks = [];
    if (effect === 'drop') {
        effectChunks.push(
            lineElements({
                dx: offX,
                dy: offY,
                fill: effectColor,
                filterId: effectFilterId,
            }),
        );
    } else if (effect === 'echo') {
        effectChunks.push(
            lineElements({
                dx: offX,
                dy: offY,
                fill: effectColor,
                filterId: effectFilterId,
            }),
        );
        effectChunks.push(
            lineElements({
                dx: -offX,
                dy: -offY,
                fill: effectColor,
                filterId: effectFilterId,
            }),
        );
    } else if (effect === 'outline') {
        effectChunks.push(
            lineElements({
                fill: 'none',
                stroke: effectColor,
                strokeWidth: Math.max(1, Math.abs(offX) || Math.abs(offY) || 1),
            }),
        );
    }

    const mainChunk = lineElements({ fill: fillColor });
    return `<g clip-path="url(#${xmlEscapeAttr(clipId)})">${effectChunks.join('')}${mainChunk}</g>`;
}

async function renderPinWithResvg(renderData) {
    if (!resvgAvailable) {
        return { success: false, error: 'resvg-js package not available', engine: 'resvg' };
    }
    if (!canvasAvailable) {
        return { success: false, error: 'canvas package required for text measurement', engine: 'resvg' };
    }

    const payload = (renderData && typeof renderData === 'object') ? renderData : {};
    const template = (payload.template && typeof payload.template === 'object') ? payload.template : {};
    const content = (payload.content && typeof payload.content === 'object') ? payload.content : {};
    const settings = (payload.settings && typeof payload.settings === 'object') ? payload.settings : {};
    const outputPath = (typeof payload.outputPath === 'string' && payload.outputPath.trim())
        ? payload.outputPath
        : path.join(process.cwd(), 'pin_render.png');
    const width = safeNumber(template.width, 750);
    const height = safeNumber(template.height, 1575);
    const zones = Array.isArray(template.zones) ? template.zones : [];
    const imageUrls = Array.isArray(content.imageUrls)
        ? content.imageUrls
        : [content.image1Url, content.image2Url].filter(Boolean);
    const secondarySlots = Array.isArray(template.secondaryTextSlots) ? template.secondaryTextSlots : [];
    const secondaryDefaults = (template.secondaryTextDefaults && typeof template.secondaryTextDefaults === 'object')
        ? template.secondaryTextDefaults
        : {};
    const secondaryValues = (settings.secondaryTextValues && typeof settings.secondaryTextValues === 'object')
        ? settings.secondaryTextValues
        : {};

    const measureCanvas = new Canvas(Math.max(32, width), Math.max(32, height));
    const ctx = measureCanvas.getContext('2d');

    const fallbackFontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    const fontFiles = [];
    const fontFaceRules = [];
    const registeredFonts = new Set();

    const registerFontAlias = (fontFile, alias) => {
        const localPath = resolveFontPath(fontFile);
        if (!localPath) {
            throw new Error(`Custom font file not found: ${fontFile}`);
        }
        if (!registerFont) {
            throw new Error('canvas.registerFont is not available for custom font measurement');
        }
        const supportedWeights = ['400', '700', '900'];
        for (const weight of supportedWeights) {
            const dedupeKey = `${localPath}:${alias}:${weight}`;
            if (registeredFonts.has(dedupeKey)) continue;
            try {
                registerFont(localPath, { family: alias, weight });
                registeredFonts.add(dedupeKey);
            } catch (error) {
                console.error('[DEBUG] Failed to register measure font alias:', error);
                throw new Error(`Failed to register custom font ${fontFile} (${weight})`);
            }
        }
        if (!fontFiles.includes(localPath)) {
            fontFiles.push(localPath);
        }
        try {
            const bytes = fs.readFileSync(localPath);
            const mime = fontMimeFromPath(localPath);
            const format = fontFormatFromPath(localPath);
            const encoded = bytes.toString('base64');
            for (const weight of supportedWeights) {
                fontFaceRules.push(
                    `@font-face{font-family:'${xmlEscape(alias)}';src:url(data:${mime};base64,${encoded}) format('${format}');font-style:normal;font-weight:${weight};}`,
                );
            }
        } catch (error) {
            console.error('[DEBUG] Failed to inline font for SVG:', error);
            throw new Error(`Failed to inline custom font ${fontFile}`);
        }
        return alias;
    };

    if (fs.existsSync(fallbackFontPath)) {
        fontFiles.push(fallbackFontPath);
    }

    const titleCustomAlias = settings.customFontFile
        ? registerFontAlias(
            settings.customFontFile,
            `PinTitle_${sanitizeAliasPart(settings.customFontFile)}`,
        )
        : null;

    const slotAliasById = new Map();
    secondarySlots.forEach((slot, index) => {
        if (!slot || typeof slot !== 'object') return;
        if (!slot.custom_font_file) return;
        const slotId = String(slot.slot_id || `slot_${index + 1}`);
        const alias = registerFontAlias(
            slot.custom_font_file,
            `PinSlot_${sanitizeAliasPart(slotId)}_${sanitizeAliasPart(slot.custom_font_file)}`,
        );
        if (alias) slotAliasById.set(slotId, alias);
    });

    const clipPaths = [];
    const filterDefs = [];
    let filterCounter = 0;

    const textZoneY = safeNumber(template.textZoneY, 0);
    const textZoneH = safeNumber(template.textZoneHeight, 100);
    const padL = safeNumber(settings.textZonePadLeft, 0);
    const padR = safeNumber(settings.textZonePadRight, 0);
    const textAreaW = Math.max(20, width - padL - padR);

    const imageEls = [];
    zones.forEach((zone, index) => {
        const imageUrl = imageUrls[index % Math.max(1, imageUrls.length)];
        if (!imageUrl) return;
        const x = safeNumber(zone.x, 0);
        const y = safeNumber(zone.y, 0);
        const w = safeNumber(zone.width, 0);
        const h = safeNumber(zone.height, 0);
        if (w <= 1 || h <= 1) return;
        const clipId = `clip_img_${index}`;
        clipPaths.push(`<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" /></clipPath>`);
        imageEls.push(
            `<image href="${xmlEscapeAttr(imageUrl)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`,
        );
    });

    const titleText = String(content.title || '').trim();
    const titleUsesCustom = Boolean(titleCustomAlias);
    const titleFamily = titleCustomAlias || settings.fontFamily || '"Poppins", "Segoe UI", Arial, sans-serif';
    const titleWeight = titleUsesCustom ? '400' : '900';
    const titleAlign = settings.textAlign === 'left' ? 'left' : settings.textAlign === 'right' ? 'right' : 'center';
    const titleClipId = 'clip_title_zone';
    clipPaths.push(`<clipPath id="${titleClipId}"><rect x="${padL}" y="${textZoneY}" width="${textAreaW}" height="${textZoneH}" /></clipPath>`);
    let titleMarkup = '';

    if (titleText) {
        const fitted = fitTextBlock(ctx, titleText, {
            zoneW: textAreaW,
            zoneH: textZoneH,
            fontFamily: titleFamily,
            fontWeight: titleWeight,
            maxLines: 3,
            padX: 15,
            padY: 0,
            effectMarginX: safeNumber(settings.textEffectOffsetX, 2),
            effectMarginY: safeNumber(settings.textEffectOffsetY, 2) + safeNumber(settings.textEffectBlur, 0),
            uppercase: true,
        });
        const lineH = fitted.fontSize * 1.0;
        ctx.font = `${fitted.weight} ${fitted.fontSize}px ${fitted.family}`.trim();
        const metrics = ctx.measureText('A');
        const capAscent = metrics.actualBoundingBoxAscent || fitted.fontSize * 0.72;
        const capDescent = metrics.actualBoundingBoxDescent || 0;
        const visualH = capAscent + capDescent + (fitted.lines.length - 1) * lineH;
        const firstBase = textZoneY + (textZoneH - visualH) / 2 + capAscent;
        const centerX = padL + (textAreaW / 2);
        const leftX = padL + 15;
        const rightX = padL + textAreaW - 15;
        const positions = fitted.lines.map((line, index) => {
            const y = firstBase + index * lineH;
            if (titleAlign === 'left') return { x: leftX, y };
            if (titleAlign === 'right') return { x: rightX, y };
            return { x: centerX, y };
        });

        let effectFilterId = null;
        const blur = safeNumber(settings.textEffectBlur, 0);
        const effect = String(settings.textEffect || 'none');
        if (blur > 0 && (effect === 'drop' || effect === 'echo')) {
            effectFilterId = `fx_title_${filterCounter++}`;
            filterDefs.push(
                `<filter id="${effectFilterId}" x="-50%" y="-50%" width="200%" height="200%">` +
                `<feGaussianBlur stdDeviation="${blur}" />` +
                `</filter>`,
            );
        }

        titleMarkup = buildSvgTextLayer({
            ctx,
            lines: fitted.lines,
            positions,
            align: titleAlign,
            fontFamily: fitted.family,
            fontWeight: titleWeight,
            fontSize: fitted.fontSize,
            textColor: settings.textColor || '#000000',
            textEffect: settings.textEffect || 'none',
            textEffectColor: settings.textEffectColor || '#000000',
            textEffectOffsetX: safeNumber(settings.textEffectOffsetX, 2),
            textEffectOffsetY: safeNumber(settings.textEffectOffsetY, 2),
            textEffectBlur: blur,
            clipId: titleClipId,
            maxTextWidth: Math.max(20, textAreaW - 30),
            effectFilterId,
        });
    }

    const secondaryMarkup = [];
    const secondaryMaskRects = [];
    for (let i = 0; i < secondarySlots.length; i++) {
        const slot = secondarySlots[i];
        if (!slot || typeof slot !== 'object') continue;
        if (slot.enabled === false) continue;
        const slotId = String(slot.slot_id || `slot_${i + 1}`);
        const value = secondaryValues[slotId] ?? secondaryDefaults[slotId] ?? slot.default_text ?? '';
        const slotText = resolveTemplateText(value, content);
        if (!slotText) continue;

        const x = safeNumber(slot.x, 0);
        const y = safeNumber(slot.y, 0);
        const w = safeNumber(slot.width, 0);
        const h = safeNumber(slot.height, 0);
        if (w <= 4 || h <= 4) continue;

        if (slot.mask_original !== false) {
            secondaryMaskRects.push(
                `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${xmlEscapeAttr(slot.mask_color || settings.textZoneBgColor || '#ffffff')}" />`,
            );
        }

        const slotCustomAlias = slotAliasById.get(slotId) || null;
        const slotUsesCustom = Boolean(slotCustomAlias);
        const slotFamily = slotCustomAlias || slot.font_family || titleFamily;
        const slotWeight = slotUsesCustom ? '400' : (slot.font_weight || '700');
        const fitted = fitTextBlock(ctx, slotText, {
            zoneW: w,
            zoneH: h,
            fontFamily: slotFamily,
            fontWeight: slotWeight,
            maxLines: safeNumber(slot.max_lines, 2),
            padX: 15,
            padY: 0,
            effectMarginX: safeNumber(slot.text_effect_offset_x, 2),
            effectMarginY: safeNumber(slot.text_effect_offset_y, 2) + safeNumber(slot.text_effect_blur, 0),
            uppercase: Boolean(slot.uppercase),
            preferredFontSize: safeNumber(slot.font_size, 0),
        });

        const align = slot.text_align === 'left' || slot.text_align === 'right' ? slot.text_align : 'center';
        const lineH = fitted.fontSize * 1.0;
        ctx.font = `${fitted.weight} ${fitted.fontSize}px ${fitted.family}`.trim();
        const metrics = ctx.measureText('A');
        const capAscent = metrics.actualBoundingBoxAscent || fitted.fontSize * 0.72;
        const capDescent = metrics.actualBoundingBoxDescent || 0;
        const visualH = capAscent + capDescent + (fitted.lines.length - 1) * lineH;
        const firstBase = y + (h - visualH) / 2 + capAscent;
        const centerX = x + (w / 2);
        const leftX = x + 15;
        const rightX = x + w - 15;
        const positions = fitted.lines.map((line, index) => {
            const lineY = firstBase + index * lineH;
            if (align === 'left') return { x: leftX, y: lineY };
            if (align === 'right') return { x: rightX, y: lineY };
            return { x: centerX, y: lineY };
        });

        const clipId = `clip_slot_${sanitizeAliasPart(slotId)}_${i}`;
        clipPaths.push(`<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" /></clipPath>`);

        let effectFilterId = null;
        const slotBlur = safeNumber(slot.text_effect_blur, 0);
        const slotEffect = String(slot.text_effect || 'none');
        if (slotBlur > 0 && (slotEffect === 'drop' || slotEffect === 'echo')) {
            effectFilterId = `fx_slot_${filterCounter++}`;
            filterDefs.push(
                `<filter id="${effectFilterId}" x="-50%" y="-50%" width="200%" height="200%">` +
                `<feGaussianBlur stdDeviation="${slotBlur}" />` +
                `</filter>`,
            );
        }

        secondaryMarkup.push(
            buildSvgTextLayer({
                ctx,
                lines: fitted.lines,
                positions,
                align,
                fontFamily: fitted.family,
                fontWeight: slotWeight,
                fontSize: fitted.fontSize,
                textColor: slot.text_color || settings.textColor || '#000000',
                textEffect: slotEffect,
                textEffectColor: slot.text_effect_color || '#000000',
                textEffectOffsetX: safeNumber(slot.text_effect_offset_x, 2),
                textEffectOffsetY: safeNumber(slot.text_effect_offset_y, 2),
                textEffectBlur: slotBlur,
                clipId,
                maxTextWidth: Math.max(20, w - 30),
                effectFilterId,
            }),
        );
    }

    const overlayInner = stripOuterSvg(template.overlaySvg);
    const shouldDrawOverlayBeforeImages = Boolean(
        overlayInner &&
        overlayHasOccludingImagePlaceholders(template.overlaySvg, zones, width, height),
    );
    const overlayMarkup = overlayInner ? `<g id="template-overlay">${overlayInner}</g>` : '';

    const borderColor = template.textZoneBorderColor;
    const borderWidth = safeNumber(template.textZoneBorderWidth, 4);
    const borderHalf = borderWidth / 2;
    const borderRect = borderColor
        ? `<rect x="${(padL + borderHalf).toFixed(2)}" y="${(textZoneY + borderHalf).toFixed(2)}" width="${Math.max(0, textAreaW - borderWidth).toFixed(2)}" height="${Math.max(0, textZoneH - borderWidth).toFixed(2)}" fill="none" stroke="${xmlEscapeAttr(borderColor)}" stroke-width="${borderWidth}" />`
        : '';

    const defsParts = [];
    if (clipPaths.length > 0 || filterDefs.length > 0) {
        defsParts.push('<defs>');
        defsParts.push(...clipPaths);
        defsParts.push(...filterDefs);
        defsParts.push('</defs>');
    }
    const styleBlock = fontFaceRules.length > 0
        ? `<style><![CDATA[${fontFaceRules.join('')}]]></style>`
        : '';

    const svg = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        defsParts.join(''),
        styleBlock,
        `<rect width="${width}" height="${height}" fill="#ffffff" />`,
        shouldDrawOverlayBeforeImages ? overlayMarkup : '',
        imageEls.join(''),
        !shouldDrawOverlayBeforeImages ? overlayMarkup : '',
        `<rect x="${padL}" y="${textZoneY}" width="${textAreaW}" height="${textZoneH}" fill="${xmlEscapeAttr(settings.textZoneBgColor || '#ffffff')}" />`,
        borderRect,
        titleMarkup,
        secondaryMaskRects.join(''),
        secondaryMarkup.join(''),
        `</svg>`,
    ].join('');

    const outPath = path.resolve(outputPath);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const resvg = new Resvg(svg, {
        fitTo: { mode: 'original' },
        font: {
            fontFiles,
            loadSystemFonts: false,
            defaultFontFamily: 'DejaVu Sans',
        },
    });
    const pngData = resvg.render();
    fs.writeFileSync(outPath, pngData.asPng());
    return { success: true, path: outPath, engine: 'resvg' };
}

async function renderPinWithEngine(renderData) {
    const requestedEngineRaw = renderData?.renderEngine || process.env.PIN_RENDER_ENGINE || 'resvg';
    const requestedEngine = String(requestedEngineRaw).trim().toLowerCase();
    if (requestedEngine === 'canvas') {
        const canvasResult = await renderPin(renderData);
        if (canvasResult && typeof canvasResult === 'object') {
            return { ...canvasResult, engine: 'canvas' };
        }
        return { success: false, error: 'Canvas renderer failed', engine: 'canvas' };
    }
    return renderPinWithResvg(renderData);
}

/**
 * Main render function
 */
async function renderPin(renderData) {
    const payload = (renderData && typeof renderData === 'object') ? renderData : {};
    const template = (payload.template && typeof payload.template === 'object') ? payload.template : {};
    const content = (payload.content && typeof payload.content === 'object') ? payload.content : {};
    const settings = (payload.settings && typeof payload.settings === 'object') ? payload.settings : {};
    const outputPath = (typeof payload.outputPath === 'string' && payload.outputPath.trim())
        ? payload.outputPath
        : path.join(process.cwd(), 'pin_render.png');

    // Debug logging
    console.error(`[DEBUG] Rendering pin with ${template.zones.length} zones`);
        console.error(`[DEBUG] Zone count:`, (template.zones || []).length);
        console.error(`[DEBUG] Image URLs count:`, (content.imageUrls || []).length);

    try {
        const canvasW = template.width;
        const canvasH = template.height;

        console.error(`[DEBUG] Creating canvas: ${canvasW}x${canvasH}`);

        // Create canvas
        const canvas = new Canvas(canvasW, canvasH);
        const ctx = canvas.getContext('2d');

        // 1. White background
        console.error(`[DEBUG] Drawing white background`);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasW, canvasH);

        // 2. Load images
        console.error(`[DEBUG] Loading images...`);
        const imageUrls = Array.isArray(content.imageUrls)
            ? content.imageUrls
            : [content.image1Url, content.image2Url].filter(Boolean);
        const loadedImages = await Promise.all(imageUrls.map((url) => loadImage(url)));
        const availableImages = loadedImages.filter(Boolean);
        const zones = Array.isArray(template.zones) ? template.zones : [];

        console.error(`[DEBUG] Loaded images:`, availableImages.length);
        const shouldDrawOverlayBeforeImages = Boolean(
            template.overlaySvg &&
            template.overlaySvg.trim() !== '<svg></svg>' &&
            overlayHasOccludingImagePlaceholders(template.overlaySvg, zones, canvasW, canvasH)
        );

        // 3. Draw overlay SVG before images when placeholders would cover slots
        if (template.overlaySvg && template.overlaySvg.trim() !== '<svg></svg>' && shouldDrawOverlayBeforeImages) {
            console.error(`[DEBUG] Drawing overlay SVG`);
            const overlayImg = await renderOverlaySVG(template.overlaySvg, canvasW, canvasH);
            if (overlayImg) {
                ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH);
            }
        }

        // 4. Draw images
        for (let i = 0; i < zones.length; i++) {
            const z = zones[i];
            if (!z) continue;
            if (availableImages.length === 0) break;
            const img = availableImages[i % availableImages.length];
            if (img) {
                drawCoverCenter(ctx, img, z.x, z.y, z.width, z.height);
            }
        }

        // 5. Draw overlay SVG after images for normal templates
        if (template.overlaySvg && template.overlaySvg.trim() !== '<svg></svg>' && !shouldDrawOverlayBeforeImages) {
            console.error(`[DEBUG] Drawing overlay SVG`);
            const overlayImg = await renderOverlaySVG(template.overlaySvg, canvasW, canvasH);
            if (overlayImg) {
                ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH);
            }
        }

        // 6. Draw text zone background
        console.error(`[DEBUG] Drawing text zone background`);
        const textZoneY = template.textZoneY;
        const textZoneH = template.textZoneHeight;
        const padL = settings.textZonePadLeft || 0;
        const padR = settings.textZonePadRight || 0;
        const textAreaW = canvasW - padL - padR;

        ctx.fillStyle = settings.textZoneBgColor || '#ffffff';
        ctx.fillRect(padL, textZoneY, textAreaW, textZoneH);

        if (template.textZoneBorderColor) {
            const borderWidth = template.textZoneBorderWidth || 4;
            const half = borderWidth / 2;
            ctx.save();
            ctx.strokeStyle = template.textZoneBorderColor;
            ctx.lineWidth = borderWidth;
            ctx.strokeRect(padL + half, textZoneY + half, textAreaW - borderWidth, textZoneH - borderWidth);
            ctx.restore();
        }

        // Disabled by default to avoid duplicate text layers versus generated title.
        if (settings.drawTemplateStaticText) {
            drawStaticText(ctx, template.textElements);
        }

        const secondarySlots = Array.isArray(template.secondaryTextSlots) ? template.secondaryTextSlots : [];
        const hasLocalCustomFontFile = (fontFile) => {
            if (!fontFile) return false;
            const candidate = path.resolve(
                path.join(__dirname, '..', '..', 'storage', 'fonts', String(fontFile)),
            );
            return fs.existsSync(candidate);
        };
        const hasAnyCustomFont = Boolean(
            hasLocalCustomFontFile(settings.customFontFile) ||
            secondarySlots.some((slot) =>
                slot &&
                typeof slot === 'object' &&
                hasLocalCustomFontFile(slot.custom_font_file)),
        );

        const registeredFonts = new Set();
        const registerCustomFamily = (fontFile) => {
            if (!fontFile || !registerFont) return null;
            try {
                const customPath = path.resolve(
                    path.join(__dirname, '..', '..', 'storage', 'fonts', String(fontFile)),
                );
                if (!fs.existsSync(customPath)) return null;
                const family = `CustomFont_${String(fontFile).replace(/[^a-zA-Z0-9]/g, '_')}`;
                const dedupeKey = `${customPath}:${family}`;
                if (!registeredFonts.has(dedupeKey)) {
                    registerFont(customPath, { family });
                    registeredFonts.add(dedupeKey);
                }
                return family;
            } catch (fontErr) {
                console.error('[DEBUG] Failed to register custom font:', fontErr);
                return null;
            }
        };

        if (hasAnyCustomFont) {
            console.error('[DEBUG] Custom font detected; deferring text rendering to Pillow overlay');
        } else {
            const customTitleFamily = registerCustomFamily(settings.customFontFile);
            const titleFontFamily = customTitleFamily || settings.fontFamily || '"Poppins", "Segoe UI", Arial, sans-serif';
            const titleFontWeight = customTitleFamily ? '' : '900';
            const titleText = content.title || '';
            if (titleText) {
                drawFittedTextBlock(ctx, titleText, {
                    x: padL,
                    y: textZoneY,
                    width: textAreaW,
                    height: textZoneH,
                }, {
                    fontFamily: titleFontFamily,
                    fontWeight: titleFontWeight,
                    textAlign: settings.textAlign === 'left' ? 'left' : 'center',
                    textColor: settings.textColor || '#000000',
                    textEffect: settings.textEffect || 'none',
                    textEffectColor: settings.textEffectColor || '#000000',
                    textEffectOffsetX: Number(settings.textEffectOffsetX || 2),
                    textEffectOffsetY: Number(settings.textEffectOffsetY || 2),
                    textEffectBlur: Number(settings.textEffectBlur || 0),
                    maxLines: 3,
                    uppercase: true,
                });
            }

            // 6. Draw editable secondary text slots.
            const secondaryDefaults = (template.secondaryTextDefaults && typeof template.secondaryTextDefaults === 'object')
                ? template.secondaryTextDefaults
                : {};
            const secondaryValues = (settings.secondaryTextValues && typeof settings.secondaryTextValues === 'object')
                ? settings.secondaryTextValues
                : {};

            for (const slot of secondarySlots) {
                if (!slot || typeof slot !== 'object') continue;
                if (slot.enabled === false) continue;
                const slotId = String(slot.slot_id || '').trim();
                if (!slotId) continue;

                const slotValueRaw = secondaryValues[slotId] ?? secondaryDefaults[slotId] ?? slot.default_text ?? '';
                const slotText = resolveTemplateText(slotValueRaw, content);
                if (!slotText) continue;

                const slotRect = {
                    x: Number(slot.x || 0),
                    y: Number(slot.y || 0),
                    width: Number(slot.width || 0),
                    height: Number(slot.height || 0),
                };
                if (slotRect.width <= 4 || slotRect.height <= 4) continue;

                if (slot.mask_original !== false) {
                    ctx.save();
                    ctx.fillStyle = slot.mask_color || settings.textZoneBgColor || '#ffffff';
                    ctx.fillRect(slotRect.x, slotRect.y, slotRect.width, slotRect.height);
                    ctx.restore();
                }

                const slotCustomFamily = registerCustomFamily(slot.custom_font_file);
                drawFittedTextBlock(ctx, slotText, slotRect, {
                    fontFamily: slotCustomFamily || slot.font_family || titleFontFamily,
                    fontWeight: slotCustomFamily ? '' : (slot.font_weight || '700'),
                    textAlign: slot.text_align || 'center',
                    textColor: slot.text_color || settings.textColor || '#000000',
                    textEffect: slot.text_effect || 'none',
                    textEffectColor: slot.text_effect_color || '#000000',
                textEffectOffsetX: Number(slot.text_effect_offset_x ?? 2),
                textEffectOffsetY: Number(slot.text_effect_offset_y ?? 2),
                textEffectBlur: Number(slot.text_effect_blur ?? 0),
                maxLines: Number(slot.max_lines || 2),
                uppercase: Boolean(slot.uppercase),
                preferredFontSize: Number(slot.font_size || 0),
            });
        }
        }

        // Save to file
        console.error(`[DEBUG] Saving to file: ${outputPath}`);
        const outPath = path.resolve(outputPath);
        const outDir = path.dirname(outPath);

        // Ensure output directory exists
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        // Write PNG
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(outPath, buffer);

        console.error(`[DEBUG] Successfully saved ${buffer.length} bytes`);

        return { success: true, path: outPath };
    } catch (error) {
        console.error(`[DEBUG] Render error:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Main entry point
 */
async function main() {
    const dataFile = process.argv[2];
    if (!dataFile) {
        console.error(JSON.stringify({ success: false, error: 'No data file provided' }));
        process.exit(1);
    }

    // Check if canvas is available
    if (!canvasAvailable) {
        console.error(JSON.stringify({
            success: false,
            error: 'Canvas package not available. Install with: npm install canvas'
        }));
        process.exit(1);
    }

    try {
        // Read render data
        const dataContent = fs.readFileSync(dataFile, 'utf8');
        const renderData = JSON.parse(dataContent);

        // Render pin
        const result = await renderPinWithEngine(renderData);

        console.log(JSON.stringify(result));
        process.exit(result.success ? 0 : 1);

    } catch (error) {
        console.error(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
    }
}

// Run
if (require.main === module) {
    main().catch((error) => {
        console.error(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
    });
}

module.exports = { renderPin, renderPinWithEngine, renderPinWithResvg };
