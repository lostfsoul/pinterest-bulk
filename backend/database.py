"""
SQLite database setup and session management.
"""
import os
import re
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

# Ensure data directory exists
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
FONT_DIR = Path(__file__).parent.parent / "storage" / "fonts"
FONT_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR}/pinterest.db"

# Create engine with connection pooling for SQLite
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


PIN_DRAFT_MIGRATIONS = {
    "text_zone_y": "ALTER TABLE pin_drafts ADD COLUMN text_zone_y INTEGER",
    "text_zone_height": "ALTER TABLE pin_drafts ADD COLUMN text_zone_height INTEGER",
    "text_zone_pad_left": "ALTER TABLE pin_drafts ADD COLUMN text_zone_pad_left INTEGER",
    "text_zone_pad_right": "ALTER TABLE pin_drafts ADD COLUMN text_zone_pad_right INTEGER",
    "text_align": "ALTER TABLE pin_drafts ADD COLUMN text_align VARCHAR(20)",
    "font_family": "ALTER TABLE pin_drafts ADD COLUMN font_family VARCHAR(255)",
    "custom_font_file": "ALTER TABLE pin_drafts ADD COLUMN custom_font_file VARCHAR(512)",
    "text_zone_bg_color": "ALTER TABLE pin_drafts ADD COLUMN text_zone_bg_color VARCHAR(32)",
    "text_color": "ALTER TABLE pin_drafts ADD COLUMN text_color VARCHAR(32)",
    "text_effect": "ALTER TABLE pin_drafts ADD COLUMN text_effect VARCHAR(20)",
    "text_effect_color": "ALTER TABLE pin_drafts ADD COLUMN text_effect_color VARCHAR(32)",
    "text_effect_offset_x": "ALTER TABLE pin_drafts ADD COLUMN text_effect_offset_x INTEGER",
    "text_effect_offset_y": "ALTER TABLE pin_drafts ADD COLUMN text_effect_offset_y INTEGER",
    "text_effect_blur": "ALTER TABLE pin_drafts ADD COLUMN text_effect_blur INTEGER",
}

PAGE_MIGRATIONS = {
    "section": "ALTER TABLE pages ADD COLUMN section VARCHAR(255)",
    "sitemap_source": "ALTER TABLE pages ADD COLUMN sitemap_source VARCHAR(1024)",
    "sitemap_bucket": "ALTER TABLE pages ADD COLUMN sitemap_bucket VARCHAR(50)",
    "is_utility_page": "ALTER TABLE pages ADD COLUMN is_utility_page BOOLEAN NOT NULL DEFAULT 0",
}

WEBSITE_MIGRATIONS = {
    "generation_settings": "ALTER TABLE websites ADD COLUMN generation_settings JSON",
}

TEMPLATE_MIGRATIONS = {
    "template_manifest": "ALTER TABLE templates ADD COLUMN template_manifest JSON",
}

PAGE_IMAGE_MIGRATIONS = {
    "width": "ALTER TABLE page_images ADD COLUMN width INTEGER",
    "height": "ALTER TABLE page_images ADD COLUMN height INTEGER",
    "file_size": "ALTER TABLE page_images ADD COLUMN file_size INTEGER",
    "mime_type": "ALTER TABLE page_images ADD COLUMN mime_type VARCHAR(100)",
    "format": "ALTER TABLE page_images ADD COLUMN format VARCHAR(50)",
    "is_article_image": "ALTER TABLE page_images ADD COLUMN is_article_image BOOLEAN DEFAULT 0",
    "is_hq": "ALTER TABLE page_images ADD COLUMN is_hq BOOLEAN DEFAULT 0",
    "category": "ALTER TABLE page_images ADD COLUMN category VARCHAR(50) DEFAULT 'other'",
    "excluded_by_global_rule": "ALTER TABLE page_images ADD COLUMN excluded_by_global_rule BOOLEAN DEFAULT 0",
}

GLOBAL_EXCLUDED_IMAGES_MIGRATIONS = {
    "url_pattern": "ALTER TABLE global_excluded_images ADD COLUMN url_pattern VARCHAR(512)",
    "name_pattern": "ALTER TABLE global_excluded_images ADD COLUMN name_pattern VARCHAR(255)",
    "reason": "ALTER TABLE global_excluded_images ADD COLUMN reason VARCHAR(50)",
}

AI_PRESET_MIGRATIONS = {
    "name": "ALTER TABLE ai_prompt_presets ADD COLUMN name VARCHAR(255)",
    "target_field": "ALTER TABLE ai_prompt_presets ADD COLUMN target_field VARCHAR(50)",
    "prompt_template": "ALTER TABLE ai_prompt_presets ADD COLUMN prompt_template TEXT",
    "model": "ALTER TABLE ai_prompt_presets ADD COLUMN model VARCHAR(50)",
    "temperature": "ALTER TABLE ai_prompt_presets ADD COLUMN temperature FLOAT",
    "max_tokens": "ALTER TABLE ai_prompt_presets ADD COLUMN max_tokens INTEGER",
    "language": "ALTER TABLE ai_prompt_presets ADD COLUMN language VARCHAR(50)",
    "is_default": "ALTER TABLE ai_prompt_presets ADD COLUMN is_default BOOLEAN",
}

