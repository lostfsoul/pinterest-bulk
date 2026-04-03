import { useEffect, useMemo, useRef, useState } from 'react';
import apiClient, { Board, GenerationJob, GenerationPreview, GlobalExcludedImage, ImagePageSummary, PageImage, PinDraft, Template, Website } from '../services/api';
import { Button } from '../components/Button';
import { PinPreview } from '../components/PinPreview';
import { EditablePalette, normalizeHexColor, sampleImagePalette } from '../utils/palette';

const UNKNOWN_SITEMAP_KEY = '__unknown_sitemap__';

type Step = 1 | 2 | 3 | 4 | 5;
type Orientation = 'portrait' | 'square' | 'landscape';
type PreviewTab = 'pins' | 'images' | 'selected';
type SelectedImageFilter = 'all' | 'included' | 'excluded' | 'featured' | 'article' | 'other';
type GlobalRuleReason = 'affiliate' | 'logo' | 'tracking' | 'icon' | 'ad' | 'other';
type PageGroupingMode = 'prefix' | 'sitemap' | 'categories';
type CategoryViewMode = 'post_categories' | 'taxonomy_pages';
type PageKeywordFilter = 'all' | 'with_keywords';

type WorkflowSettings = {
  preview_page_id: number | null;
  ai: {
    generate_titles: boolean;
    generate_descriptions: boolean;
    variants: number;
    tone: string;
    keyword_mode: 'auto' | 'manual';
    manual_keywords: string;
    cta_style: 'soft' | 'strong' | 'none';
    language: string;
    title_max: number;
    description_max: number;
  };
  design: {
    template_ids: number[];
    font_choices: string[];
    palette_mode: 'auto' | 'brand' | 'manual';
    brand_palette: EditablePalette;
    manual_palette: EditablePalette;
  };
  image: {
    fetch_from_page: boolean;
    ignore_small_width: boolean;
    min_width: number;
    ignore_small_height: boolean;
    min_height: number;
    orientations: Orientation[];
    fetch_featured: boolean;
    use_same_image_once: boolean;
    match_palettes_to_images: boolean;
    ignore_images_with_text: boolean;
    show_full_image: boolean;
  };
  generation: {
    daily_pin_count: number;
    warmup_month: boolean;
    floating_days: boolean;
    randomize_posting_times: boolean;
    max_floating_minutes: number;
    timezone: string;
    start_hour: number;
    end_hour: number;
  };
  content: {
    desired_gap_days: number;
    lifetime_limit_enabled: boolean;
    lifetime_limit_count: number;
    monthly_limit_enabled: boolean;
    monthly_limit_count: number;
    no_link_pins: boolean;
  };
};

type GenerationProgress = {
  phase: 'idle' | 'preparing' | 'scraping' | 'drafting' | 'rendering' | 'complete' | 'error';
  label: string;
  current: number;
  total: number;
  percent: number;
  detail?: string;
};

const DEFAULT_SETTINGS: WorkflowSettings = {
  preview_page_id: null,
  ai: {
    generate_titles: true,
    generate_descriptions: true,
    variants: 1,
    tone: 'seo-friendly',
    keyword_mode: 'auto',
    manual_keywords: '',
    cta_style: 'soft',
    language: 'English',
    title_max: 100,
    description_max: 500,
  },
  design: {
    template_ids: [],
    font_choices: ['Bebas Neue'],
    palette_mode: 'auto',
    brand_palette: {
      background: '#ffffff',
      text: '#000000',
      effect: '#000000',
    },
    manual_palette: {
      background: '#ffffff',
      text: '#000000',
      effect: '#000000',
    },
  },
  image: {
    fetch_from_page: true,
    ignore_small_width: true,
    min_width: 200,
    ignore_small_height: false,
    min_height: 200,
    orientations: ['portrait', 'square', 'landscape'],
    fetch_featured: true,
    use_same_image_once: true,
    match_palettes_to_images: false,
    ignore_images_with_text: false,
    show_full_image: false,
  },
  generation: {
    daily_pin_count: 5,
    warmup_month: false,
    floating_days: true,
    randomize_posting_times: true,
    max_floating_minutes: 45,
    timezone: 'UTC',
    start_hour: 8,
    end_hour: 20,
  },
  content: {
    desired_gap_days: 31,
    lifetime_limit_enabled: false,
    lifetime_limit_count: 0,
    monthly_limit_enabled: false,
    monthly_limit_count: 0,
    no_link_pins: false,
  },
};

const IDLE_PROGRESS: GenerationProgress = {
  phase: 'idle',
  label: '',
  current: 0,
  total: 0,
  percent: 0,
};

function parseSettings(raw: unknown): WorkflowSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const source = raw as Record<string, unknown>;
  const ai = (source.ai && typeof source.ai === 'object' ? source.ai : source.ai_settings && typeof source.ai_settings === 'object' ? source.ai_settings : {}) as Record<string, unknown>;
  const design = (source.design && typeof source.design === 'object' ? source.design : source.design_settings && typeof source.design_settings === 'object' ? source.design_settings : {}) as Record<string, unknown>;
  const image = (source.image && typeof source.image === 'object' ? source.image : source.image_settings && typeof source.image_settings === 'object' ? source.image_settings : {}) as Record<string, unknown>;
  const generation = (source.generation && typeof source.generation === 'object' ? source.generation : {}) as Record<string, unknown>;
  const content = (source.content && typeof source.content === 'object' ? source.content : source.content_settings && typeof source.content_settings === 'object' ? source.content_settings : {}) as Record<string, unknown>;

  const templateIds = Array.isArray(design.template_ids)
    ? design.template_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : DEFAULT_SETTINGS.design.template_ids;
  const orientations = Array.isArray(image.orientations)
    ? image.orientations.filter((value): value is Orientation => value === 'portrait' || value === 'square' || value === 'landscape')
    : Array.isArray((image.allowed_orientations as unknown[]))
      ? (image.allowed_orientations as unknown[]).filter((value): value is Orientation => value === 'portrait' || value === 'square' || value === 'landscape')
      : DEFAULT_SETTINGS.image.orientations;

  return {
    ...DEFAULT_SETTINGS,
    preview_page_id: Number(source.preview_page_id ?? DEFAULT_SETTINGS.preview_page_id) || null,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      generate_titles: Boolean(ai.generate_titles ?? DEFAULT_SETTINGS.ai.generate_titles),
      generate_descriptions: Boolean(ai.generate_descriptions ?? DEFAULT_SETTINGS.ai.generate_descriptions),
      variants: Number(ai.variants ?? DEFAULT_SETTINGS.ai.variants),
      tone: String(ai.tone ?? DEFAULT_SETTINGS.ai.tone),
      keyword_mode: ai.keyword_mode === 'manual' ? 'manual' : 'auto',
      manual_keywords: String(ai.manual_keywords ?? DEFAULT_SETTINGS.ai.manual_keywords),
      cta_style: ai.cta_style === 'strong' || ai.cta_style === 'none' ? ai.cta_style : 'soft',
      language: String(ai.language ?? DEFAULT_SETTINGS.ai.language),
      title_max: Number(ai.title_max ?? DEFAULT_SETTINGS.ai.title_max),
      description_max: Number(ai.description_max ?? DEFAULT_SETTINGS.ai.description_max),
    },
    design: {
      ...DEFAULT_SETTINGS.design,
      template_ids: templateIds,
      font_choices: Array.isArray(design.font_choices) ? design.font_choices.map((f) => String(f)) : DEFAULT_SETTINGS.design.font_choices,
      palette_mode: design.palette_mode === 'brand' || design.palette_mode === 'manual' ? design.palette_mode : 'auto',
      brand_palette: {
        background: normalizeHexColor(String((design.brand_palette as Record<string, unknown> | undefined)?.background ?? '#ffffff'), '#ffffff'),
        text: normalizeHexColor(String((design.brand_palette as Record<string, unknown> | undefined)?.text ?? '#000000'), '#000000'),
        effect: normalizeHexColor(String((design.brand_palette as Record<string, unknown> | undefined)?.effect ?? '#000000'), '#000000'),
      },
      manual_palette: {
        background: normalizeHexColor(String((design.manual_palette as Record<string, unknown> | undefined)?.background ?? '#ffffff'), '#ffffff'),
        text: normalizeHexColor(String((design.manual_palette as Record<string, unknown> | undefined)?.text ?? '#000000'), '#000000'),
        effect: normalizeHexColor(String((design.manual_palette as Record<string, unknown> | undefined)?.effect ?? '#000000'), '#000000'),
      },
    },
    image: {
      ...DEFAULT_SETTINGS.image,
      fetch_from_page: Boolean(image.fetch_from_page ?? DEFAULT_SETTINGS.image.fetch_from_page),
      ignore_small_width: Boolean(image.ignore_small_width ?? DEFAULT_SETTINGS.image.ignore_small_width),
      min_width: Number(image.min_width ?? DEFAULT_SETTINGS.image.min_width),
      ignore_small_height: Boolean(image.ignore_small_height ?? DEFAULT_SETTINGS.image.ignore_small_height),
      min_height: Number(image.min_height ?? DEFAULT_SETTINGS.image.min_height),
      orientations: orientations.length > 0 ? orientations : DEFAULT_SETTINGS.image.orientations,
      fetch_featured: Boolean(image.fetch_featured ?? DEFAULT_SETTINGS.image.fetch_featured),
      use_same_image_once: Boolean(image.use_same_image_once ?? DEFAULT_SETTINGS.image.use_same_image_once),
      match_palettes_to_images: Boolean(image.match_palettes_to_images ?? DEFAULT_SETTINGS.image.match_palettes_to_images),
      ignore_images_with_text: Boolean(image.ignore_images_with_text ?? DEFAULT_SETTINGS.image.ignore_images_with_text),
      show_full_image: Boolean(image.show_full_image ?? DEFAULT_SETTINGS.image.show_full_image),
    },
    generation: {
      ...DEFAULT_SETTINGS.generation,
      daily_pin_count: Number(generation.daily_pin_count ?? DEFAULT_SETTINGS.generation.daily_pin_count),
      warmup_month: Boolean(generation.warmup_month ?? DEFAULT_SETTINGS.generation.warmup_month),
      floating_days: Boolean(generation.floating_days ?? DEFAULT_SETTINGS.generation.floating_days),
      randomize_posting_times: Boolean(generation.randomize_posting_times ?? DEFAULT_SETTINGS.generation.randomize_posting_times),
      max_floating_minutes: Number(generation.max_floating_minutes ?? DEFAULT_SETTINGS.generation.max_floating_minutes),
      timezone: String(generation.timezone ?? DEFAULT_SETTINGS.generation.timezone),
      start_hour: Number(generation.start_hour ?? DEFAULT_SETTINGS.generation.start_hour),
      end_hour: Number(generation.end_hour ?? DEFAULT_SETTINGS.generation.end_hour),
    },
    content: {
      ...DEFAULT_SETTINGS.content,
      desired_gap_days: Number(content.desired_gap_days ?? DEFAULT_SETTINGS.content.desired_gap_days),
      lifetime_limit_enabled: Boolean(content.lifetime_limit_enabled ?? DEFAULT_SETTINGS.content.lifetime_limit_enabled),
      lifetime_limit_count: Number(content.lifetime_limit_count ?? DEFAULT_SETTINGS.content.lifetime_limit_count),
      monthly_limit_enabled: Boolean(content.monthly_limit_enabled ?? DEFAULT_SETTINGS.content.monthly_limit_enabled),
      monthly_limit_count: Number(content.monthly_limit_count ?? DEFAULT_SETTINGS.content.monthly_limit_count),
      no_link_pins: Boolean(content.no_link_pins ?? DEFAULT_SETTINGS.content.no_link_pins),
    },
  };
}

