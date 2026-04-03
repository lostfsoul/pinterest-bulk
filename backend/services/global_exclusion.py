"""
Global exclusion matching service.
Handles pattern matching for global image exclusions.
"""
import re
from typing import NamedTuple
from sqlalchemy.orm import Session

from models import GlobalExcludedImage


class ExclusionMatch(NamedTuple):
    """Result of an exclusion pattern match."""
    rule_id: int
    matched: bool
    reason: str | None = None


def matches_url_pattern(image_url: str, url_pattern: str | None) -> bool:
    """
    Check if an image URL matches a URL pattern.
    Supports simple wildcard patterns: * matches any characters.
    """
    if not url_pattern:
        return False

    normalized_pattern = url_pattern.strip()
    if not normalized_pattern:
        return False

    image_url_lower = image_url.lower()
    pattern_lower = normalized_pattern.lower()

    # If no wildcard is provided, treat pattern as "contains" to make rules easy to use.
    if '*' not in normalized_pattern:
        return pattern_lower in image_url_lower

    # Convert wildcard pattern to regex
    # Escape special regex characters except *
    escaped = re.escape(normalized_pattern)
    regex_pattern = escaped.replace(r'\*', '.*')
    regex_pattern = f'^{regex_pattern}$'

    try:
        return bool(re.search(regex_pattern, image_url, re.IGNORECASE))
    except re.error:
        return False


def matches_name_pattern(image_url: str, name_pattern: str | None) -> bool:
    """
    Check if an image URL matches a name pattern.
    The name is extracted from the URL filename.
    """
    if not name_pattern:
        return False

    normalized_pattern = name_pattern.strip()
    if not normalized_pattern:
        return False

    # Extract filename from URL
    url_lower = image_url.lower()
    name_lower = normalized_pattern.lower()

    # Get the filename part of the URL
    filename = url_lower.split('/')[-1]
    if '?' in filename:
        filename = filename.split('?')[0]

    # If no wildcard is provided, treat pattern as "contains".
    if '*' not in normalized_pattern:
        return name_lower in filename

    # Convert wildcard pattern to regex
    escaped = re.escape(name_lower)
    regex_pattern = escaped.replace(r'\*', '.*')
    regex_pattern = f'^{regex_pattern}$'

    try:
        return bool(re.search(regex_pattern, filename, re.IGNORECASE))
    except re.error:
        return False


def check_global_exclusion(
    image_url: str,
    rules: list[GlobalExcludedImage]
) -> ExclusionMatch:
    """
    Check if an image URL matches any global exclusion rule.

    Args:
        image_url: The URL to check
        rules: List of GlobalExcludedImage rules

    Returns:
        ExclusionMatch indicating if any rule matched
    """
    for rule in rules:
        # Check URL pattern match
        if rule.url_pattern and matches_url_pattern(image_url, rule.url_pattern):
            return ExclusionMatch(
                rule_id=rule.id,
                matched=True,
                reason=rule.reason
            )

        # Check name pattern match
        if rule.name_pattern and matches_name_pattern(image_url, rule.name_pattern):
            return ExclusionMatch(
                rule_id=rule.id,
                matched=True,
                reason=rule.reason
            )

    return ExclusionMatch(rule_id=0, matched=False)


def apply_exclusion_to_images(
    db: Session,
    rule_id: int,
    dry_run: bool = False
) -> dict:
    """
    Apply a global exclusion rule to all existing scraped images.

    Args:
        db: Database session
        rule_id: ID of the exclusion rule to apply
        dry_run: If True, only count matches without applying

    Returns:
        Dict with counts of matched images
    """
    from models import PageImage

    # Get the rule
    rule = db.query(GlobalExcludedImage).filter(GlobalExcludedImage.id == rule_id).first()
    if not rule:
        return {"error": "Rule not found", "matched": 0}

    # Find all images matching this rule
    all_images = db.query(PageImage).all()
    matched_count = 0

    for image in all_images:
        match = check_global_exclusion(image.url, [rule])
        if match.matched:
            matched_count += 1
            if not dry_run:
                image.excluded_by_global_rule = True
                image.is_excluded = True

    if not dry_run:
        db.commit()

    return {
        "rule_id": rule_id,
        "matched": matched_count,
        "applied": not dry_run
    }


def recompute_global_exclusions(db: Session) -> dict:
    """
    Recompute global exclusion flags for all images based on currently active rules.
    Useful after deleting or editing rules so previously matched images can be restored.
    """
    from models import PageImage

    rules = db.query(GlobalExcludedImage).all()
    images = db.query(PageImage).all()
    matched_count = 0
    restored_count = 0

    for image in images:
        match = check_global_exclusion(image.url, rules)
        if match.matched:
            matched_count += 1
            image.excluded_by_global_rule = True
            image.is_excluded = True
            continue

        # Image no longer matches any global rule
        if image.excluded_by_global_rule:
            image.excluded_by_global_rule = False
            # Restore to included when it was excluded due to global rule.
            # Manual per-image exclusions can be re-applied by user if needed.
            image.is_excluded = False
            restored_count += 1

    db.commit()
    return {
        "rules": len(rules),
        "matched": matched_count,
        "restored": restored_count,
    }


# Predefined exclusion rule templates
EXCLUSION_REASON_TYPES = [
    "affiliate",   # Affiliate marketing images
    "logo",        # Brand logos
    "tracking",    # Tracking pixels
    "icon",        # Icons and UI icons
    "ad",          # Advertisement images
    "other",       # Other/unclassified
]


def create_exclusion_rule(
    db: Session,
    url_pattern: str | None = None,
    name_pattern: str | None = None,
    reason: str = "other"
) -> GlobalExcludedImage:
    """
    Create a new global exclusion rule.

    Args:
        db: Database session
        url_pattern: URL pattern to match (supports * wildcard)
        name_pattern: Filename pattern to match (supports * wildcard)
        reason: Reason for exclusion (affiliate|logo|tracking|icon|ad|other)

    Returns:
        The created GlobalExcludedImage rule
    """
    if not url_pattern and not name_pattern:
        raise ValueError("At least one of url_pattern or name_pattern must be provided")

    if reason not in EXCLUSION_REASON_TYPES:
        raise ValueError(f"reason must be one of {EXCLUSION_REASON_TYPES}")

    rule = GlobalExcludedImage(
        url_pattern=url_pattern,
        name_pattern=name_pattern,
        reason=reason
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule
