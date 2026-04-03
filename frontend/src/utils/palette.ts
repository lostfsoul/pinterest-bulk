export type PaletteMode = 'auto' | 'brand' | 'manual';

export type EditablePalette = {
  background: string;
  text: string;
  effect: string;
};

export function normalizeHexColor(value: string | null | undefined, fallback: string): string {
  const raw = (value || '').trim();
  if (!raw) return fallback;
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-f]{3}$/i.test(prefixed)) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  if (!/^#[0-9a-f]{6}$/i.test(prefixed)) return fallback;
  return prefixed.toLowerCase();
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = normalizeHexColor(value, '#000000');
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

function mixRgb(
  start: [number, number, number],
  end: [number, number, number],
  ratio: number,
): [number, number, number] {
  const amount = Math.max(0, Math.min(1, ratio));
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ] as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function derivePaletteFromHex(baseColor: string): EditablePalette {
  const baseRgb = hexToRgb(baseColor);
  const baseLuminance = luminance(baseRgb);
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [17, 24, 39];

  const surfaceMix = baseLuminance < 0.55 ? 0.78 : 0.58;
  const surfaceRgb = mixRgb(baseRgb, white, surfaceMix);

  const darkCandidate = mixRgb(baseRgb, black, 0.78);
  const lightCandidate = mixRgb(baseRgb, white, 0.9);
  let textRgb = contrastRatio(darkCandidate, surfaceRgb) >= contrastRatio(lightCandidate, surfaceRgb)
    ? darkCandidate
    : lightCandidate;
  if (contrastRatio(textRgb, surfaceRgb) < 4.2) {
    textRgb = contrastRatio(black, surfaceRgb) >= contrastRatio(white, surfaceRgb) ? black : white;
  }

  const effectTarget = luminance(textRgb) < 0.45 ? white : black;
  let effectRgb = mixRgb(baseRgb, effectTarget, 0.45);
  if (contrastRatio(effectRgb, textRgb) < 1.25) {
    effectRgb = effectTarget;
  }

  return {
    background: rgbToHex(surfaceRgb),
    text: rgbToHex(textRgb),
    effect: rgbToHex(effectRgb),
  };
}

export async function sampleImagePalette(imageUrl: string): Promise<EditablePalette | null> {
  if (!imageUrl) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          if (alpha < 8) continue;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count += 1;
        }
        if (!count) {
          resolve(null);
          return;
        }
        const average = rgbToHex([red / count, green / count, blue / count] as [number, number, number]);
        resolve(derivePaletteFromHex(average));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = imageUrl;
  });
}