function inferOrientation(image: PageImage): Orientation {
  const w = image.width ?? 0;
  const h = image.height ?? 0;
  if (!w || !h) return 'portrait';
  const ratio = w / h;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

function sortPreviewImages(images: PageImage[]): PageImage[] {
  return [...images].sort((a, b) => {
    const aRank = a.category === 'featured' ? 0 : a.category === 'article' ? 1 : 2;
    const bRank = b.category === 'featured' ? 0 : b.category === 'article' ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    const aArea = (a.width ?? 0) * (a.height ?? 0);
    const bArea = (b.width ?? 0) * (b.height ?? 0);
    return bArea - aArea;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function derivePagePrefix(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return `${parsed.origin}/`;
    return `${parsed.origin}/${pathParts[0]}/`;
  } catch {
    return '/';
  }
}

function derivePageCategory(page: ImagePageSummary): string {
  const pathParts = page.url
    .split('/')
    .filter(Boolean)
    .slice(2)
    .map((part) => part.toLowerCase());
  const firstSlug = pathParts[0] || '';
  const slugAsLabel = firstSlug.replace(/[-_]+/g, ' ').trim();

  if (page.sitemap_bucket === 'category' && slugAsLabel) return slugAsLabel;
  const section = (page.section || '').trim();
  const genericSection = new Set(['post', 'page', 'category', 'tag', 'author', 'attachment', 'uncategorized']);
  if (section && !genericSection.has(section.toLowerCase())) return section;
  const bucket = ((page.sitemap_bucket || '').trim() || 'unknown').toLowerCase();
  if (bucket && !new Set(['unknown', 'other']).has(bucket)) return bucket;
  if (slugAsLabel && firstSlug !== 'category') return slugAsLabel;
  return 'uncategorized';
}

function deriveTaxonomyLabel(page: ImagePageSummary): string {
  const pathParts = page.url
    .split('/')
    .filter(Boolean)
    .slice(2)
    .map((part) => part.toLowerCase());
  const slug = pathParts[0] || '';
  if (!slug) return 'taxonomy';
  return slug.replace(/[-_]+/g, ' ').trim();
}

function deriveSitemapLabel(source: string): string {
  if (source === UNKNOWN_SITEMAP_KEY) return 'Unknown sitemap';
  try {
    const parsed = new URL(source);
    const filename = parsed.pathname.split('/').filter(Boolean).pop();
    return filename || source;
  } catch {
    return source;
  }
}

function setActiveGenerationJobId(jobId: number | null) {
  if (jobId == null) {
    localStorage.removeItem('active_generation_job_id');
  } else {
    localStorage.setItem('active_generation_job_id', String(jobId));
  }
  window.dispatchEvent(new CustomEvent<number | null>('generation-job-change', { detail: jobId }));
}

function formatCustomFontLabel(family: string, filename: string): string {
  const normalized = (family || '').trim();
  if (normalized && normalized.toLowerCase() !== 'custom font') return normalized;
  const stem = filename.replace(/\.[^/.]+$/, '');
  const slug = stem.includes('__') ? stem.split('__')[1] : stem;
  const readable = slug.replace(/[-_]+/g, ' ').trim();
  return readable || 'Custom Font';
}

function normalizeEditablePalette(palette: EditablePalette | null | undefined): EditablePalette {
  return {
    background: normalizeHexColor(palette?.background, '#ffffff'),
    text: normalizeHexColor(palette?.text, '#000000'),
    effect: normalizeHexColor(palette?.effect, '#000000'),
  };
}

function boardMatchesSelectedPages(board: Board, selectedPageIds: Set<number>): boolean {
  const sourcePageIds = Array.isArray(board.source_page_ids) ? board.source_page_ids : [];
  if (sourcePageIds.length === 0) return false;
  return sourcePageIds.some((pageId) => selectedPageIds.has(pageId));
}

export default function Generate() {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateFonts, setTemplateFonts] = useState<Array<{ filename: string; family: string }>>([]);
  const [pages, setPages] = useState<ImagePageSummary[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [previewResult, setPreviewResult] = useState<GenerationPreview | null>(null);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<WorkflowSettings>(DEFAULT_SETTINGS);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('pins');
  const [pageSearch, setPageSearch] = useState('');
  const [pageKeywordFilter, setPageKeywordFilter] = useState<PageKeywordFilter>('all');
  const [pageGroupingMode, setPageGroupingMode] = useState<PageGroupingMode>('prefix');
  const [categoryViewMode, setCategoryViewMode] = useState<CategoryViewMode>('post_categories');
  const [collapsedPageGroups, setCollapsedPageGroups] = useState<Set<string>>(new Set());
  const [newBoardName, setNewBoardName] = useState('');
  const [boardSuggestCount, setBoardSuggestCount] = useState(5);
  const [replaceAiBoardsOnSuggest, setReplaceAiBoardsOnSuggest] = useState(true);
  const [allPageImages, setAllPageImages] = useState<Map<number, PageImage[]>>(new Map());
  const [autoScrapedPreviewPages, setAutoScrapedPreviewPages] = useState<Set<number>>(new Set());
  const [selectedImageFilter, setSelectedImageFilter] = useState<SelectedImageFilter>('all');
  const [selectedImageDetail, setSelectedImageDetail] = useState<PageImage | null>(null);
  const [previewStyle, setPreviewStyle] = useState({
    textZoneY: 0,
    textZoneHeight: 140,
    textZonePadLeft: 0,
    textZonePadRight: 0,
    textZoneBgColor: '#ffffff',
    fontFamily: '"Bebas Neue", Impact, sans-serif',
    textColor: '#000000',
    textAlign: 'left' as 'left' | 'center',
    textEffect: 'none' as 'none' | 'drop' | 'echo' | 'outline',
    textEffectColor: '#000000',
    textEffectOffsetX: 2,
    textEffectOffsetY: 2,
    textEffectBlur: 0,
    customFontFile: null as string | null,
  });
  const [globalRules, setGlobalRules] = useState<GlobalExcludedImage[]>([]);
  const [newGlobalRuleUrl, setNewGlobalRuleUrl] = useState('');
  const [newGlobalRuleName, setNewGlobalRuleName] = useState('');
  const [newGlobalRuleReason, setNewGlobalRuleReason] = useState<GlobalRuleReason>('other');
  const [step5Status, setStep5Status] = useState<{ type: 'idle' | 'info' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  });
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>(IDLE_PROGRESS);
  const [generationJobId, setGenerationJobId] = useState<number | null>(null);
  const websiteLoadSeqRef = useRef(0);

  useEffect(() => {
    void loadInitial();
    const stored = localStorage.getItem('active_website_id');
    if (stored) setActiveWebsiteId(Number(stored));
    const onSwitch = (event: Event) => {
      const custom = event as CustomEvent<number>;
      setActiveWebsiteId(custom.detail ?? null);
      setStep(1);
    };
    window.addEventListener('website-switch', onSwitch as EventListener);
    return () => window.removeEventListener('website-switch', onSwitch as EventListener);
  }, []);

  useEffect(() => {
    if (!activeWebsiteId) return;
    localStorage.setItem('active_website_id', String(activeWebsiteId));
    loadWebsiteContext(activeWebsiteId).catch((error) => {
      console.error('Failed to load website context:', error);
    });
  }, [activeWebsiteId]);

  const previewPage = useMemo(
    () => pages.find((p) => p.id === settings.preview_page_id) ?? pages[0] ?? null,
    [pages, settings.preview_page_id],
  );

  useEffect(() => {
    if (!previewPage) return;
    void loadImagesForPage(previewPage.id);
  }, [previewPage?.id]);

  useEffect(() => {
    if (!generationJobId) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const response = await apiClient.getGenerationJob(generationJobId);
        if (cancelled) return;
        const job = response.data;
        setGenerationProgress(mapJobToProgress(job));

        if (job.status === 'completed') {
          window.clearInterval(interval);
          setGenerating(false);
          setGenerationJobId(null);
          const pinsRes = await apiClient.listPins();
          if (cancelled) return;
          setPins(pinsRes.data);
          setStep5Status({
            type: 'success',
            message: job.message || `Generated ${job.total_pins} pins. Review and export CSV from this onboarding flow.`,
          });
        } else if (job.status === 'failed') {
          window.clearInterval(interval);
          setGenerating(false);
          setGenerationJobId(null);
          setStep5Status({
            type: 'error',
            message: job.error_detail || job.message || 'Generation job failed',
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to poll generation job:', error);
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [generationJobId]);

  const filteredPages = useMemo(() => {
    const term = pageSearch.trim().toLowerCase();
    return pages.filter((page) => {
      if (pageKeywordFilter === 'with_keywords' && !page.has_keywords) return false;
      if (!term) return true;
      return (page.title || '').toLowerCase().includes(term) || page.url.toLowerCase().includes(term);
    });
  }, [pages, pageSearch, pageKeywordFilter]);

  const groupedPages = useMemo(() => {
    const map = new Map<string, { label: string; pages: ImagePageSummary[] }>();
    const pagesForGrouping =
      pageGroupingMode === 'categories' && categoryViewMode === 'taxonomy_pages'
        ? filteredPages.filter((page) => page.sitemap_bucket === 'category' || page.sitemap_bucket === 'tag')
        : filteredPages;

    for (const page of pagesForGrouping) {
      let key = '';
      let label = '';
      if (pageGroupingMode === 'prefix') {
        key = derivePagePrefix(page.url).toLowerCase();
        label = derivePagePrefix(page.url);
      } else if (pageGroupingMode === 'categories') {
        const category = categoryViewMode === 'taxonomy_pages'
          ? deriveTaxonomyLabel(page)
          : derivePageCategory(page);
        key = category.toLowerCase();
        label = category;
      } else {
        const source = page.sitemap_source?.trim() || UNKNOWN_SITEMAP_KEY;
        key = source.toLowerCase();
        label = deriveSitemapLabel(source);
      }

      if (!map.has(key)) map.set(key, { label, pages: [] });
      map.get(key)?.pages.push(page);
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, label: value.label, pages: value.pages }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredPages, pageGroupingMode, categoryViewMode]);

  const canStep2 = Boolean(previewPage && settings.design.template_ids.length > 0);
  const canStep3 = canStep2;
  const canStep4 = Boolean(activeWebsiteId) && selectedPageIds.size > 0;
  const visibleBoards = useMemo(
    () => boards.filter((board) => boardMatchesSelectedPages(board, selectedPageIds)),
    [boards, selectedPageIds],
  );
  const canStep5 = Boolean(activeWebsiteId) && canStep4 && visibleBoards.length > 0;

  async function loadInitial() {
    setLoading(true);
    try {
      const stored = localStorage.getItem('active_website_id');
      const storedId = stored ? Number(stored) : null;
      const [websitesRes, templatesRes, pinsRes, fontsRes] = await Promise.all([
        apiClient.listWebsites(),
        apiClient.listTemplates(),
        apiClient.listPins(),
        apiClient.listTemplateFonts(),
      ]);
      setWebsites(websitesRes.data);
      setTemplates(templatesRes.data);
      setPins(pinsRes.data);
      setTemplateFonts(fontsRes.data.fonts || []);
      if (websitesRes.data.length > 0) {
        const preferredId =
          (storedId && websitesRes.data.some((website) => website.id === storedId) ? storedId : null) ??
          (activeWebsiteId && websitesRes.data.some((website) => website.id === activeWebsiteId) ? activeWebsiteId : null) ??
          websitesRes.data[0].id;
        setActiveWebsiteId(preferredId);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadWebsiteContext(websiteId: number) {
    const seq = ++websiteLoadSeqRef.current;
    setLoading(true);
    setPages([]);
    setBoards([]);
    setSelectedPageIds(new Set());
    setPreviewResult(null);
    setAllPageImages(new Map());
    setStep5Status({ type: 'idle', message: '' });
    setGenerationProgress(IDLE_PROGRESS);
    setGenerationJobId(null);
    try {
      const [pagesRes, settingsRes, boardsRes, rulesRes] = await Promise.all([
        apiClient.listImagePages({ website_id: websiteId }),
        apiClient.getWebsiteGenerationSettings(websiteId),
        apiClient.listBoards(websiteId),
        apiClient.listGlobalExclusions(),
      ]);
      if (seq !== websiteLoadSeqRef.current) return;
      setPages(pagesRes.data);
      setSelectedPageIds(new Set());
      setBoards(boardsRes.data);
      setGlobalRules(rulesRes.data);
      const parsed = parseSettings(settingsRes.data.settings);
      if (!parsed.preview_page_id && pagesRes.data.length > 0) {
        const preferred =
          pagesRes.data.find((page) => page.is_enabled && page.sitemap_bucket === 'post' && !page.is_utility_page) ??
          pagesRes.data.find((page) => page.is_enabled && page.sitemap_bucket === 'post') ??
          pagesRes.data.find((page) => page.sitemap_bucket === 'post') ??
          pagesRes.data[0];
        parsed.preview_page_id = preferred.id;
      }
      if (parsed.design.template_ids.length === 0 && templates.length > 0) parsed.design.template_ids = [templates[0].id];
      setSettings(parsed);
    } finally {
      if (seq === websiteLoadSeqRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadImagesForPage(pageId: number) {
    const response = await apiClient.getPageImages(pageId);
    let images = response.data;

    if (images.length === 0 && settings.image.fetch_from_page && !autoScrapedPreviewPages.has(pageId)) {
      try {
        const scraped = await apiClient.scrapePageImages(pageId);
        images = scraped.data;
        setAutoScrapedPreviewPages((prev) => new Set(prev).add(pageId));
      } catch (error) {
        console.error('Auto scrape for preview failed:', error);
      }
    }

    setAllPageImages((prev) => new Map(prev).set(pageId, images));
  }

  async function refreshGlobalRules() {
    const response = await apiClient.listGlobalExclusions();
    setGlobalRules(response.data);
  }

  async function addGlobalRule() {
    const urlPattern = newGlobalRuleUrl.trim();
    const namePattern = newGlobalRuleName.trim();
    if (!urlPattern && !namePattern) return;
    await apiClient.createGlobalExclusion({
      url_pattern: urlPattern || undefined,
      name_pattern: namePattern || undefined,
      reason: newGlobalRuleReason,
    });
    setNewGlobalRuleUrl('');
    setNewGlobalRuleName('');
    setNewGlobalRuleReason('other');
    await refreshGlobalRules();
  }

  async function deleteGlobalRule(ruleId: number) {
    await apiClient.deleteGlobalExclusion(ruleId);
    if (previewPage) await loadImagesForPage(previewPage.id);
    await refreshGlobalRules();
  }

  async function applyGlobalRule(ruleId: number) {
    await apiClient.applyGlobalExclusion(ruleId);
    if (previewPage) await loadImagesForPage(previewPage.id);
    await refreshGlobalRules();
  }

  async function setImageExcluded(image: PageImage, excluded: boolean) {
    const response = await apiClient.updateImage(image.id, { is_excluded: excluded });
    const updated = response.data;
    setAllPageImages((prev) => {
      const next = new Map(prev);
      for (const [pageId, items] of next.entries()) {
        if (!items.some((img) => img.id === updated.id)) continue;
        next.set(pageId, items.map((img) => (img.id === updated.id ? updated : img)));
        break;
      }
      return next;
    });
  }

  async function setSelectedImagesExcluded(excluded: boolean) {
    const candidates = selectedImagesList.filter((img) => !img.excluded_by_global_rule && img.is_excluded !== excluded);
    for (const image of candidates) {
      await setImageExcluded(image, excluded);
    }
  }

  async function saveSettings() {
    if (!activeWebsiteId) return;
    setSaving(true);
    try {
      await apiClient.updateWebsiteGenerationSettings(activeWebsiteId, settings as unknown as Record<string, unknown>);
      await apiClient.updateScheduleSettings({
        pins_per_day: settings.generation.daily_pin_count,
        start_hour: settings.generation.start_hour,
        end_hour: settings.generation.end_hour,
        min_days_reuse: Math.max(31, settings.content.desired_gap_days),
        random_minutes: settings.generation.randomize_posting_times,
        warmup_month: settings.generation.warmup_month,
        floating_days: settings.generation.floating_days,
        max_floating_minutes: settings.generation.max_floating_minutes,
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function suggestBoards() {
    if (!activeWebsiteId) {
      setStep5Status({ type: 'error', message: 'No active website selected.' });
      return;
    }
    try {
      const currentSelectedIds = Array.from(selectedPageIds);
      const response = await apiClient.suggestBoards({
        website_id: activeWebsiteId,
        count: boardSuggestCount,
        page_ids: currentSelectedIds,
      });
      if (replaceAiBoardsOnSuggest) {
        const existingAiBoards = boards.filter((board) => board.source_type === 'ai' && boardMatchesSelectedPages(board, selectedPageIds));
        await Promise.allSettled(existingAiBoards.map((board) => apiClient.deleteBoard(board.id)));
      }
      const existingNow = await apiClient.listBoards(activeWebsiteId);
      const existingNames = new Set(existingNow.data.map((board) => board.name.toLowerCase()));
      for (const name of response.data.suggestions) {
        if (!existingNames.has(name.toLowerCase())) {
          await apiClient.createBoard({
            website_id: activeWebsiteId,
            name,
            source_type: 'ai',
            source_page_ids: response.data.page_ids_used,
          });
          existingNames.add(name.toLowerCase());
        }
      }
      const refresh = await apiClient.listBoards(activeWebsiteId);
      setBoards(refresh.data);
    } catch (error) {
      const message = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail || (error as Error)?.message || 'Board generation failed';
      setStep5Status({ type: 'error', message });
    }
  }

  async function addBoard() {
    if (!activeWebsiteId || !newBoardName.trim()) return;
    await apiClient.createBoard({
      website_id: activeWebsiteId,
      name: newBoardName.trim(),
      source_type: 'manual',
      source_page_ids: Array.from(selectedPageIds),
    });
    setNewBoardName('');
    const refresh = await apiClient.listBoards(activeWebsiteId);
    setBoards(refresh.data);
  }

  async function removeBoard(id: number) {
    await apiClient.deleteBoard(id);
    if (activeWebsiteId) {
      const refresh = await apiClient.listBoards(activeWebsiteId);
      setBoards(refresh.data);
    }
  }

  async function runPreview() {
    if (!activeWebsiteId || settings.design.template_ids.length === 0) {
      setStep5Status({ type: 'error', message: 'Select an active website and template first.' });
      return;
    }
    setPreviewing(true);
    setStep5Status({ type: 'info', message: 'Building preview estimate...' });
    try {
      const selectedIds = Array.from(selectedPageIds);
      await ensureSelectedPagesEnabled(selectedIds);
      if (selectedIds.length > 0) {
        const prep = await ensureImagesForPages(selectedIds);
        if (prep.scraped > 0) {
          setStep5Status({ type: 'info', message: `Preparing preview: scraped ${prep.scraped} page(s) with missing images...` });
        }
      }
      const response = await apiClient.previewPins({
        website_id: activeWebsiteId,
        template_id: settings.design.template_ids[0],
        page_ids: selectedIds,
        mode: settings.ai.variants > 1 ? 'matrix' : 'conservative',
        variation_options: {
          text_variations: settings.ai.variants,
        },
      });
      setPreviewResult(response.data);
      setStep(5);
      setStep5Status({
        type: 'success',
        message: `Preview ready: ${response.data.estimated_pins} projected pins from ${response.data.pages_count} pages.`,
      });
    } catch (error) {
      console.error('Preview failed:', error);
      const message = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail || (error as Error)?.message || 'Failed to preview';
      setStep5Status({ type: 'error', message });
    } finally {
      setPreviewing(false);
    }
  }

  async function generatePins() {
    if (!activeWebsiteId) {
      setStep5Status({ type: 'error', message: 'No active website selected.' });
      return;
    }
    if (!canStep5) {
      setStep5Status({ type: 'error', message: 'Generation is not ready yet. Ensure pages and at least one board are selected.' });
      return;
    }
    setGenerating(true);
    setGenerationProgress({
      phase: 'preparing',
      label: 'Preparing selected pages',
      current: 0,
      total: Math.max(1, selectedPageIds.size),
      percent: 5,
      detail: 'Sending job to backend',
    });
    setStep5Status({ type: 'info', message: `Generating pin drafts for ${selectedPageIds.size} selected pages...` });
    try {
      const selectedIds = Array.from(selectedPageIds);
      await ensureSelectedPagesEnabled(selectedIds);
      const response = await apiClient.startGenerationJob({
        website_id: activeWebsiteId,
        template_id: settings.design.template_ids[0],
        page_ids: selectedIds,
        board_name: visibleBoards[0]?.name || 'General',
        use_ai_titles: settings.ai.generate_titles,
        generate_descriptions: settings.ai.generate_descriptions,
        tone: settings.ai.tone,
        keyword_mode: settings.ai.keyword_mode,
        manual_keywords: settings.ai.manual_keywords,
        cta_style: settings.ai.cta_style,
        title_max: settings.ai.title_max,
        description_max: settings.ai.description_max,
        render_settings: {
          text_zone_y: previewStyle.textZoneY,
          text_zone_height: previewStyle.textZoneHeight,
          text_zone_pad_left: previewStyle.textZonePadLeft,
          text_zone_pad_right: previewStyle.textZonePadRight,
          palette_mode: settings.design.palette_mode,
          text_zone_bg_color: previewStyle.textZoneBgColor,
          brand_palette_background_color: settings.design.brand_palette.background,
          brand_palette_text_color: settings.design.brand_palette.text,
          brand_palette_effect_color: settings.design.brand_palette.effect,
          manual_palette_background_color: settings.design.manual_palette.background,
          manual_palette_text_color: settings.design.manual_palette.text,
          manual_palette_effect_color: settings.design.manual_palette.effect,
          font_family: previewStyle.fontFamily,
          custom_font_file: previewStyle.customFontFile,
          text_color: previewStyle.textColor,
          text_align: previewStyle.textAlign,
          text_effect: previewStyle.textEffect,
          text_effect_color: previewStyle.textEffectColor,
          text_effect_offset_x: previewStyle.textEffectOffsetX,
          text_effect_offset_y: previewStyle.textEffectOffsetY,
          text_effect_blur: previewStyle.textEffectBlur,
        },
        mode: settings.ai.variants > 1 ? 'matrix' : 'conservative',
        variation_options: {
          text_variations: settings.ai.variants,
        },
      });
      setGenerationJobId(response.data.id);
      setActiveGenerationJobId(response.data.id);
      setGenerationProgress(mapJobToProgress(response.data));
      setStep5Status({
        type: 'info',
        message: response.data.message || 'Generation job started. Progress will update automatically.',
      });
    } catch (error) {
      console.error('Generation failed:', error);
      const message = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail || (error as Error)?.message || 'Generation failed';
      setGenerationProgress((prev) => ({
        ...prev,
        phase: 'error',
        label: 'Generation failed',
        detail: message,
      }));
      setStep5Status({ type: 'error', message });
      setGenerationJobId(null);
      setActiveGenerationJobId(null);
      setGenerating(false);
    }
  }

  async function exportGeneratedCsv() {
    if (pins.length === 0) {
      setStep5Status({ type: 'error', message: 'No generated pins to export yet. Generate first.' });
      return;
    }
    setExporting(true);
    try {
      const response = await apiClient.exportCsv({ selected_only: false });
      window.open(response.data.download_url, '_blank');
      setStep5Status({
        type: 'success',
        message: `CSV exported with ${response.data.pins_count} pins.`,
      });
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (error as Error)?.message ||
        'CSV export failed';
      setStep5Status({ type: 'error', message });
    } finally {
      setExporting(false);
    }
  }

  async function ensureImagesForPages(
    pageIds: number[],
    onProgress?: (progress: { current: number; total: number; scraped: number; failed: number }) => void,
  ) {
    let scraped = 0;
    let failed = 0;
    let current = 0;

    for (const pageId of pageIds) {
      let images = allPageImages.get(pageId);
      if (!images) {
        try {
          const existing = await apiClient.getPageImages(pageId);
          images = existing.data;
          setAllPageImages((prev) => new Map(prev).set(pageId, images || []));
        } catch {
          images = [];
        }
      }

      if ((images || []).length === 0) {
        try {
          const scrapedResponse = await apiClient.scrapePageImages(pageId);
          const scrapedImages = scrapedResponse.data || [];
          setAllPageImages((prev) => new Map(prev).set(pageId, scrapedImages));
          if (scrapedImages.length > 0) scraped += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }

      current += 1;
      onProgress?.({ current, total: pageIds.length, scraped, failed });
    }

    return { scraped, failed };
  }

  function goToStep(next: Step) {
    if (next === 1) return setStep(1);
    if (next === 2 && canStep2) return setStep(2);
    if (next === 3 && canStep3) return setStep(3);
    if (next === 4 && canStep4) return setStep(4);
    if (next === 5 && canStep5) return setStep(5);
  }

  async function togglePage(id: number) {
    const page = pages.find((item) => item.id === id);
    if (!page) return;

    if (!page.is_enabled) {
      try {
        await apiClient.updatePage(id, { is_enabled: true });
        setPages((prev) => prev.map((item) => (item.id === id ? { ...item, is_enabled: true } : item)));
      } catch (error) {
        console.error('Failed to enable page:', error);
      }
    }

    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ensureSelectedPagesEnabled(pageIds: number[]) {
    const toEnable = pages.filter((page) => pageIds.includes(page.id) && !page.is_enabled);
    if (toEnable.length === 0) return;

    await Promise.allSettled(
      toEnable.map((page) => apiClient.updatePage(page.id, { is_enabled: true })),
    );
    setPages((prev) => prev.map((page) => (pageIds.includes(page.id) ? { ...page, is_enabled: true } : page)));
  }

  function setVisibleSelection(selected: boolean) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (const page of filteredPages) {
        if (selected) next.add(page.id);
        else next.delete(page.id);
      }
      return next;
    });
  }

  function toggleGroupPages(groupPages: ImagePageSummary[]) {
    const allSelected = groupPages.every((page) => selectedPageIds.has(page.id));
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (const page of groupPages) {
        if (allSelected) next.delete(page.id);
        else next.add(page.id);
      }
      return next;
    });
  }

  function toggleGroupCollapsed(groupKey: string) {
    setCollapsedPageGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function randomizePreview() {
    setPreviewResult((prev) => (prev ? { ...prev, sample: shuffle(prev.sample) } : prev));
  }

  function mapJobToProgress(job: GenerationJob): GenerationProgress {
    if (job.status === 'failed') {
      return {
        phase: 'error',
        label: 'Generation failed',
        current: job.rendered_pins || job.processed_pages,
        total: job.total_pins || job.total_pages,
        percent: 100,
        detail: job.error_detail || job.message || 'Job failed',
      };
    }

    if (job.status === 'completed' || job.phase === 'complete') {
      return {
        phase: 'complete',
        label: 'Generation complete',
        current: job.total_pins || job.total_pages,
        total: job.total_pins || job.total_pages,
        percent: 100,
        detail: job.message || `${job.total_pins} pins generated`,
      };
    }

    if (job.phase === 'rendering') {
      const total = Math.max(1, job.total_pins);
      return {
        phase: 'rendering',
        label: 'Rendering pin images',
        current: job.rendered_pins,
        total,
        percent: Math.round(60 + (job.rendered_pins / total) * 40),
        detail: job.message || `${job.rendered_pins} of ${total} rendered`,
      };
    }

    if (job.phase === 'drafting') {
      const total = Math.max(1, job.total_pages);
      return {
        phase: 'drafting',
        label: 'Creating pin drafts',
        current: job.processed_pages,
        total,
        percent: Math.round(20 + (job.processed_pages / total) * 40),
        detail: job.message || `${job.processed_pages} of ${total} pages processed`,
      };
    }

    if (job.phase === 'scraping') {
      const total = Math.max(1, job.total_pages);
      return {
        phase: 'scraping',
        label: 'Scraping missing page images',
        current: job.processed_pages,
        total,
        percent: Math.round(5 + (job.processed_pages / total) * 25),
        detail: job.message || `${job.scraped_pages} pages scraped`,
      };
    }

    return {
      phase: 'preparing',
      label: 'Preparing generation job',
      current: 0,
      total: Math.max(1, job.total_pages),
      percent: 5,
      detail: job.message || 'Queued',
    };
  }

  const selectedTemplate = templates.find((template) => template.id === settings.design.template_ids[0]) ?? null;

  useEffect(() => {
    if (templates.length === 0) return;
    const selectedId = settings.design.template_ids[0];
    const exists = typeof selectedId === 'number' && templates.some((template) => template.id === selectedId);
    if (exists) return;
    setSettings((prev) => ({
      ...prev,
      design: { ...prev.design, template_ids: [templates[0].id] },
    }));
  }, [templates, settings.design.template_ids]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const templateTextZone = selectedTemplate.zones?.find((zone) => zone.zone_type === 'text');
    if (!templateTextZone) return;
    const props = (templateTextZone.props || {}) as Record<string, unknown>;
    const left = Math.max(0, templateTextZone.x);
    const right = Math.max(0, selectedTemplate.width - (templateTextZone.x + templateTextZone.width));
    setPreviewStyle((prev) => ({
      ...prev,
      textZoneY: templateTextZone.y,
      textZoneHeight: templateTextZone.height,
      textZonePadLeft: left,
      textZonePadRight: right,
      textZoneBgColor: String(props.text_zone_bg_color || prev.textZoneBgColor || '#ffffff'),
      textAlign: props.text_align === 'center' ? 'center' : 'left',
      fontFamily: String(props.font_family || prev.fontFamily),
      textColor: String(props.text_color || prev.textColor),
      textEffect: ((props.text_effect as 'none' | 'drop' | 'echo' | 'outline') || 'none'),
      textEffectColor: String(props.text_effect_color || '#000000'),
      textEffectOffsetX: Number(props.text_effect_offset_x || 2),
      textEffectOffsetY: Number(props.text_effect_offset_y || 2),
      textEffectBlur: Number(props.text_effect_blur || 0),
      // Do not auto-select custom fonts on template switch in Generate.
      // User explicitly picks custom font from the dropdown when needed.
      customFontFile: null,
    }));
  }, [selectedTemplate?.id]);

  const fontOptions = useMemo(() => {
    const options: Array<{ key: string; label: string; family: string; customFile: string | null }> = [
      { key: 'builtin:bebas', label: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', customFile: null },
      { key: 'builtin:montserrat', label: 'Montserrat', family: '"Montserrat", "Arial Black", sans-serif', customFile: null },
      { key: 'builtin:playfair', label: 'Playfair Display', family: '"Playfair Display", Georgia, serif', customFile: null },
      { key: 'builtin:oswald', label: 'Oswald', family: '"Oswald", Impact, sans-serif', customFile: null },
      { key: 'builtin:poppins', label: 'Poppins', family: '"Poppins", Arial, sans-serif', customFile: null },
    ];
    for (const font of templateFonts) {
      const label = formatCustomFontLabel(font.family, font.filename);
      const family = `"${label}", sans-serif`;
      options.push({
        key: `custom:${font.filename}`,
        label: `${label} (Custom)`,
        family,
        customFile: font.filename,
      });
    }
    return options;
  }, [templateFonts]);

  const selectedFontKey = useMemo(() => {
    if (previewStyle.customFontFile) {
      return `custom:${previewStyle.customFontFile}`;
    }
    const matchedBuiltin = fontOptions.find(
      (option) => option.customFile === null && option.family === previewStyle.fontFamily,
    );
    return matchedBuiltin?.key || 'builtin:bebas';
  }, [fontOptions, previewStyle.customFontFile, previewStyle.fontFamily]);

  const previewPageImagesAll = previewPage ? allPageImages.get(previewPage.id) || [] : [];
  const previewEligibleImages = (() => {
    let images = [...previewPageImagesAll];
    if (settings.image.ignore_small_width) {
      images = images.filter((img) => img.width == null || img.width >= settings.image.min_width);
    }
    if (settings.image.ignore_small_height) {
      images = images.filter((img) => img.height == null || img.height >= settings.image.min_height);
    }
    images = images.filter((img) => settings.image.orientations.includes(inferOrientation(img)));
    return images;
  })();
  const previewImages = sortPreviewImages(
    previewEligibleImages.filter((img) => !img.is_excluded && !img.excluded_by_global_rule),
  );
  const previewPaletteSourceUrl = previewImages[0] ? apiClient.proxyImageUrl(previewImages[0].url) : null;
  const templateImageSlots = Math.max(1, selectedTemplate?.zones?.filter((zone) => zone.zone_type === 'image').length ?? 2);
  const previewPinImageUrls = previewImages
    .slice(0, templateImageSlots)
    .map((img) => apiClient.proxyImageUrl(img.url));

  useEffect(() => {
    let cancelled = false;

    const applyResolvedPalette = async () => {
      const brandPalette = normalizeEditablePalette(settings.design.brand_palette);
      const manualPalette = normalizeEditablePalette(settings.design.manual_palette);
      let nextPalette: EditablePalette;

      if (settings.design.palette_mode === 'brand') {
        nextPalette = brandPalette;
      } else if (settings.design.palette_mode === 'manual') {
        nextPalette = manualPalette;
      } else {
        const sampled = previewPaletteSourceUrl ? await sampleImagePalette(previewPaletteSourceUrl) : null;
        nextPalette = sampled || brandPalette || manualPalette;
      }

      if (cancelled) return;
      setPreviewStyle((prev) => {
        const normalized = normalizeEditablePalette(nextPalette);
        if (
          prev.textZoneBgColor === normalized.background &&
          prev.textColor === normalized.text &&
          prev.textEffectColor === normalized.effect
        ) {
          return prev;
        }
        return {
          ...prev,
          textZoneBgColor: normalized.background,
          textColor: normalized.text,
          textEffectColor: normalized.effect,
        };
      });
    };

    void applyResolvedPalette();
    return () => {
      cancelled = true;
    };
  }, [
    previewPaletteSourceUrl,
    settings.design.brand_palette,
    settings.design.manual_palette,
    settings.design.palette_mode,
  ]);

  if (loading && websites.length === 0) {
    return <div className="text-gray-500">Loading workflow...</div>;
  }

  const selectedImagesList = (() => {
    if (selectedImageFilter === 'all') return previewPageImagesAll;
    if (selectedImageFilter === 'included') return previewEligibleImages.filter((img) => !img.is_excluded && !img.excluded_by_global_rule);
    if (selectedImageFilter === 'excluded') return previewPageImagesAll.filter((img) => img.is_excluded || img.excluded_by_global_rule);
    return previewPageImagesAll.filter((img) => img.category === selectedImageFilter);
  })();

  return (
    <div className="space-y-4">
      <div className="bg-white border-2 border-black p-4">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase">Pin Workflow</h1>
            <p className="text-xs text-gray-600">CSV-only generation flow with preview, scheduling metadata, and board assignment</p>
          </div>
          <div className="text-xs border border-black px-2 py-1 bg-bg-secondary">
            Active website: {websites.find((w) => w.id === activeWebsiteId)?.name || 'None'}
          </div>
        </div>
      </div>

      <div className="bg-white border-2 border-black p-3">
        <div className="grid grid-cols-5 gap-2">
          {[
            [1, 'Pin Preview'],
            [2, 'Generation Settings'],
            [3, 'Pages To Use'],
            [4, 'Boards To Use'],
            [5, 'Review & Generate'],
          ].map(([id, label]) => {
            const stepId = id as Step;
            const enabled = stepId === 1 || (stepId === 2 && canStep2) || (stepId === 3 && canStep3) || (stepId === 4 && canStep4) || (stepId === 5 && canStep5);
            return (
              <button
                key={id}
                onClick={() => goToStep(stepId)}
                disabled={!enabled}
                className={`text-[11px] px-2 py-2 border-2 font-black uppercase ${
                  step === stepId ? 'bg-accent text-white border-black' : enabled ? 'bg-bg-secondary border-black' : 'bg-gray-100 text-gray-400 border-gray-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_560px] gap-4">
        <div className="bg-white border-2 border-black p-4 space-y-4">
          {step === 1 && (
            <div className="space-y-4 max-w-4xl">
              <h2 className="font-black uppercase">Select Page</h2>
              <select
                value={settings.preview_page_id ?? ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, preview_page_id: Number(e.target.value) }))}
                className="w-full px-3 py-2 border-2 border-black"
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>{page.title || page.url}</option>
                ))}
              </select>

              <div className="border border-black">
                <div className="px-3 py-2 bg-bg-secondary font-black text-sm">AI Content Generation</div>
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={settings.ai.generate_titles} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, generate_titles: e.target.checked } }))} />Generate titles</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={settings.ai.generate_descriptions} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, generate_descriptions: e.target.checked } }))} />Generate descriptions</label>
                  <input value={settings.ai.tone} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, tone: e.target.value } }))} className="px-2 py-1 border border-black" placeholder="Tone (seo-friendly/clickable/etc.)" />
                  <input type="number" min={1} max={10} value={settings.ai.variants} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, variants: Number(e.target.value) } }))} className="px-2 py-1 border border-black" />
                  <select value={settings.ai.keyword_mode} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, keyword_mode: e.target.value as 'auto' | 'manual' } }))} className="px-2 py-1 border border-black">
                    <option value="auto">Keywords: Auto</option>
                    <option value="manual">Keywords: Manual</option>
                  </select>
                  <input value={settings.ai.manual_keywords} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, manual_keywords: e.target.value } }))} className="px-2 py-1 border border-black" placeholder="Manual keywords (comma-separated)" disabled={settings.ai.keyword_mode !== 'manual'} />
                  <select value={settings.ai.cta_style} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, cta_style: e.target.value as 'soft' | 'strong' | 'none' } }))} className="px-2 py-1 border border-black">
                    <option value="soft">CTA: Soft</option>
                    <option value="strong">CTA: Strong</option>
                    <option value="none">CTA: None</option>
                  </select>
                  <div className="px-2 py-1 border border-black bg-gray-50 text-xs flex items-center">
                    Language is controlled in global AI Settings
                  </div>
                  <input type="number" min={20} max={200} value={settings.ai.title_max} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, title_max: Number(e.target.value) } }))} className="px-2 py-1 border border-black" placeholder="Title max chars" />
                  <input type="number" min={60} max={1000} value={settings.ai.description_max} onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, description_max: Number(e.target.value) } }))} className="px-2 py-1 border border-black" placeholder="Description max chars" />
                </div>
              </div>

              <div className="border border-black">
                <div className="px-3 py-2 bg-bg-secondary font-black text-sm">Design Customization</div>
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={settings.design.template_ids[0] ?? ''}
                    onChange={(e) => setSettings((prev) => ({ ...prev, design: { ...prev.design, template_ids: [Number(e.target.value)] } }))}
                    className="px-2 py-1 border border-black"
                  >
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                  <select value={settings.design.palette_mode} onChange={(e) => setSettings((prev) => ({ ...prev, design: { ...prev.design, palette_mode: e.target.value as 'auto' | 'brand' | 'manual' } }))} className="px-2 py-1 border border-black">
                    <option value="auto">Auto palette</option>
                    <option value="brand">Brand palette</option>
                    <option value="manual">Manual palette</option>
                  </select>
                  <select
                    value={selectedFontKey}
                    onChange={(e) => {
                      const selected = fontOptions.find((option) => option.key === e.target.value);
                      if (!selected) return;
                      setPreviewStyle((prev) => ({
                        ...prev,
                        fontFamily: selected.family,
                        customFontFile: selected.customFile,
                      }));
                      setSettings((prev) => ({
                        ...prev,
                        design: {
                          ...prev.design,
                          font_choices: [selected.family],
                        },
                      }));
                    }}
                    className="px-2 py-1 border border-black"
                  >
                    {fontOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                  <div className="md:col-span-2 border border-black p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase">
                        {settings.design.palette_mode === 'auto'
                          ? 'Auto palette preview'
                          : settings.design.palette_mode === 'brand'
                            ? 'Brand palette'
                            : 'Manual palette'}
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-gray-500">Resolved</span>
                        <div className="flex gap-1">
                          <span className="inline-flex items-center gap-1 border border-black px-1 py-0.5">
                            <span className="h-3 w-3 border border-black" style={{ backgroundColor: previewStyle.textZoneBgColor }} />
                            BG
                          </span>
                          <span className="inline-flex items-center gap-1 border border-black px-1 py-0.5">
                            <span className="h-3 w-3 border border-black" style={{ backgroundColor: previewStyle.textColor }} />
                            Text
                          </span>
                          <span className="inline-flex items-center gap-1 border border-black px-1 py-0.5">
                            <span className="h-3 w-3 border border-black" style={{ backgroundColor: previewStyle.textEffectColor }} />
                            Effect
                          </span>
                        </div>
                      </div>
                    </div>
                    {settings.design.palette_mode === 'auto' ? (
                      <div className="text-xs text-gray-600 border border-dashed border-black px-2 py-2">
                        Auto palette samples the lead preview image and derives background, text, and effect colors automatically.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {(['background', 'text', 'effect'] as Array<keyof EditablePalette>).map((key) => (
                          <label key={key} className="flex items-center justify-between gap-2 border border-black px-2 py-1">
                            <span className="text-xs font-bold uppercase">{key}</span>
                            <input
                              type="color"
                              value={settings.design.palette_mode === 'brand'
                                ? settings.design.brand_palette[key]
                                : settings.design.manual_palette[key]}
                              onChange={(e) => {
                                const value = normalizeHexColor(e.target.value, '#000000');
                                setSettings((prev) => ({
                                  ...prev,
                                  design: {
                                    ...prev.design,
                                    brand_palette: prev.design.palette_mode === 'brand'
                                      ? { ...prev.design.brand_palette, [key]: value }
                                      : prev.design.brand_palette,
                                    manual_palette: prev.design.palette_mode === 'manual'
                                      ? { ...prev.design.manual_palette, [key]: value }
                                      : prev.design.manual_palette,
                                  },
                                }));
                              }}
                              className="h-8 w-12 border border-black"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const textZone = selectedTemplate?.zones?.find((zone) => zone.zone_type === 'text');
                      setPreviewStyle((prev) => ({
                        ...prev,
                        textZoneY: textZone?.y ?? 0,
                        textZoneHeight: textZone?.height ?? 140,
                        textZonePadLeft: 0,
                        textZonePadRight: 0,
                        textZoneBgColor: String((textZone?.props as Record<string, unknown> | undefined)?.text_zone_bg_color || '#ffffff'),
                      }));
                    }}
                    className="px-2 py-1 border-2 border-black text-xs font-bold uppercase"
                  >
                    Reset Drag Zone
                  </button>
                </div>
              </div>

              <div className="border border-black">
                <div className="px-3 py-2 bg-bg-secondary font-black text-sm">Image Settings</div>
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={settings.image.fetch_from_page} onChange={(e) => setSettings((prev) => ({ ...prev, image: { ...prev.image, fetch_from_page: e.target.checked } }))} />Fetch images from page</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={settings.image.ignore_small_width} onChange={(e) => setSettings((prev) => ({ ...prev, image: { ...prev.image, ignore_small_width: e.target.checked } }))} />Ignore small-width images</label>
                  <input type="number" value={settings.image.min_width} onChange={(e) => setSettings((prev) => ({ ...prev, image: { ...prev.image, min_width: Number(e.target.value) } }))} className="px-2 py-1 border border-black" />
                  <div className="px-2 py-1 border border-black bg-gray-50 text-xs flex items-center">Template image slots control images per pin</div>
                  <div className="md:col-span-2 flex gap-2">
                    {(['portrait', 'square', 'landscape'] as Orientation[]).map((o) => (
                      <button
                        key={o}
                        onClick={() => setSettings((prev) => ({
                          ...prev,
                          image: {
                            ...prev.image,
                            orientations: prev.image.orientations.includes(o) ? prev.image.orientations.filter((i) => i !== o) : [...prev.image.orientations, o],
                          },
                        }))}
                        className={`px-2 py-1 border-2 text-xs uppercase font-bold ${settings.image.orientations.includes(o) ? 'bg-accent text-white border-black' : 'border-gray-300'}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  <div className="md:col-span-2 border border-black p-2 space-y-2">
                    <p className="font-black text-xs uppercase">Global Exclude Rules</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input
                        value={newGlobalRuleUrl}
                        onChange={(e) => setNewGlobalRuleUrl(e.target.value)}
                        placeholder="URL pattern (contains)"
                        className="px-2 py-1 border border-black"
                      />
                      <input
                        value={newGlobalRuleName}
                        onChange={(e) => setNewGlobalRuleName(e.target.value)}
                        placeholder="Image name pattern"
                        className="px-2 py-1 border border-black"
                      />
                      <select
                        value={newGlobalRuleReason}
                        onChange={(e) => setNewGlobalRuleReason(e.target.value as GlobalRuleReason)}
                        className="px-2 py-1 border border-black"
                      >
                        <option value="affiliate">affiliate</option>
                        <option value="logo">logo</option>
                        <option value="tracking">tracking</option>
                        <option value="icon">icon</option>
                        <option value="ad">ad</option>
                        <option value="other">other</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={addGlobalRule}>Add Global Rule</Button>
                      <Button variant="secondary" onClick={refreshGlobalRules}>Refresh Rules</Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto border border-black">
                      {globalRules.length === 0 ? (
                        <p className="text-xs text-gray-500 px-2 py-2">No global rules yet.</p>
                      ) : (
                        globalRules.map((rule) => (
                          <div key={rule.id} className="flex items-center justify-between gap-2 px-2 py-1 border-b border-black/20 text-xs">
                            <div className="min-w-0">
                              <div className="font-bold uppercase">{rule.reason}</div>
                              <div className="truncate">{rule.url_pattern || rule.name_pattern}</div>
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => applyGlobalRule(rule.id)} className="border border-black px-1 py-0.5 font-bold uppercase">Apply</button>
                              <button onClick={() => deleteGlobalRule(rule.id)} className="border border-black px-1 py-0.5 font-bold uppercase text-red-700">Delete</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
                <Button onClick={() => goToStep(2)} disabled={!canStep2}>Continue</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-black uppercase">Generation Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-black p-3 space-y-2">
                  <p className="font-black text-sm">Basic Settings</p>
                  <label className="text-sm">Daily pin count</label>
                  <input type="number" min={1} value={settings.generation.daily_pin_count} onChange={(e) => setSettings((prev) => ({ ...prev, generation: { ...prev.generation, daily_pin_count: Number(e.target.value) } }))} className="w-full px-2 py-1 border border-black" />
                  <p className="text-xs text-gray-600">CSV-only workflow. Pinterest connection is optional.</p>
                </div>
                <div className="border border-black p-3 space-y-2">
                  <p className="font-black text-sm">Scheduling Options</p>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.generation.warmup_month} onChange={(e) => setSettings((prev) => ({ ...prev, generation: { ...prev.generation, warmup_month: e.target.checked } }))} />Warmup month</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.generation.floating_days} onChange={(e) => setSettings((prev) => ({ ...prev, generation: { ...prev.generation, floating_days: e.target.checked } }))} />Use floating days</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.generation.randomize_posting_times} onChange={(e) => setSettings((prev) => ({ ...prev, generation: { ...prev.generation, randomize_posting_times: e.target.checked } }))} />Randomize posting times</label>
                  <input type="number" value={settings.generation.max_floating_minutes} onChange={(e) => setSettings((prev) => ({ ...prev, generation: { ...prev.generation, max_floating_minutes: Number(e.target.value) } }))} className="w-full px-2 py-1 border border-black" placeholder="Max floating minutes" />
                </div>
                <div className="border border-black p-3 space-y-3 md:col-span-2">
                  <p className="font-black text-sm">Content Settings</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <label className="font-bold text-xs uppercase">Desired gap days</label>
                      <input
                        type="number"
                        min={0}
                        value={settings.content.desired_gap_days}
                        onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, desired_gap_days: Number(e.target.value) } }))}
                        className="w-full px-2 py-1 border border-black"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-xs uppercase">Lifetime limit per URL</label>
                      <div className="flex gap-2 items-center">
                        <label className="flex items-center gap-2 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={settings.content.lifetime_limit_enabled}
                            onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, lifetime_limit_enabled: e.target.checked } }))}
                          />
                          Enabled
                        </label>
                        <input
                          type="number"
                          min={0}
                          disabled={!settings.content.lifetime_limit_enabled}
                          value={settings.content.lifetime_limit_count}
                          onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, lifetime_limit_count: Number(e.target.value) } }))}
                          className="w-full px-2 py-1 border border-black disabled:bg-gray-100"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-xs uppercase">Monthly limit per URL</label>
                      <div className="flex gap-2 items-center">
                        <label className="flex items-center gap-2 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={settings.content.monthly_limit_enabled}
                            onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, monthly_limit_enabled: e.target.checked } }))}
                          />
                          Enabled
                        </label>
                        <input
                          type="number"
                          min={0}
                          disabled={!settings.content.monthly_limit_enabled}
                          value={settings.content.monthly_limit_count}
                          onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, monthly_limit_count: Number(e.target.value) } }))}
                          className="w-full px-2 py-1 border border-black disabled:bg-gray-100"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 md:col-span-2">
                      <input
                        type="checkbox"
                        checked={settings.content.no_link_pins}
                        onChange={(e) => setSettings((prev) => ({ ...prev, content: { ...prev.content, no_link_pins: e.target.checked } }))}
                      />
                      No-link pins
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => goToStep(1)}>Back</Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                  <Button onClick={() => goToStep(3)} disabled={!canStep3}>Continue</Button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-black uppercase">Pages To Use For Pins</h2>
              <input value={pageSearch} onChange={(e) => setPageSearch(e.target.value)} placeholder="Type to filter pages..." className="w-full px-3 py-2 border-2 border-black" />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPageKeywordFilter('all')}
                  className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${pageKeywordFilter === 'all' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                >
                  All Pages
                </button>
                <button
                  onClick={() => setPageKeywordFilter('with_keywords')}
                  className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${pageKeywordFilter === 'with_keywords' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                >
                  Has Keywords
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPageGroupingMode('prefix')}
                  className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${pageGroupingMode === 'prefix' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                >
                  Prefix
                </button>
                <button
                  onClick={() => setPageGroupingMode('sitemap')}
                  className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${pageGroupingMode === 'sitemap' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                >
                  Sitemap
                </button>
                <button
                  onClick={() => setPageGroupingMode('categories')}
                  className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${pageGroupingMode === 'categories' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                >
                  Categories
                </button>
              </div>
              {pageGroupingMode === 'categories' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setCategoryViewMode('post_categories')}
                    className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${categoryViewMode === 'post_categories' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                  >
                    Post Categories
                  </button>
                  <button
                    onClick={() => setCategoryViewMode('taxonomy_pages')}
                    className={`px-3 py-1.5 text-xs font-black uppercase border-2 ${categoryViewMode === 'taxonomy_pages' ? 'bg-accent text-white border-black' : 'bg-bg-secondary border-black'}`}
                  >
                    Taxonomy Pages
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setVisibleSelection(true)}>Select All Visible</Button>
                <Button size="sm" variant="secondary" onClick={() => setVisibleSelection(false)}>Clear Visible</Button>
              </div>
              <div className="text-sm">{selectedPageIds.size} selected of {filteredPages.length} visible pages</div>
              <div className="max-h-[420px] overflow-y-auto border border-black divide-y divide-black">
                {groupedPages.map((group) => {
                  const selectedInGroup = group.pages.filter((page) => selectedPageIds.has(page.id)).length;
                  const allInGroupSelected = selectedInGroup === group.pages.length && group.pages.length > 0;
                  const isCollapsed = collapsedPageGroups.has(group.key);
                  return (
                  <div key={group.key}>
                    <div className="px-3 py-2 bg-bg-secondary font-black text-xs uppercase flex items-center justify-between gap-2 border-b border-black/20">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allInGroupSelected}
                          onChange={() => toggleGroupPages(group.pages)}
                          title={allInGroupSelected ? 'Clear this group' : 'Select this group'}
                        />
                        <button
                          onClick={() => toggleGroupPages(group.pages)}
                          className="text-left"
                          title={allInGroupSelected ? 'Clear this group' : 'Select this group'}
                        >
                          {group.label} ({selectedInGroup}/{group.pages.length})
                        </button>
                      </div>
                      <button
                        onClick={() => toggleGroupCollapsed(group.key)}
                        className="w-6 h-6 border border-black flex items-center justify-center text-sm leading-none"
                        title={isCollapsed ? 'Expand group' : 'Collapse group'}
                        aria-label={isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                    </div>
                    {!isCollapsed && group.pages.map((page) => (
                      <label key={page.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                        <input type="checkbox" checked={selectedPageIds.has(page.id)} onChange={() => { void togglePage(page.id); }} />
                        <span className="truncate">{page.title || page.url}</span>
                        {page.has_keywords && (
                          <span className="text-[10px] uppercase border border-black px-1 py-0.5 bg-green-100">
                            keywords {page.keyword_count}
                          </span>
                        )}
                        {!page.is_enabled && (
                          <span className="text-[10px] uppercase border border-black px-1 py-0.5 bg-yellow-100">disabled</span>
                        )}
                      </label>
                    ))}
                  </div>
                )})}
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => goToStep(2)}>Back</Button>
                <Button onClick={() => goToStep(4)} disabled={!canStep4}>Continue</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-black uppercase">Name Your Export Boards</h2>
              <div className="border-2 border-black p-3">
                <p className="font-black text-sm mb-2">AI Board Name Generator</p>
                <p className="text-xs text-gray-600 mb-2">Uses your default Board preset from AI Settings when available.</p>
                <div className="flex gap-2">
                  <input type="number" min={1} max={20} value={boardSuggestCount} onChange={(e) => setBoardSuggestCount(Number(e.target.value))} className="w-24 px-2 py-1 border border-black" />
                  <Button onClick={suggestBoards}>Generate Boards</Button>
                </div>
                <label className="flex items-center gap-2 mt-2 text-xs font-bold uppercase">
                  <input
                    type="checkbox"
                    checked={replaceAiBoardsOnSuggest}
                    onChange={(e) => setReplaceAiBoardsOnSuggest(e.target.checked)}
                  />
                  Replace previous AI boards
                </label>
              </div>
              <div className="border border-black p-3 space-y-2">
                <div className="flex gap-2">
                  <input value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} placeholder="Add board manually" className="flex-1 px-2 py-1 border border-black" />
                  <Button onClick={addBoard}>Add</Button>
                </div>
                {visibleBoards.length === 0 ? (
                  <p className="text-sm text-gray-500">No boards yet for the current selected pages. Generate with AI or add manually.</p>
                ) : (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {visibleBoards.map((board) => (
                      <div key={board.id} className="flex items-center justify-between border border-black px-2 py-1">
                        <span className="text-sm font-bold">{board.name}</span>
                        <button onClick={() => removeBoard(board.id)} className="text-xs text-red-600 font-bold uppercase">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => goToStep(3)}>Back</Button>
                <Button onClick={() => goToStep(5)} disabled={!canStep5}>Continue</Button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="font-black uppercase">Review & Generate</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="border-2 border-black p-2"><p className="text-xs">Pin Schedule</p><p className="font-black">{settings.generation.daily_pin_count}/day</p></div>
                <div className="border-2 border-black p-2"><p className="text-xs">Selected Pages</p><p className="font-black">{selectedPageIds.size}</p></div>
                <div className="border-2 border-black p-2"><p className="text-xs">Boards</p><p className="font-black">{visibleBoards.length}</p></div>
                <div className="border-2 border-black p-2"><p className="text-xs">Destination</p><p className="font-black">CSV Export</p></div>
              </div>
              <div className="border border-black p-3 bg-bg-secondary">
                <p className="font-black text-sm mb-2">What Happens Next</p>
                <ul className="text-sm list-disc ml-5">
                  <li>Generate pins for selected pages and templates</li>
                  <li>Assign boards using your configured board list</li>
                  <li>Apply spacing and per-URL limit safety rules</li>
                  <li>Review generated output and export CSV manually</li>
                </ul>
              </div>
              <div className="border border-black p-3">
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={runPreview} disabled={previewing}>
                    {previewing ? 'Previewing...' : 'Refresh Preview'}
                  </Button>
                  <Button onClick={generatePins} disabled={generating || !canStep5}>
                    {generating ? 'Generating...' : 'Start Generating Pins'}
                  </Button>
                  <Button variant="secondary" onClick={exportGeneratedCsv} disabled={exporting || pins.length === 0}>
                    {exporting ? 'Exporting...' : 'Export CSV'}
                  </Button>
                </div>
                {generationProgress.phase !== 'idle' && (
                  <div className="mt-3 border border-black p-3 bg-white">
                    <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase">
                      <span>{generationProgress.label}</span>
                      <span>{generationProgress.percent}%</span>
                    </div>
                    <div className="mt-2 h-3 border border-black bg-bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${
                          generationProgress.phase === 'error' ? 'bg-red-500' : generationProgress.phase === 'complete' ? 'bg-green-600' : 'bg-accent'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, generationProgress.percent))}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-gray-700">
                      {generationProgress.total > 0 && (
                        <span>{generationProgress.current} / {generationProgress.total}</span>
                      )}
                      {generationProgress.detail && (
                        <span>{generationProgress.total > 0 ? ' • ' : ''}{generationProgress.detail}</span>
                      )}
                    </div>
                  </div>
                )}
                {step5Status.type !== 'idle' && (
                  <div
                    className={`mt-3 text-sm border px-2 py-2 ${
                      step5Status.type === 'error'
                        ? 'border-red-600 bg-red-50 text-red-800'
                        : step5Status.type === 'success'
                          ? 'border-green-700 bg-green-50 text-green-800'
                          : 'border-black bg-bg-secondary text-black'
                    }`}
                  >
                    {step5Status.message}
                  </div>
                )}
                {previewResult && (
                  <div className="mt-3 text-sm">
                    Preview estimate: <strong>{previewResult.estimated_pins}</strong> pins from <strong>{previewResult.pages_count}</strong> pages
                  </div>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => goToStep(4)}>Back</Button>
                <span className="text-xs text-gray-500 self-center">Step 5 of 5</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white border-2 border-black p-3 overflow-hidden sticky top-24">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black uppercase text-sm">Preview</h3>
              <div className="flex gap-1">
                <button onClick={() => setPreviewTab('pins')} className={`px-2 py-1 text-xs border ${previewTab === 'pins' ? 'bg-accent text-white border-black' : 'border-gray-300'}`}>Pins</button>
                <button onClick={() => setPreviewTab('images')} className={`px-2 py-1 text-xs border ${previewTab === 'images' ? 'bg-accent text-white border-black' : 'border-gray-300'}`}>Images</button>
                <button onClick={() => setPreviewTab('selected')} className={`px-2 py-1 text-xs border ${previewTab === 'selected' ? 'bg-accent text-white border-black' : 'border-gray-300'}`}>Selected Images</button>
                <button onClick={randomizePreview} className="px-2 py-1 text-xs border border-black">Randomize</button>
              </div>
            </div>

            {previewTab === 'pins' ? (
              selectedTemplate && previewPage ? (
                <PinPreview
                  template={selectedTemplate}
                  imageUrls={previewPinImageUrls}
                  title={previewPage.title || 'Untitled'}
                  settings={previewStyle}
                  onZoneChange={(zone, value) =>
                    setPreviewStyle((prev) => ({
                      ...prev,
                      [zone]: value as never,
                    }))
                  }
                  className="w-full"
                />
              ) : (
                <p className="text-sm text-gray-500">Select page/template to preview pins.</p>
              )
            ) : previewTab === 'images' ? (
              <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {previewImages.map((image) => (
                  <div key={image.id} className="border border-black">
                    <button onClick={() => setSelectedImageDetail(image)} className="block w-full">
                      <img src={apiClient.proxyImageUrl(image.url)} alt="" className="w-full h-24 object-cover" />
                    </button>
                    {image.excluded_by_global_rule && (
                      <div className="text-[10px] font-bold uppercase px-1 py-0.5 border-t border-black bg-yellow-100 text-yellow-800">
                        Global rule
                      </div>
                    )}
                    <button
                      onClick={() => setImageExcluded(image, !image.is_excluded)}
                      disabled={image.excluded_by_global_rule}
                      className={`w-full text-[10px] font-bold uppercase px-1 py-1 border-t border-black ${
                        image.excluded_by_global_rule
                          ? 'bg-yellow-100 text-yellow-800 cursor-not-allowed'
                          : image.is_excluded
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {image.excluded_by_global_rule ? 'Global Excluded' : image.is_excluded ? 'Include' : 'Exclude'}
                    </button>
                  </div>
                ))}
                {previewImages.length === 0 && <p className="text-sm text-gray-500">No images after filtering.</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {(['all', 'included', 'excluded', 'featured', 'article', 'other'] as SelectedImageFilter[]).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setSelectedImageFilter(filter)}
                      className={`px-2 py-1 text-[11px] border ${selectedImageFilter === filter ? 'bg-accent text-white border-black' : 'border-gray-300'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setSelectedImagesExcluded(false)} className="px-2 py-1 text-[11px] border border-black font-bold uppercase" title="Set all currently visible images in this tab/filter to Included (global excluded images are skipped)">Include Visible</button>
                  <button onClick={() => setSelectedImagesExcluded(true)} className="px-2 py-1 text-[11px] border border-black font-bold uppercase" title="Set all currently visible images in this tab/filter to Excluded (global excluded images are skipped)">Exclude Visible</button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {selectedImagesList.map((image) => (
                    <div key={image.id} className="border border-black text-left">
                      <button onClick={() => setSelectedImageDetail(image)} className="block w-full">
                        <img src={apiClient.proxyImageUrl(image.url)} alt="" className="w-full h-20 object-cover" />
                      </button>
                      <div className="px-1 py-1 text-[10px]">
                        <div className="font-bold uppercase">{image.category}</div>
                        <div>{image.width || '?'}x{image.height || '?'}</div>
                        <div className={image.is_excluded ? 'text-red-600' : 'text-green-700'}>
                          {image.is_excluded ? 'Excluded' : 'Included'}
                        </div>
                        {image.excluded_by_global_rule && <div className="text-yellow-700 font-bold uppercase">Global rule</div>}
                      </div>
                      <button
                        onClick={() => setImageExcluded(image, !image.is_excluded)}
                        disabled={image.excluded_by_global_rule}
                        className={`w-full text-[10px] font-bold uppercase px-1 py-1 border-t border-black ${
                          image.excluded_by_global_rule
                            ? 'bg-yellow-100 text-yellow-800 cursor-not-allowed'
                            : image.is_excluded
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {image.excluded_by_global_rule ? 'Global Excluded' : image.is_excluded ? 'Include' : 'Exclude'}
                      </button>
                    </div>
                  ))}
                  {selectedImagesList.length === 0 && <p className="text-sm text-gray-500">No images for this filter.</p>}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border-2 border-black p-3">
            <h3 className="font-black uppercase text-sm mb-2">Generated Pins</h3>
            <div className="grid grid-cols-3 gap-1 max-h-72 overflow-y-auto">
              {pins.slice(0, 48).map((pin) => (
                <div key={pin.id} className="border border-black">
                  {pin.media_url ? <img src={pin.media_url} alt="" className="w-full h-20 object-cover" /> : <div className="w-full h-20 bg-gray-100" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedImageDetail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedImageDetail(null)}>
          <div className="bg-white border-2 border-black max-w-3xl w-full p-4 space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-black uppercase">Image Quality Details</h3>
              <button onClick={() => setSelectedImageDetail(null)} className="text-xs font-black uppercase border border-black px-2 py-1">Close</button>
            </div>
            <img src={apiClient.proxyImageUrl(selectedImageDetail.url)} alt="" className="w-full max-h-[65vh] object-contain border border-black bg-gray-50" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="border border-black p-2"><span className="text-gray-500">Size</span><div className="font-bold">{selectedImageDetail.width || '?'}x{selectedImageDetail.height || '?'}</div></div>
              <div className="border border-black p-2"><span className="text-gray-500">Category</span><div className="font-bold uppercase">{selectedImageDetail.category}</div></div>
              <div className="border border-black p-2"><span className="text-gray-500">Format</span><div className="font-bold">{selectedImageDetail.format || 'unknown'}</div></div>
              <div className="border border-black p-2"><span className="text-gray-500">File Size</span><div className="font-bold">{selectedImageDetail.file_size ? `${Math.round(selectedImageDetail.file_size / 1024)} KB` : 'unknown'}</div></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
