"""
SQLite database setup and session management.
"""
import os
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool

# Ensure data directory exists
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR}/pinterest.db"

# Create engine with connection pooling for SQLite
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


PIN_DRAFT_MIGRATIONS = {
    "text_zone_y": "ALTER TABLE pin_drafts ADD COLUMN text_zone_y INTEGER",
    "text_zone_height": "ALTER TABLE pin_drafts ADD COLUMN text_zone_height INTEGER",
    "text_zone_pad_left": "ALTER TABLE pin_drafts ADD COLUMN text_zone_pad_left INTEGER",
    "text_zone_pad_right": "ALTER TABLE pin_drafts ADD COLUMN text_zone_pad_right INTEGER",
    "font_family": "ALTER TABLE pin_drafts ADD COLUMN font_family VARCHAR(255)",
    "text_color": "ALTER TABLE pin_drafts ADD COLUMN text_color VARCHAR(32)",
}

PAGE_MIGRATIONS = {
    "section": "ALTER TABLE pages ADD COLUMN section VARCHAR(255)",
    "sitemap_source": "ALTER TABLE pages ADD COLUMN sitemap_source VARCHAR(1024)",
    "sitemap_bucket": "ALTER TABLE pages ADD COLUMN sitemap_bucket VARCHAR(50)",
    "is_utility_page": "ALTER TABLE pages ADD COLUMN is_utility_page BOOLEAN NOT NULL DEFAULT 0",
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

PAGE_KEYWORD_MIGRATIONS = {
    "period_type": "ALTER TABLE page_keywords ADD COLUMN period_type VARCHAR(20) NOT NULL DEFAULT 'always'",
    "period_value": "ALTER TABLE page_keywords ADD COLUMN period_value VARCHAR(50)",
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


def get_db():
    """Dependency for getting database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables."""
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

        # Migrate page_images table
        page_image_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(page_images)"))
        }
        for column, ddl in PAGE_IMAGE_MIGRATIONS.items():
            if column not in page_image_columns:
                conn.execute(text(ddl))

        # Migrate page_keywords table
        page_keyword_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(page_keywords)"))
        }
        for column, ddl in PAGE_KEYWORD_MIGRATIONS.items():
            if column not in page_keyword_columns:
                conn.execute(text(ddl))

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
