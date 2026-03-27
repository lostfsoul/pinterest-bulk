"""
Image classification service.
Smart categorization of images as "article", "featured", or "other".
"""
import re
from dataclasses import dataclass
from typing import Literal

from .image_metadata import ImageMetadata, is_hq_image

# Type alias for image category
ImageCategory = Literal["article", "featured", "other"]

# Patterns that indicate featured/hero images
FEATURED_PATTERNS = [
    # Open Graph and Twitter card indicators in URL
    r'og[:_-]?image',
    r'twitter[:_-]?image',
    r'ogimage',
    # Common featured image URL patterns
    r'hero',
    r'cover',
    r'banner',
    r'featured',
    r'feature[d_-]?image',
    r'main[d_-]?image',
    r'lead[d_-]?image',
    r'primary[d_-]?image',
    # Full-width/header images
    r'full[d_-]?width',
    r'header[d_-]?image',
    r'page[d_-]?banner',
    r'share[d_-]?image',
    # Pinterest optimized
    r'pin[d_-]?image',
    r'pinterest[d_-]?image',
    # Size patterns indicating large images
    r'\d{3,4}x\d{3,4}',  # e.g., 1920x1080
    r'-\d{3,4}-\d{3,4}-',  # e.g., -1920-1080-
]

# Patterns that indicate article content images
ARTICLE_PATTERNS = [
    # Content/article indicators
    r'article',
    r'post',
    r'content',
    r'body',
    r'text',
    r'inline',
    r'embed',
    # Specific content types
    r'photo',
    r'picture',
    r'screenshot',
    r'diagram',
    r'chart',
    r'graph',
    # Common content image patterns
    r'attachment',
    r'thumbnail',
    r'preview',
    r'medium',  # but not "medium_rectangle" (often ads)
    # Editorial images
    r'editorial',
    r'blog[d_-]?image',
    r'news',
    r'story',
]

# Patterns that indicate non-content images (icons, logos, ads, etc.)
EXCLUDE_PATTERNS = [
    # Icons and logos
    r'icon',
    r'logo',
    r'badge',
    r'button',
    r'sprite',
    r'favicon',
    r'apple[-_]touch',
    # Tracking and ads - use path-based matching to avoid "uploads" false positive
    r'tracking',
    r'pixel',
    r'/ad[s]?[-_]?',  # /ads/ or /ad- in path
    r'/advert',
    r'sponsor',
    r'promo',
    # UI elements
    r'avatar',
    r'user[d_-]?image',
    r'profile',
    r'placeholder',
    r'dummy',
    r'spacer',
    r'1x1',
    r'blank',
    r'clear',
    r'transparent',
    # Social media
    r'facebook',
    r'twitter',
    r'instagram',
    r'linkedin',
    r'youtube',
    # Common small images
    r'loading',
    r'spinner',
    r'loader',
    r'progress',
    r'check',
    r'close',
    r'menu',
    r'arrow',
    r'chevron',
    r'play[d_-]?button',
]

# SVG images are usually icons/logos
SVG_URL_PATTERNS = [r'\.svg', r'svg[?&#/]']


# Minimum resolution threshold (600x600)
MIN_RESOLUTION = 600


@dataclass
class ClassificationResult:
    """Result of image classification."""
    category: ImageCategory
    is_article_image: bool
    is_featured: bool
    should_exclude: bool
    reason: str | None = None


def classify_image(
    url: str,
    metadata: ImageMetadata,
    is_wp_content_image: bool = False
) -> ClassificationResult:
    """
    Classify an image into one of three categories:
    - featured: hero/cover/banner images (INCLUDED)
    - article: WordPress content images, images with article-related filenames (INCLUDED)
    - other: Everything else (EXCLUDED)

    Auto-excluded: Low resolution (<600x600), icons, logos, ads, SVG

    Args:
        url: The image URL
        metadata: Image metadata including dimensions and file size
        is_wp_content_image: Whether this image is from WordPress content area (wp-block-image, etc.)

    Returns:
        ClassificationResult with category and exclusion recommendation
    """
    url_lower = url.lower()

    # 1. Check exclude patterns (icons, logos, ads, SVG) → "other" (exclude)
    if any(re.search(pattern, url_lower) for pattern in SVG_URL_PATTERNS):
        return ClassificationResult(
            category="other",
            is_article_image=False,
            is_featured=False,
            should_exclude=True,
            reason="SVG image (usually icon/logo)"
        )

    for pattern in EXCLUDE_PATTERNS:
        if re.search(pattern, url_lower):
            return ClassificationResult(
                category="other",
                is_article_image=False,
                is_featured=False,
                should_exclude=True,
                reason=f"Matches exclude pattern: {pattern}"
            )

    # 2. Check resolution (<600x600) → "other" (exclude)
    if metadata.width and metadata.height:
        if metadata.width < MIN_RESOLUTION or metadata.height < MIN_RESOLUTION:
            return ClassificationResult(
                category="other",
                is_article_image=False,
                is_featured=False,
                should_exclude=True,
                reason=f"Low resolution ({metadata.width}x{metadata.height} < {MIN_RESOLUTION}x{MIN_RESOLUTION})"
            )

    # 3. Featured patterns (hero, cover, banner in URL) → "featured" (include)
    for pattern in FEATURED_PATTERNS:
        if re.search(pattern, url_lower):
            return ClassificationResult(
                category="featured",
                is_article_image=False,
                is_featured=True,
                should_exclude=False,
                reason=f"Matches featured pattern: {pattern}"
            )

    # 4. WordPress content images (wp-block-*) → "article" (include)
    if is_wp_content_image:
        return ClassificationResult(
            category="article",
            is_article_image=True,
            is_featured=False,
            should_exclude=False,
            reason="WordPress content block image"
        )

    # 5. Article filename patterns → "article" (include)
    for pattern in ARTICLE_PATTERNS:
        if re.search(pattern, url_lower):
            return ClassificationResult(
                category="article",
                is_article_image=True,
                is_featured=False,
                should_exclude=False,
                reason=f"Matches article pattern: {pattern}"
            )

    # 6. Default → "other" (exclude)
    return ClassificationResult(
        category="other",
        is_article_image=False,
        is_featured=False,
        should_exclude=True,
        reason="No matching patterns for article or featured"
    )


def should_auto_exclude(
    url: str,
    category: ImageCategory,
    metadata: ImageMetadata,
    excluded_by_global_rule: bool = False
) -> tuple[bool, str | None]:
    """
    Determine if an image should be automatically excluded.

    Returns:
        Tuple of (should_exclude, reason)
    """
    # Global rule exclusion takes precedence
    if excluded_by_global_rule:
        return True, "Matches global exclusion rule"

    # "other" category images are auto-excluded
    if category == "other":
        return True, "Category 'other' is auto-excluded"

    # SVG images are typically icons/logos
    url_lower = url.lower()
    if any(re.search(pattern, url_lower) for pattern in SVG_URL_PATTERNS):
        return True, "SVG image"

    return False, None