AI_SETTINGS_MIGRATIONS = {
    "default_title_preset_id": "ALTER TABLE ai_settings ADD COLUMN default_title_preset_id INTEGER",
    "default_description_preset_id": "ALTER TABLE ai_settings ADD COLUMN default_description_preset_id INTEGER",
    "default_board_preset_id": "ALTER TABLE ai_settings ADD COLUMN default_board_preset_id INTEGER",
    "default_language": "ALTER TABLE ai_settings ADD COLUMN default_language VARCHAR(50)",
    "use_ai_by_default": "ALTER TABLE ai_settings ADD COLUMN use_ai_by_default BOOLEAN",
}

SCHEDULE_SETTINGS_MIGRATIONS = {
    "warmup_month": "ALTER TABLE schedule_settings ADD COLUMN warmup_month BOOLEAN NOT NULL DEFAULT 0",
    "floating_days": "ALTER TABLE schedule_settings ADD COLUMN floating_days BOOLEAN NOT NULL DEFAULT 1",
    "max_floating_minutes": "ALTER TABLE schedule_settings ADD COLUMN max_floating_minutes INTEGER NOT NULL DEFAULT 45",
    "timezone": "ALTER TABLE schedule_settings ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'",
}

WEBSITE_TREND_KEYWORD_MIGRATIONS = {
    "period_type": "ALTER TABLE website_trend_keywords ADD COLUMN period_type VARCHAR(20) NOT NULL DEFAULT 'always'",
    "period_value": "ALTER TABLE website_trend_keywords ADD COLUMN period_value VARCHAR(50)",
    "weight": "ALTER TABLE website_trend_keywords ADD COLUMN weight FLOAT NOT NULL DEFAULT 1.0",
    "updated_at": "ALTER TABLE website_trend_keywords ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
}


def get_db():
    """Dependency for getting database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables."""
    # Ensure all model modules are loaded so Base metadata includes every table.
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(pin_drafts)"))
        }
        for column, ddl in PIN_DRAFT_MIGRATIONS.items():
            if column not in columns:
                conn.execute(text(ddl))

        page_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(pages)"))
        }
        for column, ddl in PAGE_MIGRATIONS.items():
            if column not in page_columns:
                conn.execute(text(ddl))

        website_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(websites)"))
        }
        for column, ddl in WEBSITE_MIGRATIONS.items():
            if column not in website_columns:
                conn.execute(text(ddl))

        template_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(templates)"))
        }
        for column, ddl in TEMPLATE_MIGRATIONS.items():
            if column not in template_columns:
                conn.execute(text(ddl))

        # Migrate page_images table
        page_image_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(page_images)"))
        }
        for column, ddl in PAGE_IMAGE_MIGRATIONS.items():
            if column not in page_image_columns:
                conn.execute(text(ddl))

        create_seo_keywords_table(conn)
        migrate_legacy_page_keywords(conn)

        # Create global_excluded_images table if not exists
        existing_tables = {
            row[0]
            for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        if "global_excluded_images" not in existing_tables:
            conn.execute(text("""
                CREATE TABLE global_excluded_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url_pattern VARCHAR(512),
                    name_pattern VARCHAR(255),
                    reason VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
        else:
            # Migrate existing global_excluded_images table
            gei_columns = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(global_excluded_images)"))
            }
            for column, ddl in GLOBAL_EXCLUDED_IMAGES_MIGRATIONS.items():
                if column not in gei_columns:
                    conn.execute(text(ddl))

        # Create ai_prompt_presets table if not exists
        if "ai_prompt_presets" not in existing_tables:
            conn.execute(text("""
                CREATE TABLE ai_prompt_presets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(255) NOT NULL,
                    target_field VARCHAR(50) NOT NULL,
                    prompt_template TEXT NOT NULL,
                    model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
                    temperature FLOAT NOT NULL DEFAULT 0.4,
                    max_tokens INTEGER,
                    language VARCHAR(50) NOT NULL DEFAULT 'English',
                    is_default BOOLEAN NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
        else:
            # Migrate existing ai_prompt_presets table
            preset_columns = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(ai_prompt_presets)"))
            }
            for column, ddl in AI_PRESET_MIGRATIONS.items():
                if column not in preset_columns:
                    conn.execute(text(ddl))

        # Create ai_settings table if not exists
        if "ai_settings" not in existing_tables:
            conn.execute(text("""
                CREATE TABLE ai_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    default_title_preset_id INTEGER,
                    default_description_preset_id INTEGER,
                    default_board_preset_id INTEGER,
                    default_language VARCHAR(50) NOT NULL DEFAULT 'English',
                    use_ai_by_default BOOLEAN NOT NULL DEFAULT 1
                )
            """))
        else:
            # Migrate existing ai_settings table
            settings_columns = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(ai_settings)"))
            }
            for column, ddl in AI_SETTINGS_MIGRATIONS.items():
                if column not in settings_columns:
                    conn.execute(text(ddl))

        if "schedule_settings" in existing_tables:
            schedule_columns = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(schedule_settings)"))
            }
            for column, ddl in SCHEDULE_SETTINGS_MIGRATIONS.items():
                if column not in schedule_columns:
                    conn.execute(text(ddl))

        create_website_trend_keywords_table(conn)
        trend_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(website_trend_keywords)"))
        }
        for column, ddl in WEBSITE_TREND_KEYWORD_MIGRATIONS.items():
            if column not in trend_columns:
                conn.execute(text(ddl))

        # Legacy boards table is no longer used. Keep board candidates in websites.generation_settings.ai.board_candidates.
        conn.execute(text("DROP TABLE IF EXISTS boards"))
        create_custom_fonts_table(conn)
        backfill_custom_fonts(conn)


