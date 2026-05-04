import type { PlaygroundFontSet } from '../services/api';

export const DEFAULT_PLAYGROUND_TEXT_SETTINGS = {
  fontColor: '#1a1a1a',
  titleScale: 1,
  titlePaddingX: 15,
  lineHeightMultiplier: 1,
};

export function clampTitleScale(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.7, Math.min(1.6, parsed)) : DEFAULT_PLAYGROUND_TEXT_SETTINGS.titleScale;
}

export function clampTitlePaddingX(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(8, Math.min(36, parsed)) : DEFAULT_PLAYGROUND_TEXT_SETTINGS.titlePaddingX;
}

export function clampLineHeightMultiplier(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.8, Math.min(1.35, parsed)) : DEFAULT_PLAYGROUND_TEXT_SETTINGS.lineHeightMultiplier;
}

export function normalizeFontSets(fonts: PlaygroundFontSet[]): PlaygroundFontSet[] {
  const seenPresetFamilies = new Set<string>();
  const seenCustomFiles = new Set<string>();
  const seenCustomFamilies = new Set<string>();
  const result: PlaygroundFontSet[] = [];

  const normalizeFamily = (value: string): string => (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
  );

  for (const font of fonts) {
    const id = String(font.id || '').trim();
    if (!id) continue;
    if (!id.startsWith('custom:')) {
      const presetFamilyKey = normalizeFamily(String(font.main || '')) || id.toLowerCase();
      if (seenPresetFamilies.has(presetFamilyKey)) continue;
      seenPresetFamilies.add(presetFamilyKey);
      result.push(font);
      continue;
    }
    const fileKey = String(font.font_file || '').trim().toLowerCase()
      || id.replace(/^custom:/i, '').trim().toLowerCase();
    if (fileKey && seenCustomFiles.has(fileKey)) continue;

    const familyKey = normalizeFamily(String(font.main || '')) || fileKey || id.toLowerCase();
    if (seenCustomFamilies.has(familyKey)) continue;
    if (fileKey) seenCustomFiles.add(fileKey);
    seenCustomFamilies.add(familyKey);
    result.push(font);
  }

  return result;
}
