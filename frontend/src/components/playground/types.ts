import type {
  PlaygroundFontSet,
  PlaygroundPageItem,
  PlaygroundPreviewMeta,
  PlaygroundTemplateItem,
} from '../../services/api';

export type PromptStyle = 'engaging' | 'informative' | 'question' | 'listicle' | 'ecommerce';
export type ZoomLevel = 1 | 1.5 | 2;
export type Orientation = 'portrait' | 'square' | 'landscape';

export type AiSettingsState = {
  promptStyle: PromptStyle;
  customPrompt: string;
  language: string;
  promptEnabled: boolean;
};

export type ImageSettingsState = {
  fetchFromPage: boolean;
  useHiddenImages: boolean;
  ignoreSmallWidth: boolean;
  minWidth: number;
  ignoreSmallHeight: boolean;
  limitImagesPerPage: boolean;
  allowedOrientations: Orientation[];
  useFeaturedImage: boolean;
  uniqueImagePerPin: boolean;
  ignoreImagesWithTextOverlay: boolean;
  noDuplicateContent: boolean;
};

export type DisplaySettingsState = {
  showFullImage: boolean;
};

export type AdvancedSettingsState = {
  enableImageValidation: boolean;
};

export type PlaygroundState = {
  selectedPageUrl: string;
  aiSettings: AiSettingsState;
  selectedFontSetId: string;
  selectedTemplateIds: number[];
  defaultTemplateId: number | null;
  imageSettings: ImageSettingsState;
  displaySettings: DisplaySettingsState;
  advancedSettings: AdvancedSettingsState;
  previewOpen: boolean;
  activeTemplateId: number | null;
  activeFontSetId: string;
  activeFontColor: string;
  zoom: ZoomLevel;
  scheduledDate: string | null;
};

export type PlaygroundData = {
  pages: PlaygroundPageItem[];
  templates: PlaygroundTemplateItem[];
  fontSets: PlaygroundFontSet[];
};

export type PreviewState = {
  metadata: PlaygroundPreviewMeta | null;
  loading: boolean;
  error: string | null;
  variantIndex: number;
};
