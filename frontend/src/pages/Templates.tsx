import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fabric } from 'fabric';
import * as opentype from 'opentype.js';
import { createWorker } from 'tesseract.js';

import { Button } from '../components/Button';
import apiClient, { Template, TemplateOCRResult } from '../services/api';

type TextAlign = 'left' | 'center' | 'right';
type ZoneType = 'main_text' | 'secondary_text' | 'image';
type SourceType = 'svg_text' | 'ocr_image' | 'vector_path_cluster' | 'svg_image';

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ManifestTextStyle = {
  font_family: string;
  font_size: number;
  font_weight: number;
  fill: string;
  align: TextAlign;
  font_file?: string | null;
};

type ManifestReplacement = {
  text: string;
  font_family: string;
  font_file?: string | null;
};

type ManifestZone = {
  id: string;
  type: ZoneType;
  source_type: SourceType;
  editable: boolean;
  confidence: number;
  bounds: Bounds;
  text?: string;
  style?: ManifestTextStyle;
  replacement?: ManifestReplacement;
};

type TemplateManifestV2 = {
  version: 2;
  canvas: {
    source_width: number;
    source_height: number;
    target_width: number;
    target_height: number;
  };
  zones: ManifestZone[];
  assets: Array<{
    id: string;
    type: 'image';
    bounds: Bounds;
    href: string;
  }>;
  meta: {
    detected_at: string;
    needs_review: boolean;
    strategy: string;
  };
};

type ZoneTextbox = {
  zoneId?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  set: (props: Record<string, unknown>) => void;
} & Record<string, unknown>;

type FontItem = {
  filename: string;
  family: string;
};

const BUILTIN_FONT_OPTIONS = ['Poppins', 'Montserrat', 'Oswald', 'Bebas Neue', 'Arial', 'Georgia'];

function clampInt(value: unknown, fallback = 0, min = Number.MIN_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(min, fallback);
  }
  return Math.max(min, Math.round(parsed));
}

function normalizeAlign(value: unknown, fallback: TextAlign = 'center'): TextAlign {
  const parsed = String(value || fallback).trim().toLowerCase();
  if (parsed === 'left' || parsed === 'center' || parsed === 'right') {
    return parsed;
  }
  return fallback;
}