def create_website_trend_keywords_table(conn) -> None:
    """Create website_trend_keywords table if it doesn't exist."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS website_trend_keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            website_id INTEGER NOT NULL,
            keyword VARCHAR(255) NOT NULL,
            period_type VARCHAR(20) NOT NULL DEFAULT 'always',
            period_value VARCHAR(50),
            weight FLOAT NOT NULL DEFAULT 1.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))


def create_seo_keywords_table(conn) -> None:
    """Create seo_keywords table if it doesn't exist."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS seo_keywords (
            url VARCHAR(2048) PRIMARY KEY,
            keywords TEXT NOT NULL DEFAULT ''
        )
    """))


def migrate_legacy_page_keywords(conn) -> None:
    """Migrate old page_keywords rows into seo_keywords(url, keywords)."""
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
    }
    if "page_keywords" not in tables:
        return

    page_keyword_columns = {
        row[1]
        for row in conn.execute(text("PRAGMA table_info(page_keywords)"))
    }
    role_filter = ""
    if "keyword_role" in page_keyword_columns:
        role_filter = "AND LOWER(COALESCE(pk.keyword_role, 'seo')) = 'seo'"

    rows = conn.execute(
        text(
            f"""
            SELECT
                p.url AS url,
                GROUP_CONCAT(DISTINCT TRIM(pk.keyword)) AS keywords
            FROM page_keywords pk
            JOIN pages p ON p.id = pk.page_id
            WHERE TRIM(COALESCE(pk.keyword, '')) != ''
            {role_filter}
            GROUP BY p.url
            """
        )
    ).fetchall()

    for row in rows:
        conn.execute(
            text(
                """
                INSERT INTO seo_keywords (url, keywords)
                VALUES (:url, :keywords)
                ON CONFLICT(url) DO UPDATE SET keywords = excluded.keywords
                """
            ),
            {"url": row.url, "keywords": row.keywords or ""},
        )

    conn.execute(text("DROP TABLE IF EXISTS page_keywords"))


def create_custom_fonts_table(conn) -> None:
    """Create custom_fonts table if it doesn't exist."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS custom_fonts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename VARCHAR(512) NOT NULL UNIQUE,
            original_name VARCHAR(512),
            family VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))


def _default_font_family_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    fallback_stem = stem.split("__", 1)[1] if "__" in stem else stem
    if re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", fallback_stem.lower()):
        return "Custom Font"
    return fallback_stem.replace("-", " ").replace("_", " ") or "Custom Font"


def backfill_custom_fonts(conn) -> None:
    """Ensure custom_fonts has entries for existing files in storage/fonts."""
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
    }
    if "custom_fonts" not in tables:
        return

    for path in FONT_DIR.glob("*"):
        if path.suffix.lower() not in {".ttf", ".otf", ".woff", ".woff2"}:
            continue
        filename = path.name
        exists = conn.execute(
            text("SELECT 1 FROM custom_fonts WHERE filename = :filename LIMIT 1"),
            {"filename": filename},
        ).first()
        if exists:
            continue

        family = _default_font_family_from_filename(filename)
        conn.execute(
            text(
                """
                INSERT INTO custom_fonts (filename, original_name, family, created_at)
                VALUES (:filename, :original_name, :family, CURRENT_TIMESTAMP)
                """
            ),
            {
                "filename": filename,
                "original_name": filename,
                "family": family,
            },
        )

    # Repair generic labels when we can derive a better family from stored names.
    rows = conn.execute(
        text("SELECT id, filename, original_name, family FROM custom_fonts")
    ).fetchall()
    for row in rows:
        font_id, filename, original_name, family = row
        if (family or "").strip().lower() != "custom font":
            continue
        candidate = None
        if original_name:
            stem = Path(str(original_name)).stem
            if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", stem.lower()):
                candidate = stem.replace("-", " ").replace("_", " ")
        if not candidate:
            stem = Path(str(filename)).stem
            if "__" in stem:
                slug = stem.split("__", 1)[1]
                if slug:
                    candidate = slug.replace("-", " ").replace("_", " ")
        if candidate:
            conn.execute(
                text("UPDATE custom_fonts SET family = :family WHERE id = :id"),
                {"family": candidate, "id": font_id},
            )
