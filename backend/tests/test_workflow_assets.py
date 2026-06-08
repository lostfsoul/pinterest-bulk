import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import Base  # noqa: E402
from models import CustomFont, Template, Website  # noqa: E402
from services.workflow_service import WorkflowSetupError, build_generation_payload  # noqa: E402


class WorkflowAssetValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Session = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = Session()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _create_website(self, font_set: str) -> Website:
        template = Template(name="Main", filename="main.svg", width=1000, height=1500)
        self.db.add(template)
        self.db.commit()
        website = Website(
            name="Example",
            url="https://example.com",
            generation_settings={
                "playground": {
                    "selected_templates": [template.id],
                    "default_template_id": template.id,
                    "font_set": font_set,
                },
            },
        )
        self.db.add(website)
        self.db.commit()
        return website

    def test_missing_template_file_returns_structured_setup_error(self) -> None:
        website = self._create_website("font_combo_1")
        with (
            tempfile.TemporaryDirectory() as template_dir,
            tempfile.TemporaryDirectory() as font_dir,
            patch("services.workflow_service._TEMPLATE_STORAGE_ROOT", Path(template_dir)),
            patch("services.workflow_service._FONT_STORAGE_ROOT", Path(font_dir)),
        ):
            with self.assertRaises(WorkflowSetupError) as raised:
                build_generation_payload(self.db, website)

        self.assertEqual(raised.exception.code, "template_file_missing")
        self.assertEqual(raised.exception.setup_section, "design")

    def test_missing_custom_font_file_returns_structured_setup_error(self) -> None:
        website = self._create_website("custom:missing.otf")
        self.db.add(CustomFont(filename="missing.otf", family="Missing Font"))
        self.db.commit()
        with (
            tempfile.TemporaryDirectory() as template_dir,
            tempfile.TemporaryDirectory() as font_dir,
            patch("services.workflow_service._TEMPLATE_STORAGE_ROOT", Path(template_dir)),
            patch("services.workflow_service._FONT_STORAGE_ROOT", Path(font_dir)),
        ):
            Path(template_dir, "main.svg").write_text("<svg/>", encoding="utf-8")
            with self.assertRaises(WorkflowSetupError) as raised:
                build_generation_payload(self.db, website)

        self.assertEqual(raised.exception.code, "font_file_missing")
        self.assertIn("Missing Font", raised.exception.message)


if __name__ == "__main__":
    unittest.main()
