import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutPanelLeft } from 'lucide-react';
import apiClient, {
  PlaygroundFontSet,
  PlaygroundPageItem,
  PlaygroundPreviewMeta,
  PlaygroundSettings,
  PlaygroundTemplateItem,
} from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import LeftPanel from '../components/playground/LeftPanel';
import RightPanel from '../components/playground/RightPanel';
import SvgRenderer from '../components/playground/SvgRenderer';
import type { PlaygroundState } from '../components/playground/types';
import {
  DEFAULT_PLAYGROUND_TEXT_SETTINGS,
  clampLineHeightMultiplier,
  clampTitlePaddingX,
  clampTitleScale,
  normalizeFontSets,
} from '../utils/playgroundSettings';

const DEFAULT_STATE: PlaygroundState = {
  selectedPageUrl: '',
  aiSettings: {
    promptStyle: 'informative',
    customPrompt: '',
    language: 'English',
    promptEnabled: true,
    templateTitleMode: 'original',
    templateTitlePrompt: 'Rewrite this Pinterest title based on {{title}} while keeping intent and clarity.',
  },
  selectedFontSetId: '',
  selectedTemplateIds: [],
  defaultTemplateId: null,
  imageSettings: {
    fetchFromPage: true,
    useHiddenImages: true,
    ignoreSmallWidth: true,
    minWidth: 200,
    ignoreSmallHeight: false,
    limitImagesPerPage: false,
    allowedOrientations: ['portrait', 'square', 'landscape'],
    useFeaturedImage: true,
    uniqueImagePerPin: true,
    ignoreImagesWithTextOverlay: false,
    noDuplicateContent: false,
  },
  displaySettings: {
    showFullImage: false,
  },
  advancedSettings: {
    enableImageValidation: true,
  },
  previewOpen: false,
  activeTemplateId: null,
  activeFontSetId: '',
  activeFontColor: DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor,
  zoom: 0.8,
  scheduledDate: null,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function Playground() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [uploadingFont, setUploadingFont] = useState(false);
  const [status, setStatus] = useState('');
  const [websiteId, setWebsiteId] = useState<number | null>(null);
  const [pages, setPages] = useState<PlaygroundPageItem[]>([]);
  const [templates, setTemplates] = useState<PlaygroundTemplateItem[]>([]);
  const [fontSets, setFontSets] = useState<PlaygroundFontSet[]>([]);
  const [state, setState] = useState<PlaygroundState>(DEFAULT_STATE);
  const [previewMeta, setPreviewMeta] = useState<PlaygroundPreviewMeta | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [variantIndex, setVariantIndex] = useState(0);
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [scrapedPageUrl, setScrapedPageUrl] = useState('');
  const [scrapedTitle, setScrapedTitle] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [titleScale, setTitleScale] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titleScale);
  const [titlePaddingX, setTitlePaddingX] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titlePaddingX);
  const [lineHeightMultiplier, setLineHeightMultiplier] = useState(DEFAULT_PLAYGROUND_TEXT_SETTINGS.lineHeightMultiplier);
  const initialStateRef = useRef<PlaygroundState | null>(null);
  const initialTitleScaleRef = useRef<number>(1);
  const initialTitlePaddingRef = useRef<number>(15);
  const initialLineHeightRef = useRef<number>(1);

  const selectedPage = useMemo(
    () => pages.find((page) => page.url === state.selectedPageUrl) || null,
    [pages, state.selectedPageUrl],
  );
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === state.activeTemplateId) || null,
    [state.activeTemplateId, templates],
  );
  const activeFontSet = useMemo(
    () => fontSets.find((font) => font.id === state.activeFontSetId) || null,
    [fontSets, state.activeFontSetId],
  );
  const pageScopedScrapedImages = scrapedPageUrl === state.selectedPageUrl ? scrapedImages : [];
  const pageScopedTitle = scrapedPageUrl === state.selectedPageUrl ? scrapedTitle : '';
  const currentPageImages = pageScopedScrapedImages.length > 0 ? pageScopedScrapedImages : (selectedPage?.images || []);
  const variantTotal = 1;

  useEffect(() => {
    const stored = localStorage.getItem('active_website_id');
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      setWebsiteId(parsed);
      return;
    }
    void apiClient.listWebsites().then((response) => {
      const first = response.data[0];
      if (first) {
        setWebsiteId(first.id);
        localStorage.setItem('active_website_id', String(first.id));
      }
    }).catch(() => {
      setStatus('No active website selected.');
    });
  }, []);

  useEffect(() => {
    const onWebsiteSwitch = (event: Event) => {
      const custom = event as CustomEvent<number | null>;
      const nextId = Number(custom.detail);
      if (Number.isFinite(nextId) && nextId > 0) {
        setWebsiteId(nextId);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'active_website_id') return;
      const nextId = Number(event.newValue);
      if (Number.isFinite(nextId) && nextId > 0) {
        setWebsiteId(nextId);
      }
    };
    window.addEventListener('website-switch', onWebsiteSwitch as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('website-switch', onWebsiteSwitch as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!websiteId) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [pagesRes, templatesRes, fontsRes, settingsRes] = await Promise.all([
          apiClient.getPlaygroundPages(websiteId),
          apiClient.getPlaygroundTemplates(),
          apiClient.getPlaygroundFonts(),
          apiClient.getPlaygroundSettings(websiteId),
        ]);
        if (!active) return;
        setPages(pagesRes.data);
        setTemplates(templatesRes.data.templates || []);
        const filteredFonts = normalizeFontSets(fontsRes.data.filter((font) => (
          String(font.id || '').startsWith('custom:')
          || String(font.id || '').startsWith('font_combo_')
        )));
        setFontSets(filteredFonts);

        const settings = settingsRes.data;
        const selectedTemplates = asArray<number>(settings.selected_templates).filter((id) =>
          (templatesRes.data.templates || []).some((template) => template.id === Number(id)));
        const defaultTemplateIdRaw = Number((settings as any).default_template_id);
        const defaultTemplateId = Number.isFinite(defaultTemplateIdRaw) &&
          selectedTemplates.includes(defaultTemplateIdRaw)
          ? defaultTemplateIdRaw
          : (selectedTemplates[0] ?? null);
        const pageUrl = pagesRes.data.some((page) => page.url === String((settings as any).selected_page_url || ''))
          ? String((settings as any).selected_page_url)
          : (pagesRes.data[0]?.url || '');
        const fontSetId = filteredFonts.some((font) => font.id === String(settings.font_set))
          ? String(settings.font_set)
          : (filteredFonts[0]?.id || '');

        const nextState: PlaygroundState = {
          ...DEFAULT_STATE,
          selectedPageUrl: pageUrl,
          aiSettings: {
            ...DEFAULT_STATE.aiSettings,
            ...(settings.ai_settings || {}),
          },
          selectedFontSetId: fontSetId,
          selectedTemplateIds: selectedTemplates,
          defaultTemplateId,
          imageSettings: {
            ...DEFAULT_STATE.imageSettings,
            ...(settings.image_settings || {}),
          },
          displaySettings: {
            ...DEFAULT_STATE.displaySettings,
            ...(settings.display_settings || {}),
          },
          advancedSettings: {
            ...DEFAULT_STATE.advancedSettings,
            ...(settings.advanced_settings || {}),
          },
          previewOpen: false,
          activeTemplateId: defaultTemplateId ?? selectedTemplates[0] ?? (templatesRes.data.templates || [])[0]?.id ?? null,
          activeFontSetId: fontSetId,
          activeFontColor: String(settings.font_color || DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor),
          zoom: 0.8,
          scheduledDate: null,
        };
        setState(nextState);
        const safeScale = clampTitleScale((settings as any).title_scale);
        setTitleScale(safeScale);
        const safePadding = clampTitlePaddingX((settings as any).title_padding_x);
        setTitlePaddingX(safePadding);
        const safeLineHeight = clampLineHeightMultiplier((settings as any).line_height_multiplier);
        setLineHeightMultiplier(safeLineHeight);
        initialTitleScaleRef.current = safeScale;
        initialTitlePaddingRef.current = safePadding;
        initialLineHeightRef.current = safeLineHeight;
        initialStateRef.current = nextState;
        setVariantIndex(0);
        if (nextState.selectedPageUrl) {
          setIsScraping(true);
          setScrapeError(null);
          try {
            const scrapeRes = await apiClient.getPlaygroundScrapeImages(nextState.selectedPageUrl);
            setScrapedImages(scrapeRes.data.images || []);
            setScrapedPageUrl(nextState.selectedPageUrl);
            setScrapedTitle(scrapeRes.data.title || '');
          } catch (_error) {
            setScrapeError('Failed to scrape page images.');
          } finally {
            setIsScraping(false);
          }
        }
      } catch (_error) {
        if (!active) return;
        setStatus('Failed to load Playground data.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [websiteId]);

  useEffect(() => {
    if (!websiteId || !state.selectedPageUrl || !state.activeTemplateId) {
      setPreviewMeta(null);
      return;
    }
    let active = true;
    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const templateId = state.activeTemplateId;
        if (!templateId) return;
        const response = await apiClient.getPlaygroundPreview({
          website_id: websiteId,
          page_url: state.selectedPageUrl,
          template_id: templateId,
          font_set_id: state.activeFontSetId || undefined,
          font_color: state.activeFontColor || undefined,
          ai_settings: state.aiSettings as unknown as Record<string, unknown>,
        });
        if (!active) return;
        setPreviewMeta(response.data);
      } catch (_error) {
        if (!active) return;
        setPreviewMeta(null);
      } finally {
        if (active) setPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => {
      active = false;
    };
  }, [
    state.aiSettings,
    state.activeFontColor,
    state.activeFontSetId,
    state.activeTemplateId,
    state.selectedPageUrl,
    websiteId,
  ]);

  async function saveDraft() {
    if (!websiteId) return;
    setSaving(true);
    setStatus('Saving playground settings...');
    try {
      const payload: PlaygroundSettings = {
        selected_templates: state.selectedTemplateIds,
        default_template_id: state.defaultTemplateId,
        font_set: state.selectedFontSetId,
        font_color: state.activeFontColor,
        title_scale: titleScale,
        title_padding_x: titlePaddingX,
        line_height_multiplier: lineHeightMultiplier,
        image_settings: state.imageSettings as unknown as Record<string, unknown>,
        display_settings: state.displaySettings as unknown as Record<string, unknown>,
        advanced_settings: state.advancedSettings as unknown as Record<string, unknown>,
      };
      await apiClient.savePlaygroundSettings(websiteId, payload);
      initialStateRef.current = { ...state };
      initialTitleScaleRef.current = titleScale;
      initialTitlePaddingRef.current = titlePaddingX;
      initialLineHeightRef.current = lineHeightMultiplier;
      setStatus('Playground draft saved.');
    } catch (_error) {
      setStatus('Failed to save playground settings.');
    } finally {
      setSaving(false);
    }
  }

  async function generateAiContentForPreview() {
    if (!websiteId || !state.selectedPageUrl) return;
    setGeneratingAi(true);
    setStatus('Generating AI content...');
    try {
      const response = await apiClient.generatePlaygroundContent({
        website_id: websiteId,
        page_url: state.selectedPageUrl,
        ai_settings: state.aiSettings as unknown as Record<string, unknown>,
      });
      setPreviewMeta((prev) => ({
        title: response.data.title,
        description: response.data.description,
        alt_text: response.data.alt_text,
        image_title: prev?.image_title || selectedPage?.title || state.selectedPageUrl,
        board: prev?.board || selectedPage?.board || 'General',
        image_url: prev?.image_url || currentPageImages[0] || '',
        outbound_url: prev?.outbound_url || state.selectedPageUrl,
        template_name: prev?.template_name || activeTemplate?.name || '',
        template_path: prev?.template_path || activeTemplate?.path || '',
        font_set_id: prev?.font_set_id || state.activeFontSetId,
        font_color: prev?.font_color || state.activeFontColor,
      }));
      setStatus('AI content generated.');
    } catch (_error) {
      setStatus('Failed to generate AI content.');
    } finally {
      setGeneratingAi(false);
    }
  }

  async function refreshTemplateList(): Promise<PlaygroundTemplateItem[]> {
    const response = await apiClient.getPlaygroundTemplates();
    const items = response.data.templates || [];
    setTemplates(items);
    return items;
  }

  async function refreshFontList(): Promise<PlaygroundFontSet[]> {
    const response = await apiClient.getPlaygroundFonts();
    const normalized = normalizeFontSets(response.data.filter((font) => (
      String(font.id || '').startsWith('custom:')
      || String(font.id || '').startsWith('font_combo_')
    )));
    setFontSets(normalized);
    return normalized;
  }

  async function handleUploadTemplate(name: string, file: File) {
    setUploadingTemplate(true);
    setStatus('Uploading template...');
    try {
      const uploaded = await apiClient.uploadTemplate(name, file);
      const items = await refreshTemplateList();
      const created = items.find((template) => template.id === uploaded.data.id);
      if (created) {
        openTemplatePreview(created.id, true);
      }
      setStatus('Template uploaded.');
    } catch (_error) {
      setStatus('Failed to upload template.');
    } finally {
      setUploadingTemplate(false);
    }
  }

  async function handleUploadFont(file: File, family?: string) {
    setUploadingFont(true);
    setStatus('Uploading font...');
    try {
      const response = await apiClient.uploadTemplateFont(file, family);
      const nextFonts = await refreshFontList();
      const customId = `custom:${response.data.filename}`;
      const uploadedFont = nextFonts.find((font) => font.id === customId);
      if (uploadedFont) {
        setState((prev) => ({
          ...prev,
          selectedFontSetId: uploadedFont.id,
          activeFontSetId: uploadedFont.id,
        }));
      }
      setStatus('Font uploaded.');
    } catch (_error) {
      setStatus('Failed to upload font.');
    } finally {
      setUploadingFont(false);
    }
  }

  function randomizeImages() {
    const sourceImages = currentPageImages;
    if (sourceImages.length <= 1) return;
    setScrapedImages((prev) => {
      const base = scrapedPageUrl === state.selectedPageUrl && prev.length > 0 ? prev : sourceImages;
      const [first, ...rest] = base;
      return [...rest, first];
    });
    setScrapedPageUrl(state.selectedPageUrl);
  }

  function clearChanges() {
    if (initialStateRef.current) {
      setState(initialStateRef.current);
      setVariantIndex(0);
      setTitleScale(initialTitleScaleRef.current);
      setTitlePaddingX(initialTitlePaddingRef.current);
      setLineHeightMultiplier(initialLineHeightRef.current);
      setScrapedImages([]);
      setScrapedPageUrl('');
      setScrapedTitle('');
      setScrapeError(null);
      return;
    }
    setState(DEFAULT_STATE);
  }

  function resetTextSettings() {
    setTitleScale(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titleScale);
    setTitlePaddingX(DEFAULT_PLAYGROUND_TEXT_SETTINGS.titlePaddingX);
    setLineHeightMultiplier(DEFAULT_PLAYGROUND_TEXT_SETTINGS.lineHeightMultiplier);
    setState((prev) => ({
      ...prev,
      activeFontColor: DEFAULT_PLAYGROUND_TEXT_SETTINGS.fontColor,
    }));
  }

  function openPreviewModal() {
    setState((prev) => {
      const fallback = prev.activeTemplateId ?? prev.selectedTemplateIds[0] ?? templates[0]?.id ?? null;
      return {
        ...prev,
        activeTemplateId: fallback,
        previewOpen: Boolean(fallback),
      };
    });
  }

  function openTemplatePreview(templateId: number, open = true) {
    setState((prev) => {
      const selected = prev.selectedTemplateIds.includes(templateId)
        ? prev.selectedTemplateIds
        : [...prev.selectedTemplateIds, templateId];
      return {
        ...prev,
        selectedTemplateIds: selected,
        defaultTemplateId: prev.defaultTemplateId ?? templateId,
        activeTemplateId: templateId,
        previewOpen: open,
      };
    });
  }

  const activeFontFamily = activeFontSet?.main || 'Bebas Neue';

  if (loading) {
    return <div className="text-sm text-slate-600">Loading Playground...</div>;
  }

  return (
    <div className="relative space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <LayoutPanelLeft className="h-5 w-5 text-slate-500" />
            <div>
              <CardTitle>Playground</CardTitle>
              <CardDescription>Configure templates, fonts, and image behavior with live previews.</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_520px]">
        <Card className="h-[calc(100vh-210px)]">
          <CardContent className="h-full p-3 pt-3">
            <LeftPanel
              pages={pages}
              selectedPageUrl={state.selectedPageUrl}
              onSelectPage={(url) => {
                setScrapedImages([]);
                setScrapedPageUrl('');
                setScrapedTitle('');
                setPreviewMeta(null);
                setState((prev) => ({ ...prev, selectedPageUrl: url }));
              }}
              aiSettings={state.aiSettings}
              onAiSettingsChange={(next) => setState((prev) => ({ ...prev, aiSettings: next }))}
              fontSets={fontSets}
              selectedFontSetId={state.selectedFontSetId}
              onSelectFontSet={(id) => setState((prev) => ({ ...prev, selectedFontSetId: id, activeFontSetId: id }))}
              selectedPage={selectedPage}
              imageSettings={state.imageSettings}
              displaySettings={state.displaySettings}
              advancedSettings={state.advancedSettings}
              onImageSettingsChange={(next) => setState((prev) => ({ ...prev, imageSettings: next }))}
              onDisplaySettingsChange={(next) => setState((prev) => ({ ...prev, displaySettings: next }))}
              onAdvancedSettingsChange={(next) => setState((prev) => ({ ...prev, advancedSettings: next }))}
              onScrapeResult={(payload) => {
                setScrapeError(null);
                setScrapedImages(payload.images || []);
                setScrapedPageUrl(payload.pageUrl);
                setScrapedTitle(payload.title || '');
              }}
              onSaveDraft={() => void saveDraft()}
              saving={saving}
              onUploadTemplate={handleUploadTemplate}
              onUploadFont={handleUploadFont}
              uploadingTemplate={uploadingTemplate}
              uploadingFont={uploadingFont}
            />
            <div
              className={`mt-3 px-1 text-[11px] ${
                scrapeError ? 'text-red-600' : 'text-slate-500'
              }`}
            >
              {isScraping
                ? 'Fetching page images for preview...'
                : scrapeError
                  ? scrapeError
                  : !state.selectedPageUrl
                    ? 'Select a page to load preview images.'
                    : currentPageImages.length > 0
                      ? `Preview images loaded: ${currentPageImages.length}`
                      : 'No preview images were found for this page.'}
            </div>
          </CardContent>
        </Card>

        <Card className="hidden h-[calc(100vh-210px)] overflow-y-auto xl:block">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-800">Template Preview</div>
              <div className="text-[10px] text-slate-500">{state.selectedTemplateIds.length} selected</div>
            </div>
            <button
              type="button"
              onClick={openPreviewModal}
              className="mx-auto mt-3 block w-full max-w-[430px] overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-left"
            >
              <div className="overflow-hidden">
                {activeTemplate ? (
                  <SvgRenderer
                    templatePath={activeTemplate.path}
                    pageImages={currentPageImages}
                    title={previewMeta?.title || pageScopedTitle || selectedPage?.title || 'Sample Pin Title'}
                    fontFamily={activeFontFamily}
                    fontSetId={state.activeFontSetId}
                    fontFile={activeFontSet?.font_file || null}
                    textColor={state.activeFontColor}
                    titleScale={titleScale}
                    titlePaddingX={titlePaddingX}
                    lineHeightMultiplier={lineHeightMultiplier}
                    imageSettings={state.imageSettings}
                    zoom={1}
                    className="w-full"
                  />
                ) : (
                  <div className="p-3 text-xs text-slate-500">No template selected.</div>
                )}
              </div>
              <div className="border-t border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                {activeTemplate?.name || 'Open modal'}
              </div>
            </button>
          </CardContent>
        </Card>
      </div>

      <RightPanel
        open={state.previewOpen}
        onClose={() => setState((prev) => ({ ...prev, previewOpen: false }))}
        selectedPage={selectedPage}
        activeTemplate={activeTemplate}
        templates={templates}
        selectedTemplateIds={state.selectedTemplateIds}
        fontSets={fontSets}
        activeFontSetId={state.activeFontSetId}
        onSelectFontSet={(id) => setState((prev) => ({ ...prev, activeFontSetId: id, selectedFontSetId: id }))}
        activeFontColor={state.activeFontColor}
        onFontColorChange={(color) => setState((prev) => ({ ...prev, activeFontColor: color }))}
        defaultTemplateId={state.defaultTemplateId}
        onSetDefaultTemplate={(id) => setState((prev) => ({
          ...prev,
          defaultTemplateId: id,
          selectedTemplateIds: prev.selectedTemplateIds.includes(id) ? prev.selectedTemplateIds : [...prev.selectedTemplateIds, id],
        }))}
        titleScale={titleScale}
        onTitleScaleChange={setTitleScale}
        titlePaddingX={titlePaddingX}
        onTitlePaddingXChange={setTitlePaddingX}
        lineHeightMultiplier={lineHeightMultiplier}
        onLineHeightMultiplierChange={setLineHeightMultiplier}
        onResetTextSettings={resetTextSettings}
        metadata={previewMeta}
        loading={previewLoading}
        zoom={state.zoom}
        onZoomChange={(zoom) => setState((prev) => ({ ...prev, zoom }))}
        variantIndex={variantIndex}
        variantTotal={variantTotal}
        onPrevVariant={() => setVariantIndex(0)}
        onNextVariant={() => setVariantIndex(0)}
        onRandomize={randomizeImages}
        onClearChanges={clearChanges}
        onSelectTemplate={(id) => setState((prev) => ({ ...prev, activeTemplateId: id }))}
        onToggleTemplateSelection={(id) => setState((prev) => {
          const isSelected = prev.selectedTemplateIds.includes(id);
          const selectedTemplateIds = isSelected
            ? prev.selectedTemplateIds.filter((item) => item !== id)
            : [...prev.selectedTemplateIds, id];
          const fallback = selectedTemplateIds[0] ?? null;
          const activeTemplateId = selectedTemplateIds.includes(prev.activeTemplateId || -1)
            ? prev.activeTemplateId
            : fallback;
          const defaultTemplateId = selectedTemplateIds.includes(prev.defaultTemplateId || -1)
            ? prev.defaultTemplateId
            : fallback;
          return {
            ...prev,
            selectedTemplateIds,
            activeTemplateId,
            defaultTemplateId,
            previewOpen: Boolean(activeTemplateId),
          };
        })}
        scheduledDate={state.scheduledDate}
        onChangeDate={(value) => setState((prev) => ({ ...prev, scheduledDate: value }))}
        activeFontFamily={activeFontFamily}
        activeFontFile={activeFontSet?.font_file || null}
        pageImages={currentPageImages}
        scrapedTitle={pageScopedTitle}
        imageSettings={state.imageSettings}
        onGenerateAiContent={() => void generateAiContentForPreview()}
        generatingAi={generatingAi}
      />

      {status && (
        <div className="fixed bottom-4 left-4 z-50 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
          {status}
        </div>
      )}
    </div>
  );
}
