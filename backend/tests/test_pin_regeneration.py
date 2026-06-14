import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import Base  # noqa: E402
from models import (  # noqa: E402
    AIPromptPreset,
    AISettings,
    Page,
    PinDraft,
    SEOKeyword,
    Website,
)
from routers.pins import _regenerate_pin_ai_content  # noqa: E402


class PinRegenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self) -> None:
        self.db.close()

    def test_website_language_overrides_preset_and_global_language(self) -> None:
        presets = {}
        for target in ("title", "description", "board"):
            preset = AIPromptPreset(
                name=f"Italian {target}",
                target_field=target,
                prompt_template=f"Generate an Italian {target}",
                language="Italian",
            )
            self.db.add(preset)
            presets[target] = preset
        self.db.flush()

        self.db.add(
            AISettings(
                default_title_preset_id=presets["title"].id,
                default_description_preset_id=presets["description"].id,
                default_board_preset_id=presets["board"].id,
                default_language="English",
                use_ai_by_default=True,
            )
        )
        website = Website(
            name="Isabella Bakes",
            url="https://isabellabakes.com",
            generation_settings={
                "ai": {
                    "language": "Italian",
                    "tone": "seo-friendly",
                    "cta_style": "soft",
                    "board_candidates": ["Ricette di Pasta", "Ricette Facili"],
                }
            },
        )
        self.db.add(website)
        self.db.flush()
        page = Page(
            website_id=website.id,
            url="https://isabellabakes.com/pasta-al-limone/",
            title="Pasta al limone",
        )
        self.db.add(page)
        self.db.flush()
        pin = PinDraft(
            page_id=page.id,
            title="Old title",
            description="Old description",
            board_name="Ricette Facili",
        )
        self.db.add_all(
            [
                pin,
                SEOKeyword(url=page.url, keywords="pasta al limone, ricetta italiana"),
            ]
        )
        self.db.commit()

        with (
            patch("routers.pins.generate_pin_titles", return_value=["Pasta al limone cremosa"]) as title_mock,
            patch("routers.pins.generate_description_ai", return_value="Una ricetta italiana facile.") as description_mock,
            patch("routers.pins.generate_board_name_ai", return_value="Ricette di Pasta") as board_mock,
        ):
            result = _regenerate_pin_ai_content(
                self.db,
                page=page,
                website=website,
                pin=pin,
            )

        self.assertEqual(result["title"], "Pasta al limone cremosa")
        self.assertEqual(result["description"], "Una ricetta italiana facile.")
        self.assertEqual(result["board_name"], "Ricette di Pasta")
        self.assertEqual(title_mock.call_args.kwargs["language"], "Italian")
        self.assertEqual(description_mock.call_args.kwargs["language"], "Italian")
        self.assertEqual(board_mock.call_args.kwargs["language"], "Italian")
        self.assertEqual(
            title_mock.call_args.args[1],
            ["pasta al limone", "ricetta italiana"],
        )


if __name__ == "__main__":
    unittest.main()
