"""
Workflow scheduling service helpers.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta
from pathlib import Path
import random
from typing import Any

from sqlalchemy.orm import Session

from models import (
    CustomFont,
    GenerationJob,
    Page,
    PinDraft,
    ScheduleSettings,
    SEOKeyword,
    Template,
    Website,
    WebsiteTrendKeyword,
)
from services.trend_ranking import rank_pages_for_trends


DEFAULT_WINDOW_DAYS = 33
DEFAULT_PINS_PER_DAY = 5
DEFAULT_START_HOUR = 8
DEFAULT_END_HOUR = 20
ACTIVE_JOB_STALE_MINUTES = 20
_FONT_STORAGE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "fonts"
_PRESET_FONT_MAP: dict[str, tuple[str, str]] = {
    "font_combo_1": ("Bebas Neue", "builtin/BebasNeue-Regular.ttf"),
    "font_combo_2": ("Montserrat", "builtin/Montserrat-Bold.ttf"),
    "font_combo_3": ("Oswald", "builtin/Oswald-Regular.ttf"),
    "font_combo_4": ("Poppins", "builtin/Poppins-Bold.ttf"),
    "font_combo_5": ("Montserrat", "builtin/Montserrat-Regular.ttf"),
    "font_combo_6": ("Poppins", "builtin/Poppins-Regular.ttf"),
}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _get_generation_settings(website: Website) -> dict[str, Any]:
    root = _as_dict(website.generation_settings)
    return _as_dict(root.get("generation"))


def _get_content_settings(website: Website) -> dict[str, Any]:
    root = _as_dict(website.generation_settings)
    return _as_dict(root.get("content"))


def _get_ai_settings(website: Website) -> dict[str, Any]:
    root = _as_dict(website.generation_settings)
    return _as_dict(root.get("ai"))


def _get_trend_settings(website: Website) -> dict[str, Any]:
    root = _as_dict(website.generation_settings)
    return _as_dict(root.get("trend"))


def _get_playground_settings(website: Website) -> dict[str, Any]:
    root = _as_dict(website.generation_settings)
    return _as_dict(root.get("playground"))


def _pick_board(website: Website) -> str:
    ai = _get_ai_settings(website)
    raw = ai.get("board_candidates")
    if isinstance(raw, list):
        for value in raw:
            board = str(value).strip()
            if board:
                return board
    return "General"


def _pick_template_id(db: Session, website: Website) -> int | None:
    playground = _get_playground_settings(website)
    default_template = playground.get("default_template_id")
    if default_template is not None:
        try:
            template_id = int(default_template)
        except (TypeError, ValueError):
            template_id = None
        if template_id is not None:
            exists = db.query(Template.id).filter(Template.id == template_id).first()
            if exists:
                return template_id

    selected = playground.get("selected_templates")
    if isinstance(selected, list):
        for item in selected:
            try:
                template_id = int(item)
            except (TypeError, ValueError):
                continue
            exists = db.query(Template.id).filter(Template.id == template_id).first()
            if exists:
                return template_id
    return None


def _resolve_playground_render_settings(db: Session, website: Website) -> dict[str, Any]:
    playground = _get_playground_settings(website)
    font_set = str(playground.get("font_set") or "").strip()
    font_color = str(playground.get("font_color") or "").strip()
    title_scale_raw = playground.get("title_scale")
    title_scale: float | None = None
    try:
        if title_scale_raw is not None:
            title_scale = max(0.7, min(1.6, float(title_scale_raw)))
    except (TypeError, ValueError):
        title_scale = None
    title_padding_x_raw = playground.get("title_padding_x")
    title_padding_x: int | None = None
    try:
        if title_padding_x_raw is not None:
            title_padding_x = max(8, min(36, int(float(title_padding_x_raw))))
    except (TypeError, ValueError):
        title_padding_x = None
    line_height_raw = playground.get("line_height_multiplier")
    line_height_multiplier: float | None = None
    try:
        if line_height_raw is not None:
            line_height_multiplier = max(0.8, min(1.35, float(line_height_raw)))
    except (TypeError, ValueError):
        line_height_multiplier = None

    if (
        not font_set
        and not font_color
        and title_scale is None
        and title_padding_x is None
        and line_height_multiplier is None
    ):
        return {}

    render: dict[str, Any] = {}
    if font_color:
        render["text_color"] = font_color
    if title_scale is not None:
        render["title_scale"] = title_scale
    if title_padding_x is not None:
        render["title_padding_x"] = title_padding_x
    if line_height_multiplier is not None:
        render["line_height_multiplier"] = line_height_multiplier

    if font_set.startswith("custom:"):
        filename = font_set.split("custom:", 1)[1].strip()
        if filename:
            custom = db.query(CustomFont).filter(CustomFont.filename == filename).first()
            if custom:
                render["font_family"] = custom.family
                render["custom_font_file"] = custom.filename
                return render
    elif font_set in _PRESET_FONT_MAP:
        family, font_file = _PRESET_FONT_MAP[font_set]
        render["font_family"] = family
        if (_FONT_STORAGE_ROOT / font_file).exists():
            render["custom_font_file"] = font_file

    return render


def _resolve_playground_image_settings(website: Website) -> dict[str, Any]:
    playground = _get_playground_settings(website)
    image = playground.get("image_settings")
    if not isinstance(image, dict):
        return {}

    min_width = image.get("minWidth", image.get("min_width", 200))
    try:
        min_width_int = max(1, int(min_width))
    except (TypeError, ValueError):
        min_width_int = 200

    allowed_orientations = image.get("allowedOrientations", image.get("allowed_orientations"))
    if not isinstance(allowed_orientations, list):
        allowed_orientations = ["portrait", "square", "landscape"]
    normalized_orientations = [
        str(value).strip().lower()
        for value in allowed_orientations
        if str(value).strip().lower() in {"portrait", "square", "landscape"}
    ]
    if not normalized_orientations:
        normalized_orientations = ["portrait", "square", "landscape"]

    return {
        "fetch_from_page": bool(image.get("fetchFromPage", image.get("fetch_from_page", True))),
        "ignore_small_width": bool(image.get("ignoreSmallWidth", image.get("ignore_small_width", True))),
        "min_width": min_width_int,
        "ignore_small_height": bool(image.get("ignoreSmallHeight", image.get("ignore_small_height", False))),
        "min_height": min_width_int,
        "allowed_orientations": normalized_orientations,
        "limit_images_per_page": bool(image.get("limitImagesPerPage", image.get("limit_images_per_page", False))),
    }


def _enabled_page_ids(db: Session, website_id: int) -> list[int]:
    rows = (
        db.query(Page.id)
        .filter(Page.website_id == website_id, Page.is_enabled == True)  # noqa: E712
        .all()
    )
    return [row[0] for row in rows]


def _split_keyword_csv(value: str | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in (value or "").split(","):
        keyword = item.strip()
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(keyword)
    return result


def _clamp_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def resolve_website_schedule_config(db: Session, website: Website) -> dict[str, Any]:
    generation = _get_generation_settings(website)
    schedule_defaults = db.query(ScheduleSettings).first()

    default_timezone = (
        schedule_defaults.timezone
        if schedule_defaults and getattr(schedule_defaults, "timezone", None)
        else "UTC"
    )
    default_pins_per_day = (
        schedule_defaults.pins_per_day
        if schedule_defaults and getattr(schedule_defaults, "pins_per_day", None) is not None
        else DEFAULT_PINS_PER_DAY
    )
    default_start_hour = (
        schedule_defaults.start_hour
        if schedule_defaults and getattr(schedule_defaults, "start_hour", None) is not None
        else DEFAULT_START_HOUR
    )
    default_end_hour = (
        schedule_defaults.end_hour
        if schedule_defaults and getattr(schedule_defaults, "end_hour", None) is not None
        else DEFAULT_END_HOUR
    )
    default_floating_days = (
        bool(schedule_defaults.floating_days)
        if schedule_defaults and getattr(schedule_defaults, "floating_days", None) is not None
        else True
    )
    default_random_minutes = (
        bool(schedule_defaults.random_minutes)
        if schedule_defaults and getattr(schedule_defaults, "random_minutes", None) is not None
        else True
    )
    default_max_floating_minutes = (
        schedule_defaults.max_floating_minutes
        if schedule_defaults and getattr(schedule_defaults, "max_floating_minutes", None) is not None
        else 45
    )

    start_hour = _clamp_int(generation.get("start_hour"), default_start_hour, 0, 23)
    end_hour = _clamp_int(generation.get("end_hour"), default_end_hour, 0, 23)
    if end_hour <= start_hour:
        end_hour = min(23, start_hour + 1)

    return {
        "pins_per_day": _clamp_int(generation.get("daily_pin_count"), default_pins_per_day, 1, 100),
        "timezone": str(generation.get("timezone") or default_timezone or "UTC").strip() or "UTC",
        "start_hour": start_hour,
        "end_hour": end_hour,
        "warmup_month": bool(generation.get("warmup_month", False)),
        "floating_days": bool(generation.get("floating_days", default_floating_days)),
        "randomize_posting_times": bool(generation.get("randomize_posting_times", default_random_minutes)),
        "max_floating_minutes": _clamp_int(generation.get("max_floating_minutes"), default_max_floating_minutes, 0, 240),
        "floating_start_end_hours": bool(
            generation.get("floating_start_end_hours", generation.get("enable_start_end_hours", False))
        ),
        "start_window_flex_minutes": _clamp_int(generation.get("start_window_flex_minutes"), 60, 0, 240),
        "end_window_flex_minutes": _clamp_int(generation.get("end_window_flex_minutes"), 120, 0, 240),
        "scheduling_window_days": _clamp_int(generation.get("scheduling_window_days"), DEFAULT_WINDOW_DAYS, 2, 60),
    }


def _deterministic_rng(website_id: int, year: int, month: int, day: int, salt: str) -> random.Random:
    return random.Random(f"{website_id}:{year}:{month}:{day}:{salt}")


def resolve_daily_pin_count(
    *,
    website_id: int,
    year: int,
    month: int,
    day: int,
    day_index: int,
    config: dict[str, Any],
) -> int:
    base_count = max(1, int(config.get("pins_per_day", DEFAULT_PINS_PER_DAY)))

    if bool(config.get("warmup_month", False)):
        progress = min(1.0, (day_index + 1) / 30.0)
        base_count = max(1, round(base_count * progress))

    if bool(config.get("floating_days", True)):
        rng = _deterministic_rng(website_id, year, month, day, "floating-days")
        base_count = max(1, base_count + rng.randint(-2, 2))

    return base_count


def resolve_daily_window_minutes(
    *,
    website_id: int,
    year: int,
    month: int,
    day: int,
    config: dict[str, Any],
) -> tuple[int, int]:
    start_minutes = int(config.get("start_hour", DEFAULT_START_HOUR)) * 60
    end_minutes = int(config.get("end_hour", DEFAULT_END_HOUR)) * 60
    if end_minutes <= start_minutes:
        end_minutes = min(23 * 60 + 59, start_minutes + 60)

    if bool(config.get("floating_start_end_hours", False)):
        start_flex = _clamp_int(config.get("start_window_flex_minutes"), 60, 0, 240)
        end_flex = _clamp_int(config.get("end_window_flex_minutes"), 120, 0, 240)
        start_rng = _deterministic_rng(website_id, year, month, day, "start-flex")
        end_rng = _deterministic_rng(website_id, year, month, day, "end-flex")
        start_minutes += start_rng.randint(-start_flex, start_flex)
        end_minutes += end_rng.randint(-end_flex, end_flex)

    start_minutes = max(0, min(23 * 60 + 59, start_minutes))
    end_minutes = max(0, min(23 * 60 + 59, end_minutes))
    if end_minutes <= start_minutes:
        end_minutes = min(23 * 60 + 59, start_minutes + 60)
    if end_minutes <= start_minutes:
        start_minutes = max(0, end_minutes - 60)

    return start_minutes, end_minutes


def format_minutes_to_12h(total_minutes: int) -> str:
    clamped = max(0, min(23 * 60 + 59, int(total_minutes)))
    hour = clamped // 60
    minute = clamped % 60
    suffix = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    return f"{hour12}:{minute:02d} {suffix}"


def get_pin_count_preview(
    *,
    website: Website,
    config: dict[str, Any],
    year: int,
    month: int,
) -> list[dict[str, int]]:
    days_in_month = monthrange(year, month)[1]
    result: list[dict[str, int]] = []
    for day in range(1, days_in_month + 1):
        count = resolve_daily_pin_count(
            website_id=website.id,
            year=year,
            month=month,
            day=day,
            day_index=day - 1,
            config=config,
        )
        result.append({"day": day, "count": count})
    return result


def get_time_window_preview(
    *,
    website: Website,
    config: dict[str, Any],
    year: int,
    month: int,
) -> list[dict[str, Any]]:
    days_in_month = monthrange(year, month)[1]
    result: list[dict[str, Any]] = []
    for day in range(1, days_in_month + 1):
        start_minutes, end_minutes = resolve_daily_window_minutes(
            website_id=website.id,
            year=year,
            month=month,
            day=day,
            config=config,
        )
        result.append(
            {
                "day": day,
                "start_minutes": start_minutes,
                "end_minutes": end_minutes,
                "start_time": format_minutes_to_12h(start_minutes),
                "end_time": format_minutes_to_12h(end_minutes),
            }
        )
    return result


def build_daily_slots_for_day(
    *,
    website: Website,
    config: dict[str, Any],
    day_start: datetime,
    day_index: int,
) -> list[datetime]:
    start_minutes, end_minutes = resolve_daily_window_minutes(
        website_id=website.id,
        year=day_start.year,
        month=day_start.month,
        day=day_start.day,
        config=config,
    )
    day_pins = resolve_daily_pin_count(
        website_id=website.id,
        year=day_start.year,
        month=day_start.month,
        day=day_start.day,
        day_index=day_index,
        config=config,
    )
    slots_count = max(1, day_pins)
    window_seconds = max(60, (end_minutes - start_minutes) * 60)
    base_start = day_start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=start_minutes)
    slots: list[datetime] = []

    for index in range(slots_count):
        interval_seconds = window_seconds / slots_count
        bucket_start_seconds = int(index * interval_seconds)
        bucket_end_seconds = int((index + 1) * interval_seconds)
        if bucket_end_seconds <= bucket_start_seconds:
            bucket_end_seconds = bucket_start_seconds + 1

        base_seconds = int((index + 0.5) * interval_seconds)
        if bool(config.get("randomize_posting_times", True)):
            max_offset_seconds = int(_clamp_float(config.get("max_floating_minutes"), 45.0, 0.0, 240.0) * 60)
            half_interval = max(0, int(interval_seconds / 2))
            allowed_offset = min(max_offset_seconds, half_interval)
            if allowed_offset > 0:
                rng = _deterministic_rng(
                    website.id,
                    day_start.year,
                    day_start.month,
                    day_start.day,
                    f"minute-offset-{index}",
                )
                base_seconds += rng.randint(-allowed_offset, allowed_offset)

        slot_seconds = max(bucket_start_seconds, min(bucket_end_seconds - 1, base_seconds))
        slot = base_start + timedelta(seconds=slot_seconds)
        slots.append(slot.replace(microsecond=0))

    return sorted(slots)


def build_workflow_publish_slots(
    *,
    website: Website,
    config: dict[str, Any],
    now: datetime | None = None,
) -> list[datetime]:
    """Build future publish slots for the configured scheduling window."""
    current = now or datetime.utcnow()
    window_days = _clamp_int(config.get("scheduling_window_days"), DEFAULT_WINDOW_DAYS, 2, 60)
    start_day = current.replace(hour=0, minute=0, second=0, microsecond=0)
    slots: list[datetime] = []
    for day_index in range(window_days):
        day_start = start_day + timedelta(days=day_index)
        for slot in build_daily_slots_for_day(
            website=website,
            config=config,
            day_start=day_start,
            day_index=day_index,
        ):
            if slot > current:
                slots.append(slot)
    return sorted(slots)


def _scheduled_count_in_window(
    db: Session,
    *,
    website_id: int,
    window_start: datetime,
    window_end: datetime,
) -> int:
    return (
        db.query(PinDraft.id)
        .join(Page, Page.id == PinDraft.page_id)
        .filter(
            Page.website_id == website_id,
            PinDraft.publish_date.is_not(None),
            PinDraft.publish_date >= window_start,
            PinDraft.publish_date <= window_end,
        )
        .count()
    )


def _is_page_blocked_by_content_limits(db: Session, page: Page, content: dict[str, Any]) -> bool:
    existing = (
        db.query(PinDraft)
        .filter(PinDraft.page_id == page.id)
        .order_by(PinDraft.created_at.desc())
        .all()
    )
    desired_gap_days = _clamp_int(content.get("desired_gap_days"), 0, 0, 365)
    if desired_gap_days > 0 and existing:
        if (datetime.utcnow() - existing[0].created_at).days < desired_gap_days:
            return True

    lifetime_limit_enabled = bool(content.get("lifetime_limit_enabled", False))
    lifetime_limit_count = _clamp_int(content.get("lifetime_limit_count"), 0, 0, 100000)
    if lifetime_limit_enabled and lifetime_limit_count > 0 and len(existing) >= lifetime_limit_count:
        return True

    monthly_limit_enabled = bool(content.get("monthly_limit_enabled", False))
    monthly_limit_count = _clamp_int(content.get("monthly_limit_count"), 0, 0, 100000)
    if monthly_limit_enabled and monthly_limit_count > 0:
        month_ago = datetime.utcnow() - timedelta(days=30)
        if sum(1 for pin in existing if pin.created_at >= month_ago) >= monthly_limit_count:
            return True

    return False


def _rank_enabled_pages_for_workflow(db: Session, website: Website, pages: list[Page]) -> list[Page]:
    if not pages:
        return []

    keyword_rows = db.query(SEOKeyword).filter(SEOKeyword.url.in_([page.url for page in pages])).all()
    seo_keywords_by_url = {
        row.url: _split_keyword_csv(row.keywords)
        for row in keyword_rows
    }
    trend_rows = db.query(WebsiteTrendKeyword).filter(WebsiteTrendKeyword.website_id == website.id).all()
    ranked_pages, _ = rank_pages_for_trends(
        pages,
        trend_keywords_by_website={website.id: trend_rows},
        generation_settings_by_website={website.id: website.generation_settings or {}},
        seo_keywords_by_url=seo_keywords_by_url,
        top_n_override=len(pages),
    )
    return ranked_pages


def select_workflow_page_ids(
    db: Session,
    *,
    website: Website,
    target_count: int,
) -> list[int]:
    if target_count <= 0:
        return []

    pages = (
        db.query(Page)
        .filter(Page.website_id == website.id, Page.is_enabled == True)  # noqa: E712
        .order_by(Page.created_at.desc())
        .all()
    )
    ranked_pages = _rank_enabled_pages_for_workflow(db, website, pages)
    content = _get_content_settings(website)

    selected: list[int] = []
    for page in ranked_pages:
        if _is_page_blocked_by_content_limits(db, page, content):
            continue
        selected.append(page.id)
        if len(selected) >= target_count:
            break
    return selected


def has_active_generation_job(db: Session, website_id: int) -> bool:
    expire_stale_generation_jobs(db, website_id)
    return (
        db.query(GenerationJob.id)
        .filter(
            GenerationJob.website_id == website_id,
            GenerationJob.status.in_(["queued", "running"]),
        )
        .first()
        is not None
    )


def expire_stale_generation_jobs(db: Session, website_id: int | None = None) -> int:
    cutoff = datetime.utcnow() - timedelta(minutes=ACTIVE_JOB_STALE_MINUTES)
    query = db.query(GenerationJob).filter(
        GenerationJob.status.in_(["queued", "running"]),
        GenerationJob.updated_at < cutoff,
    )
    if website_id is not None:
        query = query.filter(GenerationJob.website_id == website_id)
    stale_jobs = query.all()
    if not stale_jobs:
        return 0

    now = datetime.utcnow()
    for job in stale_jobs:
        job.status = "failed"
        job.phase = "error"
        job.completed_at = now
        detail = "Generation job expired after inactivity timeout."
        job.error_detail = detail
        job.message = detail
        job.updated_at = now
    db.commit()
    return len(stale_jobs)


def build_generation_payload(db: Session, website: Website) -> dict[str, Any]:
    template_id = _pick_template_id(db, website)
    if not template_id:
        raise ValueError("No template selected in Playground settings.")

    enabled_page_ids = _enabled_page_ids(db, website.id)
    if not enabled_page_ids:
        raise ValueError("No enabled pages available for this website.")

    generation = _get_generation_settings(website)
    ai = _get_ai_settings(website)
    trend = _get_trend_settings(website)
    config = resolve_website_schedule_config(db, website)
    publish_slots = build_workflow_publish_slots(website=website, config=config)
    if not publish_slots:
        return {
            "website_id": website.id,
            "template_id": template_id,
            "page_ids": [],
            "target_pin_count": 0,
            "planned_publish_slots": [],
            "no_generation_reason": "No future publishing slots are available in the configured scheduling window.",
            "pins_per_day": int(config.get("pins_per_day", DEFAULT_PINS_PER_DAY)),
            "window_days": int(config.get("scheduling_window_days", DEFAULT_WINDOW_DAYS)),
        }

    window_start = datetime.utcnow()
    window_end = publish_slots[-1]
    scheduled_count = _scheduled_count_in_window(
        db,
        website_id=website.id,
        window_start=window_start,
        window_end=window_end,
    )
    target_pin_count = max(0, len(publish_slots) - scheduled_count)
    if target_pin_count <= 0:
        return {
            "website_id": website.id,
            "template_id": template_id,
            "page_ids": [],
            "target_pin_count": 0,
            "planned_publish_slots": [],
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "existing_scheduled_count": scheduled_count,
            "target_slot_count": len(publish_slots),
            "no_generation_reason": "Schedule already filled for the configured window.",
            "pins_per_day": int(config.get("pins_per_day", DEFAULT_PINS_PER_DAY)),
            "window_days": int(config.get("scheduling_window_days", DEFAULT_WINDOW_DAYS)),
        }

    page_ids = select_workflow_page_ids(db, website=website, target_count=target_pin_count)
    if not page_ids:
        raise ValueError("No eligible pages available for the configured workflow limits.")

    variants = max(1, int(generation.get("text_variations") or ai.get("variants") or 1))
    mode = "matrix" if variants > 1 else "conservative"
    planned_slots = publish_slots[scheduled_count : scheduled_count + len(page_ids)]

    payload: dict[str, Any] = {
        "website_id": website.id,
        "template_id": template_id,
        "page_ids": page_ids,
        "board_name": _pick_board(website),
        "use_ai_titles": bool(ai.get("generate_titles", True)),
        "generate_descriptions": bool(ai.get("generate_descriptions", True)),
        "tone": str(ai.get("tone") or "seo-friendly"),
        "keyword_mode": "manual" if str(ai.get("keyword_mode") or "auto") == "manual" else "auto",
        "manual_keywords": str(ai.get("manual_keywords") or "") or None,
        "cta_style": str(ai.get("cta_style") or "soft"),
        "title_max": int(ai.get("title_max") or 100),
        "description_max": int(ai.get("description_max") or 500),
        "language": str(ai.get("language") or "English"),
        "mode": mode,
        "variation_options": {"text_variations": variants},
        "top_n": int(trend["top_n"]) if trend.get("top_n") not in (None, "", 0) else None,
        "similarity_threshold": float(trend["similarity_threshold"]) if trend.get("similarity_threshold") not in (None, "") else None,
        "diversity_enabled": bool(trend.get("diversity_enabled")) if trend.get("diversity_enabled") is not None else None,
        "diversity_penalty": float(trend["diversity_penalty"]) if trend.get("diversity_penalty") not in (None, "") else None,
        "semantic_enabled": bool(trend.get("semantic_enabled")) if trend.get("semantic_enabled") is not None else None,
        "target_pin_count": target_pin_count,
        "target_slot_count": len(publish_slots),
        "existing_scheduled_count": scheduled_count,
        "planned_publish_slots": [slot.isoformat() for slot in planned_slots],
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "pins_per_day": int(config.get("pins_per_day", DEFAULT_PINS_PER_DAY)),
        "window_days": int(config.get("scheduling_window_days", DEFAULT_WINDOW_DAYS)),
    }
    playground_render_settings = _resolve_playground_render_settings(db, website)
    if playground_render_settings:
        payload["render_settings"] = playground_render_settings
    playground_image_settings = _resolve_playground_image_settings(website)
    if playground_image_settings:
        payload["image_settings"] = playground_image_settings
    return payload


def create_generation_job(db: Session, website_id: int, payload: dict[str, Any], reason: str) -> GenerationJob:
    target_count = int(payload.get("target_pin_count") or len(payload.get("page_ids") or []) or 0)
    job = GenerationJob(
        website_id=website_id,
        template_id=payload.get("template_id"),
        status="queued",
        phase="queued",
        message=f"Queued generation for {target_count} pin(s) ({reason})",
        request_payload=payload,
        total_pages=len(payload.get("page_ids") or []),
        total_pins=target_count,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_workflow_status(db: Session, website: Website) -> dict[str, Any]:
    expire_stale_generation_jobs(db, website.id)
    generation = _get_generation_settings(website)
    content = _get_content_settings(website)

    pins_per_day = max(1, int(generation.get("daily_pin_count") or DEFAULT_PINS_PER_DAY))
    window_days = max(2, min(60, int(generation.get("scheduling_window_days") or DEFAULT_WINDOW_DAYS)))
    auto_regen_enabled = bool(generation.get("auto_regeneration_enabled", False))
    auto_regen_days_before_deadline = max(
        0,
        int(generation.get("auto_regeneration_days_before_deadline") or 3),
    )

    now = datetime.utcnow()
    scheduled_until_row = (
        db.query(PinDraft.publish_date)
        .join(Page, Page.id == PinDraft.page_id)
        .filter(Page.website_id == website.id, PinDraft.publish_date.is_not(None))
        .order_by(PinDraft.publish_date.desc())
        .first()
    )
    scheduled_until = scheduled_until_row[0] if scheduled_until_row else None
    scheduled_count = (
        db.query(PinDraft.id)
        .join(Page, Page.id == PinDraft.page_id)
        .filter(Page.website_id == website.id, PinDraft.publish_date.is_not(None), PinDraft.publish_date >= now)
        .count()
    )
    days_ahead_current = (
        max(0, (scheduled_until.date() - now.date()).days) if scheduled_until else 0
    )
    active_job = (
        db.query(GenerationJob)
        .filter(
            GenerationJob.website_id == website.id,
            GenerationJob.status.in_(["queued", "running"]),
        )
        .order_by(GenerationJob.created_at.desc())
        .first()
    )

    return {
        "website_id": website.id,
        "pins_per_day": pins_per_day,
        "window_days": window_days,
        "days_ahead_current": days_ahead_current,
        "scheduled_count": scheduled_count,
        "scheduled_until": scheduled_until.isoformat() if scheduled_until else None,
        "auto_regen_enabled": auto_regen_enabled,
        "auto_regen_days_before_deadline": auto_regen_days_before_deadline,
        "desired_gap_days": int(content.get("desired_gap_days") or 14),
        "has_active_job": bool(active_job),
        "active_job_id": active_job.id if active_job else None,
    }


def should_auto_generate(status_payload: dict[str, Any]) -> bool:
    if not status_payload.get("auto_regen_enabled"):
        return False
    if status_payload.get("has_active_job"):
        return False
    threshold = int(status_payload.get("auto_regen_days_before_deadline") or 3)
    return int(status_payload.get("days_ahead_current") or 0) <= max(0, threshold)
