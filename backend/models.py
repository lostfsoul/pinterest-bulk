"""
SQLAlchemy database models.
"""
from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Text, ForeignKey, Float, JSON
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
from database import Base


class Website(Base):
    """Website with sitemap."""
    __tablename__ = "websites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    sitemap_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    pages: Mapped[list["Page"]] = relationship(
        "Page", back_populates="website", cascade="all, delete-orphan"
    )
    import_logs: Mapped[list["ImportLog"]] = relationship(
        "ImportLog", back_populates="website", cascade="all, delete-orphan"
    )


class Page(Base):
    """Page/article from sitemap."""
    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    website_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("websites.id"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sitemap_source: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    scraped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    website: Mapped["Website"] = relationship("Website", back_populates="pages")
    keywords: Mapped[list["PageKeyword"]] = relationship(
        "PageKeyword", back_populates="page", cascade="all, delete-orphan"
    )
    images: Mapped[list["PageImage"]] = relationship(
        "PageImage", back_populates="page", cascade="all, delete-orphan"
    )
    pin_drafts: Mapped[list["PinDraft"]] = relationship(
        "PinDraft", back_populates="page", cascade="all, delete-orphan"
    )


class PageKeyword(Base):
    """Keywords associated with a page."""
    __tablename__ = "page_keywords"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    page_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pages.id"), nullable=False, index=True
    )
    keyword: Mapped[str] = mapped_column(String(255), nullable=False)

    page: Mapped["Page"] = relationship("Page", back_populates="keywords")


class Template(Base):
    """SVG template for pin generation."""
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    overlay_svg: Mapped[str | None] = mapped_column(String(512), nullable=True)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    zones: Mapped[list["TemplateZone"]] = relationship(
        "TemplateZone", back_populates="template", cascade="all, delete-orphan"
    )
    pin_drafts: Mapped[list["PinDraft"]] = relationship(
        "PinDraft", back_populates="template"
    )


class TemplateZone(Base):
    """Zone within a template (text or image)."""
    __tablename__ = "template_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("templates.id"), nullable=False, index=True
    )
    zone_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # "text" or "image"
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    props: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    template: Mapped["Template"] = relationship("Template", back_populates="zones")


class PageImage(Base):
    """Image found on a page."""
    __tablename__ = "page_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    page_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pages.id"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    page: Mapped["Page"] = relationship("Page", back_populates="images")


class PinDraft(Base):
    """Generated pin draft ready for export."""
    __tablename__ = "pin_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    page_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pages.id"), nullable=False, index=True
    )
    template_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("templates.id"), nullable=True
    )
    selected_image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    board_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    link: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    publish_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    keywords: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    text_zone_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_zone_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_zone_pad_left: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_zone_pad_right: Mapped[int | None] = mapped_column(Integer, nullable=True)
    font_family: Mapped[str | None] = mapped_column(String(255), nullable=True)
    text_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), default="draft", nullable=False
    )  # draft, ready, exported, skipped
    is_selected: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    page: Mapped["Page"] = relationship("Page", back_populates="pin_drafts")
    template: Mapped["Template"] = relationship("Template", back_populates="pin_drafts")


class ScheduleSettings(Base):
    """Singleton schedule settings."""
    __tablename__ = "schedule_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    pins_per_day: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    start_hour: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    end_hour: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    min_days_reuse: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    random_minutes: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class ImportLog(Base):
    """Log of import operations."""
    __tablename__ = "import_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # sitemap, keywords
    website_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("websites.id"), nullable=True
    )
    items_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    website: Mapped["Website"] = relationship("Website", back_populates="import_logs")


class ExportLog(Base):
    """Log of export operations."""
    __tablename__ = "export_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    pins_count: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )


class ActivityLog(Base):
    """General activity log for traceability."""
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
