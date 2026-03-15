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
let Canvas, Image, ImageData;

try {
    const canvasModule = require('canvas');
    Canvas = canvasModule.Canvas;
    Image = canvasModule.Image;
    ImageData = canvasModule.ImageData;
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
 * Fit title text into zone with optimal font size and line breaks
 */
function fitTitle(ctx, text, zoneW, zoneH, fontFamily) {
    const upper = text.toUpperCase();
    const usableW = zoneW - 30; // 15px padding each side
    const usableH = zoneH;
    const words = upper.split(' ');

    let best = { lines: [upper], fontSize: 14 };

    const tryLines = (lines) => {
        // Binary search for max font size
        let lo = 12, hi = 200, bestFs = 12;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            ctx.font = `900 ${mid}px ${fontFamily}`;
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
    console.error(`[DEBUG] Zone 0:`, template.zones[0]);
    console.error(`[DEBUG] Zone 1:`, template.zones[1]);
    console.error(`[DEBUG] Image URLs:`, content.image1Url, content.image2Url);

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

        // 2. Load and draw images
        console.error(`[DEBUG] Loading images...`);
        const img1 = await loadImage(content.image1Url);
        const img2 = await loadImage(content.image2Url);

        console.error(`[DEBUG] img1 loaded:`, img1 ? `Yes (${img1.width || img1.naturalWidth}x${img1.height || img1.naturalHeight})` : 'No');
        console.error(`[DEBUG] img2 loaded:`, img2 ? `Yes (${img2.width || img2.naturalWidth}x${img2.height || img2.naturalHeight})` : 'No');

        if (template.zones[0] && img1) {
            console.error(`[DEBUG] Drawing img1 in zone 0`);
            const z = template.zones[0];
            drawCoverCenter(ctx, img1, z.x, z.y, z.width, z.height);
        }

        if (template.zones[1] && img2) {
            console.error(`[DEBUG] Drawing img2 in zone 1`);
            const z = template.zones[1];
            drawCoverCenter(ctx, img2, z.x, z.y, z.width, z.height);
        }

        // 3. Draw text zone background
        console.error(`[DEBUG] Drawing text zone background`);
        const textZoneY = template.textZoneY;
        const textZoneH = template.textZoneHeight;
        const padL = settings.textZonePadLeft || 0;
        const padR = settings.textZonePadRight || 0;
        const textAreaW = canvasW - padL - padR;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(padL, textZoneY, textAreaW, textZoneH);

        // 4. Draw overlay SVG
        if (template.overlaySvg && template.overlaySvg.trim() !== '<svg></svg>') {
            console.error(`[DEBUG] Drawing overlay SVG`);
            const overlayImg = await renderOverlaySVG(template.overlaySvg, canvasW, canvasH);
            if (overlayImg) {
                ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH);
            }
        }

        if (template.textZoneBorderColor) {
            const borderWidth = template.textZoneBorderWidth || 4;
            const half = borderWidth / 2;
            ctx.save();
            ctx.strokeStyle = template.textZoneBorderColor;
            ctx.lineWidth = borderWidth;
            ctx.strokeRect(padL + half, textZoneY + half, textAreaW - borderWidth, textZoneH - borderWidth);
            ctx.restore();
        }

        drawStaticText(ctx, template.textElements);

        // 5. Draw title text
        const title = content.title || '';
        if (title) {
            console.error(`[DEBUG] Drawing title: "${title}"`);
            const fontFamily = settings.fontFamily || '"Bebas Neue", Impact, sans-serif';
            const textColor = settings.textColor || '#000000';

            const { lines, fontSize } = fitTitle(
                ctx,
                title,
                canvasW - padL - padR,
                textZoneH,
                fontFamily
            );

            const lineH = fontSize * 1.0;
            const centerX = padL + (canvasW - padL - padR) / 2;

            ctx.font = `900 ${fontSize}px ${fontFamily}`;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';

            // Center text vertically using cap height
            const m = ctx.measureText('A');
            const capAscent = m.actualBoundingBoxAscent || fontSize * 0.72;
            const capDescent = m.actualBoundingBoxDescent || 0;
            const capH = capAscent + capDescent;
            const visualH = capH + (lines.length - 1) * lineH;
            const firstBase = textZoneY + (textZoneH - visualH) / 2 + capAscent;

            lines.forEach((line, i) => {
                ctx.fillText(line, centerX, firstBase + i * lineH);
            });
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