function normalizeColor(value: unknown, fallback = '#111111'): string {
  const parsed = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(parsed) || /^#[0-9a-f]{6}$/.test(parsed)) {
    return parsed;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeZoneType(value: unknown): ZoneType {
  const parsed = String(value || '').trim().toLowerCase();
  if (parsed === 'main_text' || parsed === 'secondary_text' || parsed === 'image') {
    return parsed;
  }
  return 'secondary_text';
}

function sanitizeSourceType(value: unknown): SourceType {
  const parsed = String(value || '').trim().toLowerCase();
  if (parsed === 'svg_text' || parsed === 'ocr_image' || parsed === 'vector_path_cluster' || parsed === 'svg_image') {
    return parsed;
  }
  return 'ocr_image';
}

function normalizeManifest(raw: unknown, width: number, height: number): TemplateManifestV2 {
  const source = isRecord(raw) ? raw : {};
  const canvasRaw = isRecord(source.canvas) ? source.canvas : {};

  const zonesRaw = Array.isArray(source.zones) ? source.zones : [];
  const zones: ManifestZone[] = zonesRaw
    .filter((zone): zone is Record<string, unknown> => isRecord(zone))
    .map((zone, index) => {
      const boundsRaw = isRecord(zone.bounds) ? zone.bounds : {};
      const zoneType = sanitizeZoneType(zone.type);
      const base: ManifestZone = {
        id: String(zone.id || `zone_${index + 1}`),
        type: zoneType,
        source_type: sanitizeSourceType(zone.source_type),
        editable: zone.editable !== false && zoneType !== 'image',
        confidence: Math.max(0, Math.min(1, Number(zone.confidence) || 0)),
        bounds: {
          x: clampInt(boundsRaw.x, 0),
          y: clampInt(boundsRaw.y, 0),
          width: clampInt(boundsRaw.width, 1, 1),
          height: clampInt(boundsRaw.height, 1, 1),
        },
      };

      if (zoneType === 'image') {
        return base;
      }

      const styleRaw = isRecord(zone.style) ? zone.style : {};
      const replacementRaw = isRecord(zone.replacement) ? zone.replacement : {};

      return {
        ...base,
        text: String(zone.text || ''),
        style: {
          font_family: String(styleRaw.font_family || 'Poppins'),
          font_size: clampInt(styleRaw.font_size, zoneType === 'main_text' ? 48 : 24, 8),
          font_weight: clampInt(styleRaw.font_weight, 700, 100),
          fill: normalizeColor(styleRaw.fill, '#111111'),
          align: normalizeAlign(styleRaw.align, 'center'),
          font_file: String(styleRaw.font_file || '').trim() || null,
        },
        replacement: {
          text: String(replacementRaw.text ?? zone.text ?? ''),
          font_family: String(replacementRaw.font_family || styleRaw.font_family || 'Poppins'),
          font_file: String(replacementRaw.font_file || styleRaw.font_file || '').trim() || null,
        },
      };
    });

  const assetsRaw = Array.isArray(source.assets) ? source.assets : [];
  const assets = assetsRaw
    .filter((asset): asset is Record<string, unknown> => isRecord(asset))
    .map((asset, index) => {
      const boundsRaw = isRecord(asset.bounds) ? asset.bounds : {};
      return {
        id: String(asset.id || `asset_${index + 1}`),
        type: 'image' as const,
        bounds: {
          x: clampInt(boundsRaw.x, 0),
          y: clampInt(boundsRaw.y, 0),
          width: clampInt(boundsRaw.width, 1, 1),
          height: clampInt(boundsRaw.height, 1, 1),
        },
        href: String(asset.href || ''),
      };
    });

  const metaRaw = isRecord(source.meta) ? source.meta : {};

  return {
    version: 2,
    canvas: {
      source_width: clampInt(canvasRaw.source_width, width, 1),
      source_height: clampInt(canvasRaw.source_height, height, 1),
      target_width: clampInt(canvasRaw.target_width, width, 1),
      target_height: clampInt(canvasRaw.target_height, height, 1),
    },
    zones,
    assets,
    meta: {
      detected_at: String(metaRaw.detected_at || new Date().toISOString()),
      needs_review: Boolean(metaRaw.needs_review),
      strategy: String(metaRaw.strategy || 'detection-first'),
    },
  };
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadFabricImage(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    fabric.Image.fromURL(
      url,
      (image: unknown) => {
        if (!image) {
          reject(new Error('Could not load SVG image preview.'));
          return;
        }
        resolve(image);
      },
      { crossOrigin: 'anonymous' },
    );
  });
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [formData, setFormData] = useState<{ name: string; file: File | null }>({ name: '', file: null });

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editorSvg, setEditorSvg] = useState('');
  const [manifest, setManifest] = useState<TemplateManifestV2 | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [fonts, setFonts] = useState<FontItem[]>([]);
  const [uploadingFont, setUploadingFont] = useState(false);

  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_website_id');
    const parsed = Number(stored || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [defaultTemplateId, setDefaultTemplateId] = useState<number | null>(null);

  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<any>(null);
  const drawSequenceRef = useRef(0);
  const fontRegistryRef = useRef<Set<string>>(new Set());
  const zoneObjectsRef = useRef<Record<string, ZoneTextbox>>({});

  const fontByFamily = useMemo(() => {
    const map = new Map<string, FontItem>();
    for (const item of fonts) {
      map.set(item.family, item);
    }
    return map;
  }, [fonts]);

  const fontOptions = useMemo(() => {
    const merged = [...BUILTIN_FONT_OPTIONS, ...fonts.map((font) => font.family)];
    return Array.from(new Set(merged));
  }, [fonts]);

  const editableZones = useMemo(
    () => (manifest?.zones || []).filter((zone) => zone.type !== 'image' && zone.editable),
    [manifest],
  );

  const selectedZone = useMemo(
    () => editableZones.find((zone) => zone.id === selectedZoneId) || null,
    [editableZones, selectedZoneId],
  );

  const ensureFontFace = useCallback(async (family: string, filename: string | null | undefined) => {
    const safeFamily = String(family || '').trim();
    const safeFilename = String(filename || '').trim();
    if (!safeFamily || !safeFilename) {
      return;
    }

    const key = `${safeFamily}::${safeFilename}`;
    if (fontRegistryRef.current.has(key)) {
      return;
    }

    const fontFace = new FontFace(safeFamily, `url(/api/templates/fonts/${encodeURIComponent(safeFilename)})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    fontRegistryRef.current.add(key);
  }, []);

  const loadDefaultTemplate = useCallback(async (websiteId: number | null) => {
    if (!websiteId) {
      setDefaultTemplateId(null);
      return;
    }

    try {
      const response = await apiClient.getWebsiteGenerationSettings(websiteId);
      const settings = response.data.settings || {};
      const design = (typeof settings.design === 'object' && settings.design)
        ? settings.design as Record<string, unknown>
        : (typeof settings.design_settings === 'object' && settings.design_settings)
          ? settings.design_settings as Record<string, unknown>
          : {};
      const ids = Array.isArray(design.template_ids) ? design.template_ids : [];
      const first = Number(ids[0]);
      setDefaultTemplateId(Number.isFinite(first) ? first : null);
    } catch (error) {
      console.error('Failed to load default template:', error);
      setDefaultTemplateId(null);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const [templatesRes, fontsRes] = await Promise.all([
        apiClient.listTemplates(),
        apiClient.listTemplateFonts(),
      ]);
      setTemplates(templatesRes.data);
      setFonts(fontsRes.data.fonts || []);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setErrorMessage('Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    void loadDefaultTemplate(activeWebsiteId);
  }, [activeWebsiteId, loadDefaultTemplate]);

  useEffect(() => {
    const onSwitch = (event: Event) => {
      const custom = event as CustomEvent<number>;
      const next = Number(custom.detail || 0);
      if (Number.isFinite(next) && next > 0) {
        setActiveWebsiteId(next);
        localStorage.setItem('active_website_id', String(next));
      } else {
        setActiveWebsiteId(null);
      }
    };
    window.addEventListener('website-switch', onSwitch as EventListener);
    return () => window.removeEventListener('website-switch', onSwitch as EventListener);
  }, []);

  useEffect(() => {
    if (!manifest) {
      setSelectedZoneId(null);
      return;
    }
    const first = manifest.zones.find((zone) => zone.type !== 'image' && zone.editable);
    if (!first) {
      setSelectedZoneId(null);
      return;
    }
    if (!selectedZoneId || !manifest.zones.some((zone) => zone.id === selectedZoneId)) {
      setSelectedZoneId(first.id);
    }
  }, [manifest, selectedZoneId]);

  useEffect(() => {
    if (!canvasElementRef.current) {
      return;
    }

    const canvas = new fabric.Canvas(canvasElementRef.current, {
      preserveObjectStacking: true,
      selection: true,
      backgroundColor: '#f8fafc',
    });

    canvas.on('object:modified', (event: { target?: ZoneTextbox }) => {
      const target = event.target as ZoneTextbox | undefined;
      const zoneId = target?.zoneId;
      if (!zoneId) {
        return;
      }

      const left = clampInt(target.left, 0);
      const top = clampInt(target.top, 0);
      const width = clampInt((target.width || 1) * (target.scaleX || 1), 1, 1);
      const height = clampInt((target.height || 1) * (target.scaleY || 1), 1, 1);
      target.set({ left, top, width, height, scaleX: 1, scaleY: 1 });

      setManifest((previous) => {
        if (!previous) {
          return previous;
        }
        const zones = previous.zones.map((zone) => {
          if (zone.id !== zoneId) {
            return zone;
          }
          return {
            ...zone,
            bounds: {
              ...zone.bounds,
              x: left,
              y: top,
              width,
              height,
            },
          };
        });
        return { ...previous, zones };
      });
    });

    canvas.on('selection:created', (event: { selected?: ZoneTextbox[] }) => {
      const selected = (event.selected && event.selected[0]) as ZoneTextbox | undefined;
      if (selected?.zoneId) {
        setSelectedZoneId(selected.zoneId);
      }
    });

    canvas.on('selection:updated', (event: { selected?: ZoneTextbox[] }) => {
      const selected = (event.selected && event.selected[0]) as ZoneTextbox | undefined;
      if (selected?.zoneId) {
        setSelectedZoneId(selected.zoneId);
      }
    });

    canvasRef.current = canvas;
    return () => {
      canvas.dispose();
      canvasRef.current = null;
      zoneObjectsRef.current = {};
    };
  }, []);

  const drawCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest || !editorSvg) {
      if (canvas) {
        canvas.clear();
      }
      return;
    }

    const seq = drawSequenceRef.current + 1;
    drawSequenceRef.current = seq;

    const canvasWidth = manifest.canvas.target_width;
    const canvasHeight = manifest.canvas.target_height;

    try {
      const textZones = manifest.zones.filter((zone) => zone.type !== 'image');
      for (const zone of textZones) {
        const fontFile = zone.replacement?.font_file || zone.style?.font_file || null;
        const family = zone.replacement?.font_family || zone.style?.font_family || 'Poppins';
        if (fontFile) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await ensureFontFace(family, fontFile);
          } catch (error) {
            console.warn('Could not load custom font for preview:', error);
          }
        }
      }

      const background = await loadFabricImage(svgToDataUrl(editorSvg)) as any;
      if (seq !== drawSequenceRef.current) {
        return;
      }

      canvas.clear();
      canvas.setWidth(canvasWidth);
      canvas.setHeight(canvasHeight);

      background.set({
        selectable: false,
        evented: false,
        left: 0,
        top: 0,
      });
      background.scaleToWidth(canvasWidth);
      background.scaleToHeight(canvasHeight);
      canvas.add(background);

      const nextZoneMap: Record<string, ZoneTextbox> = {};

      for (const zone of manifest.zones) {
        const bounds = zone.bounds;
        if (zone.type === 'image') {
          const imageRect = new fabric.Rect({
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            fill: 'rgba(56, 189, 248, 0.12)',
            stroke: '#0284c7',
            strokeWidth: 1,
            strokeDashArray: [6, 4],
            selectable: false,
            evented: false,
          });
          canvas.add(imageRect);
          continue;
        }

        const isSelected = zone.id === selectedZoneId;
        const style = zone.style || {
          font_family: 'Poppins',
          font_size: zone.type === 'main_text' ? 48 : 24,
          font_weight: 700,
          fill: '#111111',
          align: 'center' as TextAlign,
          font_file: null,
        };
        const replacement = zone.replacement || {
          text: zone.text || '',
          font_family: style.font_family,
          font_file: style.font_file,
        };

        const overlay = new fabric.Rect({
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          fill: zone.type === 'main_text' ? 'rgba(248,113,113,0.16)' : 'rgba(244,114,182,0.16)',
          stroke: isSelected ? '#dc2626' : '#be185d',
          strokeWidth: isSelected ? 2 : 1,
          selectable: false,
          evented: false,
        });

        const textObject = new fabric.Textbox(replacement.text || zone.text || '', {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          fontFamily: replacement.font_family || style.font_family || 'Poppins',
          fontSize: style.font_size,
          fontWeight: String(style.font_weight),
          fill: style.fill,
          textAlign: style.align,
          lineHeight: 1.05,
          editable: false,
          transparentCorners: false,
          cornerColor: '#dc2626',
          borderColor: '#dc2626',
          lockRotation: true,
          lockSkewingX: true,
          lockSkewingY: true,
        }) as ZoneTextbox;

        textObject.zoneId = zone.id;
        nextZoneMap[zone.id] = textObject;

        canvas.add(overlay);
        canvas.add(textObject);
      }

      zoneObjectsRef.current = nextZoneMap;
      canvas.requestRenderAll();
    } catch (error) {
      console.error('Canvas draw failed:', error);
      setErrorMessage('Failed to render template preview.');
    }
  }, [editorSvg, ensureFontFace, manifest, selectedZoneId]);

  useEffect(() => {
    void drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const hydrateFonts = async () => {
      for (const item of fonts) {
        if (!item.filename || !item.family) {
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await ensureFontFace(item.family, item.filename);
        } catch (error) {
          console.warn('Unable to preload custom font:', error);
        }
      }
    };

    void hydrateFonts();
  }, [ensureFontFace, fonts]);

  const runDetection = useCallback(async (templateId: number) => {
    setDetecting(true);
    setErrorMessage(null);
    setStatusMessage('Running SVG detection and OCR...');

    try {
      const start = await apiClient.startTemplateDetection(templateId, 10);
      const crops = Object.entries(start.data.candidate_crops || {});
      const ocrRows: TemplateOCRResult[] = [];

      if (crops.length > 0) {
        const worker = await createWorker('eng');
        try {
          for (const [candidateId, dataUrl] of crops) {
            // eslint-disable-next-line no-await-in-loop
            const result = await worker.recognize(dataUrl);
            const text = String(result.data.text || '').replace(/\s+/g, ' ').trim();
            const confidence = Number(result.data.confidence || 0) / 100;
            ocrRows.push({
              candidate_id: candidateId,
              text,
              confidence: Number.isFinite(confidence) ? confidence : 0,
            });
          }
        } finally {
          await worker.terminate();
        }
      }

      const finalize = await apiClient.finalizeTemplateDetection(templateId, ocrRows);
      const updatedTemplate = finalize.data;
      const nextManifest = normalizeManifest(
        updatedTemplate.template_manifest,
        updatedTemplate.width,
        updatedTemplate.height,
      );

      setTemplates((previous) => previous.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)));
      setSelectedTemplate(updatedTemplate);
      setManifest(nextManifest);
      setStatusMessage('Detection complete. Main/secondary zones are ready to edit.');
    } catch (error) {
      console.error('Detection failed:', error);
      setErrorMessage('Detection failed. You can still edit the current manifest manually.');
    } finally {
      setDetecting(false);
    }
  }, []);

  const openTemplateEditor = useCallback(async (template: Template) => {
    setErrorMessage(null);
    setStatusMessage(null);
    setSelectedZoneId(null);

    try {
      const [templateResponse, svgResponse] = await Promise.all([
        apiClient.getTemplate(template.id),
        apiClient.getTemplateSvg(template.id),
      ]);

      const fullTemplate = templateResponse.data;
      const svg = String(svgResponse.data || '').trim();
      if (!svg) {
        setErrorMessage('Template SVG is empty.');
        return;
      }

      const nextManifest = normalizeManifest(fullTemplate.template_manifest, fullTemplate.width, fullTemplate.height);
      setSelectedTemplate(fullTemplate);
      setEditorSvg(svg);
      setManifest(nextManifest);

      const storedVersion = Number((fullTemplate.template_manifest as Record<string, unknown> | null)?.version || 0);
      const hasTextZones = nextManifest.zones.some((zone) => zone.type !== 'image');
      if (storedVersion !== 2 || !hasTextZones) {
        await runDetection(fullTemplate.id);
      }
    } catch (error) {
      console.error('Failed to open template editor:', error);
      setErrorMessage('Failed to load template editor.');
    }
  }, [runDetection]);

  const updateManifestZone = useCallback((zoneId: string, updater: (zone: ManifestZone) => ManifestZone) => {
    setManifest((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        zones: previous.zones.map((zone) => (zone.id === zoneId ? updater(zone) : zone)),
      };
    });
  }, []);

  const handleUploadTemplate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formData.name.trim() || !formData.file) {
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await apiClient.uploadTemplate(formData.name.trim(), formData.file);
      setFormData({ name: '', file: null });
      setShowUpload(false);
      await loadTemplates();
    } catch (error) {
      console.error('Upload failed:', error);
      setErrorMessage('Template upload failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (!window.confirm('Delete this template?')) {
      return;
    }

    try {
      await apiClient.deleteTemplate(templateId);
      setTemplates((previous) => previous.filter((item) => item.id !== templateId));
      if (selectedTemplate?.id === templateId) {
        setSelectedTemplate(null);
        setManifest(null);
        setEditorSvg('');
      }
      if (defaultTemplateId === templateId) {
        setDefaultTemplateId(null);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      setErrorMessage('Failed to delete template.');
    }
  };

  const handleSetDefaultTemplate = async (templateId: number) => {
    if (!activeWebsiteId) {
      setErrorMessage('Select an active website first.');
      return;
    }

    try {
      const current = await apiClient.getWebsiteGenerationSettings(activeWebsiteId);
      const settings = current.data.settings || {};
      const existingDesign = (typeof settings.design === 'object' && settings.design)
        ? settings.design as Record<string, unknown>
        : (typeof settings.design_settings === 'object' && settings.design_settings)
          ? settings.design_settings as Record<string, unknown>
          : {};

      const next = {
        ...settings,
        design: {
          ...existingDesign,
          template_ids: [templateId],
        },
        design_settings: {
          ...(typeof settings.design_settings === 'object' && settings.design_settings
            ? settings.design_settings as Record<string, unknown>
            : {}),
          template_ids: [templateId],
        },
      };

      await apiClient.updateWebsiteGenerationSettings(activeWebsiteId, next);
      setDefaultTemplateId(templateId);
      setStatusMessage('Default template updated for the active website.');
    } catch (error) {
      console.error('Failed to update default template:', error);
      setErrorMessage('Failed to set default template.');
    }
  };

  const handleSaveManifest = async () => {
    if (!selectedTemplate || !manifest || !editorSvg) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const response = await apiClient.updateTemplateManifest(selectedTemplate.id, {
        svg_content: editorSvg,
        template_manifest: manifest as unknown as Record<string, unknown>,
      });

      const updatedTemplate = response.data;
      setTemplates((previous) => previous.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)));
      setSelectedTemplate(updatedTemplate);
      setManifest(normalizeManifest(updatedTemplate.template_manifest, updatedTemplate.width, updatedTemplate.height));
      setStatusMessage('Template manifest saved.');
    } catch (error) {
      console.error('Save failed:', error);
      setErrorMessage('Failed to save template changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFont = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    setUploadingFont(true);
    setErrorMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      let detectedFamily = '';
      try {
        const parsed = opentype.parse(arrayBuffer);
        detectedFamily =
          String(parsed.names?.preferredFamily?.en || '')
          || String(parsed.names?.fontFamily?.en || '')
          || String(parsed.names?.fullName?.en || '');
      } catch {
        detectedFamily = '';
      }

      const response = await apiClient.uploadTemplateFont(file, detectedFamily || undefined);
      const font = response.data;
      setFonts((previous) => {
        const list = [...previous.filter((item) => item.filename !== font.filename), font];
        return list;
      });
      await ensureFontFace(font.family, font.filename);
      setStatusMessage(`Uploaded font: ${font.family}`);
    } catch (error) {
      console.error('Font upload failed:', error);
      setErrorMessage('Failed to upload font file.');
    } finally {
      event.target.value = '';
      setUploadingFont(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Loading templates...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black uppercase">Templates</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowUpload((value) => !value)}>
            {showUpload ? 'Close Upload' : 'Upload SVG'}
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 border-2 border-black bg-white px-3 py-2 font-mono text-sm font-bold uppercase shadow-brutal-sm hover:shadow-brutal">
            {uploadingFont ? 'Uploading Font...' : 'Upload Font'}
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={handleUploadFont}
              disabled={uploadingFont}
            />
          </label>
        </div>
      </div>

      {showUpload && (
        <form onSubmit={handleUploadTemplate} className="space-y-3 border-2 border-black bg-white p-4 shadow-brutal-sm">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase">Template Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(event) => setFormData((previous) => ({ ...previous, name: event.target.value }))}
              className="w-full border-2 border-black px-3 py-2 text-sm"
              placeholder="Chef Cara"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase">SVG File</label>
            <input
              type="file"
              accept=".svg"
              onChange={(event) => setFormData((previous) => ({ ...previous, file: event.target.files?.[0] || null }))}
              className="w-full border-2 border-black px-3 py-2 text-sm"
              required
            />
          </div>
          <Button type="submit" disabled={submitting || !formData.file || !formData.name.trim()}>
            {submitting ? 'Uploading...' : 'Save Template'}
          </Button>
        </form>
      )}

      {errorMessage && <div className="border-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>}
      {statusMessage && <div className="border-2 border-green-600 bg-green-50 px-3 py-2 text-sm text-green-700">{statusMessage}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <section className="space-y-2 border-2 border-black bg-white p-3 shadow-brutal-sm">
          <h2 className="text-sm font-black uppercase">Template Library</h2>

          {templates.length === 0 && <div className="text-sm text-gray-600">No templates uploaded yet.</div>}

          {templates.map((template) => {
            const isSelected = template.id === selectedTemplate?.id;
            const isDefault = template.id === defaultTemplateId;
            return (
              <div
                key={template.id}
                className={`space-y-2 border-2 p-2 ${isSelected ? 'border-accent bg-red-50' : 'border-black bg-white'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold">{template.name}</div>
                    <div className="text-[11px] text-gray-600">{template.width} x {template.height}</div>
                  </div>
                  {isDefault && <span className="text-[10px] font-bold uppercase text-green-700">Default</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void openTemplateEditor(template)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void handleSetDefaultTemplate(template.id)}>
                    Set Default
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleDeleteTemplate(template.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-3 border-2 border-black bg-white p-3 shadow-brutal-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black uppercase">Detection Editor</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedTemplate || detecting}
                onClick={() => {
                  if (selectedTemplate) {
                    void runDetection(selectedTemplate.id);
                  }
                }}
              >
                {detecting ? 'Detecting...' : 'Re-Detect Zones'}
              </Button>
              <Button
                size="sm"
                disabled={!selectedTemplate || !manifest || saving}
                onClick={() => void handleSaveManifest()}
              >
                {saving ? 'Saving...' : 'Save Manifest'}
              </Button>
            </div>
          </div>

          {!selectedTemplate && <div className="text-sm text-gray-600">Select a template to open the editor.</div>}

          {selectedTemplate && manifest && (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="overflow-auto border-2 border-black bg-gray-50 p-2">
                  <canvas ref={canvasElementRef} />
                </div>

                <div className="space-y-3 border-2 border-black bg-white p-3">
                  <h3 className="text-xs font-black uppercase">Editable Zones</h3>

                  <div className="space-y-2">
                    {editableZones.map((zone) => (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => {
                          setSelectedZoneId(zone.id);
                          const object = zoneObjectsRef.current[zone.id];
                          if (object && canvasRef.current) {
                            canvasRef.current.setActiveObject(object);
                            canvasRef.current.requestRenderAll();
                          }
                        }}
                        className={`w-full border-2 px-2 py-1 text-left text-xs font-bold uppercase ${
                          selectedZoneId === zone.id ? 'border-accent bg-red-50' : 'border-black bg-white'
                        }`}
                      >
                        {zone.type === 'main_text' ? 'Main Text' : 'Secondary Text'}
                        <span className="ml-2 text-[10px] normal-case text-gray-600">
                          conf {Math.round(zone.confidence * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>

                  {selectedZone && selectedZone.style && selectedZone.replacement && (
                    <div className="space-y-2 border-t-2 border-black pt-3">
                      <label className="block text-[11px] font-bold uppercase">Text</label>
                      <textarea
                        value={selectedZone.replacement.text}
                        onChange={(event) => {
                          const value = event.target.value;
                          updateManifestZone(selectedZone.id, (zone) => ({
                            ...zone,
                            replacement: { ...(zone.replacement || selectedZone.replacement!), text: value },
                          }));
                        }}
                        className="h-20 w-full border-2 border-black px-2 py-1 text-sm"
                      />

                      <label className="block text-[11px] font-bold uppercase">Font</label>
                      <select
                        value={selectedZone.replacement.font_family || selectedZone.style.font_family}
                        onChange={(event) => {
                          const family = event.target.value;
                          const custom = fontByFamily.get(family);
                          void ensureFontFace(custom?.family || family, custom?.filename || null);
                          updateManifestZone(selectedZone.id, (zone) => {
                            if (!zone.style || !zone.replacement) {
                              return zone;
                            }
                            return {
                              ...zone,
                              style: {
                                ...zone.style,
                                font_family: family,
                                font_file: custom?.filename || null,
                              },
                              replacement: {
                                ...zone.replacement,
                                font_family: family,
                                font_file: custom?.filename || null,
                              },
                            };
                          });
                        }}
                        className="w-full border-2 border-black px-2 py-1 text-sm"
                      >
                        {fontOptions.map((family) => (
                          <option key={family} value={family}>{family}</option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold uppercase">Size</label>
                          <input
                            type="number"
                            min={8}
                            max={220}
                            value={selectedZone.style.font_size}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.style!.font_size, 8);
                              updateManifestZone(selectedZone.id, (zone) => {
                                if (!zone.style) {
                                  return zone;
                                }
                                return { ...zone, style: { ...zone.style, font_size: value } };
                              });
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase">Weight</label>
                          <input
                            type="number"
                            min={100}
                            max={900}
                            step={100}
                            value={selectedZone.style.font_weight}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.style!.font_weight, 100);
                              updateManifestZone(selectedZone.id, (zone) => {
                                if (!zone.style) {
                                  return zone;
                                }
                                return { ...zone, style: { ...zone.style, font_weight: value } };
                              });
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold uppercase">Color</label>
                          <input
                            type="color"
                            value={selectedZone.style.fill}
                            onChange={(event) => {
                              const value = normalizeColor(event.target.value, selectedZone.style!.fill);
                              updateManifestZone(selectedZone.id, (zone) => {
                                if (!zone.style) {
                                  return zone;
                                }
                                return { ...zone, style: { ...zone.style, fill: value } };
                              });
                            }}
                            className="h-10 w-full border-2 border-black"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase">Align</label>
                          <select
                            value={selectedZone.style.align}
                            onChange={(event) => {
                              const align = normalizeAlign(event.target.value, selectedZone.style!.align);
                              updateManifestZone(selectedZone.id, (zone) => {
                                if (!zone.style) {
                                  return zone;
                                }
                                return { ...zone, style: { ...zone.style, align } };
                              });
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold uppercase">X</label>
                          <input
                            type="number"
                            value={selectedZone.bounds.x}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.bounds.x);
                              updateManifestZone(selectedZone.id, (zone) => ({
                                ...zone,
                                bounds: { ...zone.bounds, x: value },
                              }));
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase">Y</label>
                          <input
                            type="number"
                            value={selectedZone.bounds.y}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.bounds.y);
                              updateManifestZone(selectedZone.id, (zone) => ({
                                ...zone,
                                bounds: { ...zone.bounds, y: value },
                              }));
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase">Width</label>
                          <input
                            type="number"
                            min={1}
                            value={selectedZone.bounds.width}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.bounds.width, 1);
                              updateManifestZone(selectedZone.id, (zone) => ({
                                ...zone,
                                bounds: { ...zone.bounds, width: value },
                              }));
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase">Height</label>
                          <input
                            type="number"
                            min={1}
                            value={selectedZone.bounds.height}
                            onChange={(event) => {
                              const value = clampInt(event.target.value, selectedZone.bounds.height, 1);
                              updateManifestZone(selectedZone.id, (zone) => ({
                                ...zone,
                                bounds: { ...zone.bounds, height: value },
                              }));
                            }}
                            className="w-full border-2 border-black px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Detection-first mode: only main/secondary text zones are editable. Image regions are detected and displayed for awareness.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
