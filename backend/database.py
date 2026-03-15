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
