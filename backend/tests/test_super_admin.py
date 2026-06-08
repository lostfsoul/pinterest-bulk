import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import Base  # noqa: E402
from models import (  # noqa: E402
    AISettings,
    GenerationJob,
    Page,
    PinDraft,
    ScheduleSettings,
    Template,
    TemplateZone,
    Website,
)
from routers.super_admin import (  # noqa: E402
    SuperAdminPasswordRequest,
    clear_database,
    delete_all_svgs,
    verify_super_admin,
)


class SuperAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Session = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = Session()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_invalid_password_is_rejected(self) -> None:
        with patch.dict(os.environ, {"SUPER_ADMIN_PASSWORD": "secret"}):
            with self.assertRaises(HTTPException) as raised:
                verify_super_admin(SuperAdminPasswordRequest(password="wrong"))
        self.assertEqual(raised.exception.status_code, 401)

    def test_delete_svgs_clears_records_files_and_references(self) -> None:
        website = Website(
            name="Example",
            url="https://example.com",
            generation_settings={
                "playground": {
                    "selected_templates": [1],
                    "default_template_id": 1,
                },
            },
        )
        template = Template(name="Template", filename="template.svg", width=1000, height=1500)
        self.db.add_all([website, template])
        self.db.commit()
        self.db.add(TemplateZone(
            template_id=template.id,
            zone_type="image",
            x=0,
            y=0,
            width=100,
            height=100,
        ))
        self.db.commit()

        with tempfile.TemporaryDirectory() as template_dir, tempfile.TemporaryDirectory() as overlay_dir:
            Path(template_dir, "template.svg").write_text("<svg/>", encoding="utf-8")
            Path(overlay_dir, "overlay.svg").write_text("<svg/>", encoding="utf-8")
            with (
                patch.dict(os.environ, {"SUPER_ADMIN_PASSWORD": "secret"}),
                patch("routers.super_admin.TEMPLATE_DIR", Path(template_dir)),
                patch("routers.super_admin.OVERLAY_DIR", Path(overlay_dir)),
            ):
                result = delete_all_svgs(
                    SuperAdminPasswordRequest(password="secret"),
                    self.db,
                )

        self.assertEqual(result.deleted_records, 1)
        self.assertEqual(result.deleted_files, 2)
        self.assertEqual(self.db.query(Template).count(), 0)
        self.assertEqual(self.db.query(TemplateZone).count(), 0)
        self.db.refresh(website)
        self.assertEqual(website.generation_settings["playground"]["selected_templates"], [])
        self.assertIsNone(website.generation_settings["playground"]["default_template_id"])

    def test_clear_database_recreates_required_settings(self) -> None:
        website = Website(name="Example", url="https://example.com")
        template = Template(name="Template", filename="template.svg", width=1000, height=1500)
        self.db.add_all([website, template])
        self.db.commit()
        page = Page(website_id=website.id, url="https://example.com/post", title="Post")
        self.db.add(page)
        self.db.commit()
        self.db.add(PinDraft(page_id=page.id, template_id=template.id))
        self.db.commit()

        with tempfile.TemporaryDirectory() as storage:
            root = Path(storage)
            directories = {
                name: root / name
                for name in ("templates", "overlays", "fonts", "generated", "exports")
            }
            for directory in directories.values():
                directory.mkdir()
                (directory / "file.dat").write_bytes(b"x")
            with (
                patch.dict(os.environ, {"SUPER_ADMIN_PASSWORD": "secret"}),
                patch("routers.super_admin.TEMPLATE_DIR", directories["templates"]),
                patch("routers.super_admin.OVERLAY_DIR", directories["overlays"]),
                patch("routers.super_admin.FONT_DIR", directories["fonts"]),
                patch("routers.super_admin.GENERATED_PIN_DIR", directories["generated"]),
                patch("routers.super_admin.EXPORT_DIR", directories["exports"]),
            ):
                result = clear_database(
                    SuperAdminPasswordRequest(password="secret"),
                    self.db,
                )

        self.assertGreaterEqual(result.deleted_records, 4)
        self.assertEqual(result.deleted_files, 5)
        self.assertEqual(self.db.query(Website).count(), 0)
        self.assertEqual(self.db.query(Page).count(), 0)
        self.assertEqual(self.db.query(PinDraft).count(), 0)
        self.assertEqual(self.db.query(Template).count(), 0)
        self.assertEqual(self.db.query(ScheduleSettings).count(), 1)
        self.assertEqual(self.db.query(AISettings).count(), 1)

    def test_clear_is_blocked_during_active_generation(self) -> None:
        self.db.add(GenerationJob(status="running", phase="rendering"))
        self.db.commit()
        with patch.dict(os.environ, {"SUPER_ADMIN_PASSWORD": "secret"}):
            with self.assertRaises(HTTPException) as raised:
                clear_database(
                    SuperAdminPasswordRequest(password="secret"),
                    self.db,
                )
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
