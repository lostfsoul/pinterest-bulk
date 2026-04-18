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
import type { PlaygroundState } from '../components/playground/types';

const DEFAULT_STATE: PlaygroundState = {
  selectedPageUrl: '',
  aiSettings: {
    promptStyle: 'informative',
    customPrompt: '',
    language: 'English',
    promptEnabled: true,
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
  activeFontColor: '#1a1a1a',
  zoom: 1,
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
  const [scrapedTitle, setScrapedTitle] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [titleScale, setTitleScale] = useState(1);
  const initialStateRef = useRef<PlaygroundState | null>(null);

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
        const filteredFonts = fontsRes.data.filter((font) => (
          String(font.id || '').startsWith('custom:')
          || String(font.id || '').startsWith('font_combo_')
        ));
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
          activeFontColor: String(settings.font_color || '#1a1a1a'),
          zoom: 1,
          scheduledDate: null,
        };
        setState(nextState);
        const persistedScale = Number((settings as any).title_scale);
        const safeScale = Number.isFinite(persistedScale)
          ? Math.max(0.7, Math.min(1.6, persistedScale))
          : 1;
        setTitleScale(safeScale);
        initialStateRef.current = nextState;
        setVariantIndex(0);
        if (nextState.selectedPageUrl) {
          setIsScraping(true);
          setScrapeError(null);
          try {
            const scrapeRes = await apiClient.getPlaygroundScrapeImages(nextState.selectedPageUrl);
            setScrapedImages(scrapeRes.data.images || []);
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
        image_settings: state.imageSettings as unknown as Record<string, unknown>,
        display_settings: state.displaySettings as unknown as Record<string, unknown>,
        advanced_settings: state.advancedSettings as unknown as Record<string, unknown>,
      };
      await apiClient.savePlaygroundSettings(websiteId, payload);
      initialStateRef.current = { ...state };
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
        image_url: prev?.image_url || selectedPage?.images?.[0] || '',
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
    const normalized = response.data.filter((font) => (
      String(font.id || '').startsWith('custom:')
      || String(font.id || '').startsWith('font_combo_')
    ));
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
        openTemplatePreview(created.id);
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

  async function handleDeleteTemplate(templateId: number) {
    const target = templates.find((template) => template.id === templateId);
    if (!target) return;
    const confirmed = window.confirm(`Delete template "${target.name}"?`);
    if (!confirmed) return;
    setStatus('Deleting template...');
    try {
      await apiClient.deleteTemplate(templateId);
      const items = await refreshTemplateList();
      const nextIds = state.selectedTemplateIds.filter((id) => id !== templateId);
      const fallbackTemplateId = nextIds[0] ?? items[0]?.id ?? null;
      const nextActive = state.activeTemplateId === templateId
        ? fallbackTemplateId
        : (items.some((item) => item.id === state.activeTemplateId) ? state.activeTemplateId : fallbackTemplateId);
      const nextDefault = state.defaultTemplateId === templateId
        ? fallbackTemplateId
        : (nextIds.includes(state.defaultTemplateId || -1) ? state.defaultTemplateId : fallbackTemplateId);

      setState((prev) => ({
        ...prev,
        selectedTemplateIds: nextIds,
        defaultTemplateId: nextDefault,
        activeTemplateId: nextActive,
        previewOpen: nextActive ? prev.previewOpen : false,
      }));
      setStatus('Template deleted.');
    } catch (_error) {
      setStatus('Failed to delete template.');
    }
  }

  function randomizePage() {
    if (pages.length === 0) return;
    const random = pages[Math.floor(Math.random() * pages.length)];
    setState((prev) => ({ ...prev, selectedPageUrl: random.url }));
  }

  function clearChanges() {
    if (initialStateRef.current) {
      setState(initialStateRef.current);
      setVariantIndex(0);
      setScrapedImages([]);
      setScrapedTitle('');
      setScrapeError(null);
      return;
    }
    setState(DEFAULT_STATE);
  }

  function openTemplatePreview(templateId: number) {
    setState((prev) => {
      const selected = prev.selectedTemplateIds.includes(templateId)
        ? prev.selectedTemplateIds
        : [...prev.selectedTemplateIds, templateId];
      return {
        ...prev,
        selectedTemplateIds: selected,
        defaultTemplateId: prev.defaultTemplateId ?? templateId,
        activeTemplateId: templateId,
        previewOpen: true,
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
              onSelectPage={(url) => setState((prev) => ({ ...prev, selectedPageUrl: url }))}
              aiSettings={state.aiSettings}
              onAiSettingsChange={(next) => setState((prev) => ({ ...prev, aiSettings: next }))}
              fontSets={fontSets}
              selectedFontSetId={state.selectedFontSetId}
              onSelectFontSet={(id) => setState((prev) => ({ ...prev, selectedFontSetId: id, activeFontSetId: id }))}
              templates={templates}
              selectedTemplateIds={state.selectedTemplateIds}
              activeTemplateId={state.activeTemplateId}
              selectedPage={selectedPage}
              fontFamily={activeFontFamily}
              fontColor={state.activeFontColor}
              onSelectTemplates={(ids) => setState((prev) => ({
                ...prev,
                selectedTemplateIds: ids,
                defaultTemplateId: ids.includes(prev.defaultTemplateId || -1) ? prev.defaultTemplateId : (ids[0] ?? null),
              }))}
              onTemplateOpen={openTemplatePreview}
              imageSettings={state.imageSettings}
              displaySettings={state.displaySettings}
              advancedSettings={state.advancedSettings}
              onImageSettingsChange={(next) => setState((prev) => ({ ...prev, imageSettings: next }))}
              onDisplaySettingsChange={(next) => setState((prev) => ({ ...prev, displaySettings: next }))}
              onAdvancedSettingsChange={(next) => setState((prev) => ({ ...prev, advancedSettings: next }))}
              onDeleteTemplate={(templateId) => void handleDeleteTemplate(templateId)}
              onRemoveImages={() => setStatus('Remove Images action is ready for integration.')}
              onScrapeResult={(payload) => {
                setScrapeError(null);
                setScrapedImages(payload.images || []);
                setScrapedTitle(payload.title || '');
              }}
              onSaveDraft={() => void saveDraft()}
              saving={saving}
              onUploadTemplate={handleUploadTemplate}
              onUploadFont={handleUploadFont}
              uploadingTemplate={uploadingTemplate}
              uploadingFont={uploadingFont}
            />
            <div className="mt-2 text-xs text-slate-500">
              {isScraping ? 'Scraping selected page...' : scrapeError ? scrapeError : scrapedImages.length > 0 ? `${scrapedImages.length} scraped images ready for preview.` : 'Select a page to scrape images.'}
            </div>
          </CardContent>
        </Card>

        <Card className="hidden xl:block">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-slate-800">Template Preview</div>
            <p className="mt-1 text-xs text-slate-500">Click a template on the left to open the centered preview modal.</p>
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
        metadata={previewMeta}
        loading={previewLoading}
        zoom={state.zoom}
        onZoomChange={(zoom) => setState((prev) => ({ ...prev, zoom }))}
        variantIndex={variantIndex}
        variantTotal={variantTotal}
        onPrevVariant={() => setVariantIndex(0)}
        onNextVariant={() => setVariantIndex(0)}
        onRandomize={randomizePage}
        onClearChanges={clearChanges}
        onSelectTemplate={(id) => setState((prev) => ({ ...prev, activeTemplateId: id }))}
        scheduledDate={state.scheduledDate}
        onChangeDate={(value) => setState((prev) => ({ ...prev, scheduledDate: value }))}
        activeFontFamily={activeFontFamily}
        pageImages={scrapedImages.length > 0 ? scrapedImages : (selectedPage?.images || [])}
        scrapedTitle={scrapedTitle}
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
