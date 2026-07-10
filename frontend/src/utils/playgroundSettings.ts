import type { PlaygroundFontSet } from '../services/api';

export const DEFAULT_PLAYGROUND_TEXT_SETTINGS = {
  fontColor: '#1a1a1a',
  titleScale: 1,
  titlePaddingX: 15,
  lineHeightMultiplier: 1,
  letterSpacing: 0,
  uppercase: true,
  maxLines: 3,
  textEffect: 'none' as 'none' | 'drop' | 'echo' | 'outline',
  textEffectColor: '#000000',
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

export function clampLetterSpacing(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(-20, Math.min(40, parsed)) : DEFAULT_PLAYGROUND_TEXT_SETTINGS.letterSpacing;
}

export function clampMaxLines(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(8, Math.round(parsed))) : DEFAULT_PLAYGROUND_TEXT_SETTINGS.maxLines;
}

export function normalizeTextEffect(value: unknown): 'none' | 'drop' | 'echo' | 'outline' {
  const raw = String(value || 'none').toLowerCase();
  return raw === 'drop' || raw === 'echo' || raw === 'outline' ? raw : 'none';
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
