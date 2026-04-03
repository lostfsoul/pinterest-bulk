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

/**
 * Fit title text into zone with optimal font size and line breaks
 */
function fitTitle(ctx, text, zoneW, zoneH, fontFamily, fontWeight = '900') {
    // Normalize font family string for canvas
    fontFamily = fontFamily
        .replace(/^["']|["']$/g, '')
        .replace(/["']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const upper = safeUpperCase(text);
    const usableW = zoneW - 30; // 15px padding each side
    const usableH = zoneH;
    const words = upper.split(' ');

    let best = { lines: [upper], fontSize: 14 };

    const tryLines = (lines) => {
        // Binary search for max font size
        let lo = 12, hi = 200, bestFs = 12;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            ctx.font = `${fontWeight} ${mid}px ${fontFamily}`.trim();
            const lineH = mid * 1.0;
            const totalH = lines.length * lineH;
            const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));

            if (maxW <= usableW && totalH <= usableH) {
                bestFs = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (bestFs > best.fontSize) {
            best = { lines, fontSize: bestFs };
        }
    };

    // Try 1 line
    tryLines([upper]);

    // Try 2-line splits
    if (words.length >= 2) {
        for (let i = 1; i < words.length; i++) {
            tryLines([
                words.slice(0, i).join(' '),
                words.slice(i).join(' ')
            ]);
        }
    }

    // Try 3-line splits
    if (words.length >= 4) {
        for (let i = 1; i < words.length - 1; i++) {
            for (let j = i + 1; j < words.length; j++) {
                tryLines([
                    words.slice(0, i).join(' '),
                    words.slice(i, j).join(' '),
                    words.slice(j).join(' ')
                ]);
            }
        }
    }

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

function drawTextWithEffect(ctx, lines, centerX, firstBase, lineH, textColor, settings) {
    const effect = settings.textEffect || 'none';
    const effectColor = settings.textEffectColor || '#000000';
    const offX = Number(settings.textEffectOffsetX || 2);
    const offY = Number(settings.textEffectOffsetY || 2);
    const blur = Number(settings.textEffectBlur || 0);

    if (effect !== 'none') {
        ctx.save();
        ctx.fillStyle = effectColor;
        ctx.strokeStyle = effectColor;
        ctx.lineJoin = 'round';
        for (let i = 0; i < lines.length; i++) {
            const y = firstBase + i * lineH;
            if (effect === 'drop') {
                ctx.shadowColor = effectColor;
                ctx.shadowBlur = blur;
                ctx.fillText(lines[i], centerX + offX, y + offY);
            } else if (effect === 'echo') {
                ctx.fillText(lines[i], centerX + offX, y + offY);
                ctx.fillText(lines[i], centerX - offX, y - offY);
            } else if (effect === 'outline') {
                ctx.lineWidth = Math.max(1, offX);
                ctx.strokeText(lines[i], centerX, y);
            }
        }
        ctx.restore();
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = settings.textAlign === 'left' ? 'left' : 'center';
    const textX = settings.textAlign === 'left'
        ? (settings.textZonePadLeft || 0) + 15
        : centerX;
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], textX, firstBase + i * lineH);
    }
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

/**
 * Main render function
 */
async function renderPin(renderData) {
    const { template, content, settings, outputPath } = renderData;

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

        // 5. Draw title text
        const title = content.title || '';
        if (title) {
            console.error(`[DEBUG] Drawing title: "${title}"`);
            let fontFamily = settings.fontFamily || '"Bebas Neue", Impact, sans-serif';
            const textColor = settings.textColor || '#000000';
            let fontWeight = '900';

            // Normalize font family string - handle quoted font names for canvas
            // Canvas expects font names without surrounding quotes, or with proper escaping
            fontFamily = fontFamily
                .replace(/^["']|["']$/g, '') // Remove surrounding quotes
                .replace(/["']/g, ' ')        // Replace inner quotes with space
                .replace(/\s+/g, ' ')          // Collapse multiple spaces
                .trim();

            if (settings.customFontFile && registerFont) {
                try {
                    const customPath = path.resolve(
                        path.join(__dirname, '..', '..', 'storage', 'fonts', settings.customFontFile)
                    );
                    if (fs.existsSync(customPath)) {
                        const registeredFamily = `CustomFont_${String(settings.customFontFile).replace(/[^a-zA-Z0-9]/g, '_')}`;
                        registerFont(customPath, { family: registeredFamily });
                        fontFamily = registeredFamily;
                        // Avoid font fallback when the uploaded file only has regular weight.
                        fontWeight = '';
                    }
                } catch (fontErr) {
                    console.error('[DEBUG] Failed to register custom font:', fontErr);
                }
            }

            const { lines, fontSize } = fitTitle(
                ctx,
                title,
                canvasW - padL - padR,
                textZoneH,
                fontFamily,
                fontWeight,
            );

            const lineH = fontSize * 1.0;
            const centerX = padL + (canvasW - padL - padR) / 2;

            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`.trim();
            ctx.fillStyle = textColor;
            ctx.textAlign = settings.textAlign === 'left' ? 'left' : 'center';
            ctx.textBaseline = 'alphabetic';

            // Center text vertically using cap height
            const m = ctx.measureText('A');
            const capAscent = m.actualBoundingBoxAscent || fontSize * 0.72;
            const capDescent = m.actualBoundingBoxDescent || 0;
            const capH = capAscent + capDescent;
            const visualH = capH + (lines.length - 1) * lineH;
            const firstBase = textZoneY + (textZoneH - visualH) / 2 + capAscent;

            drawTextWithEffect(
                ctx,
                lines,
                centerX,
                firstBase,
                lineH,
                textColor,
                settings,
            );
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
        const result = await renderPin(renderData);

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

module.exports = { renderPin };
