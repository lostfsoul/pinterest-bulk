import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.language_detection import (  # noqa: E402
    classify_website_language,
    detect_website_language,
    extract_language_sample,
    normalize_ai_language,
)


class WebsiteLanguageDetectionTests(unittest.TestCase):
    def test_extracts_visible_homepage_text(self) -> None:
        html = """
        <html><body>
          <script>ignore me</script>
          <h1>Ricette italiane facili</h1>
          <p>Pasta cremosa e deliziosa.</p>
        </body></html>
        """
        sample = extract_language_sample(html)
        self.assertIn("Ricette italiane facili", sample)
        self.assertNotIn("ignore me", sample)

    def test_validates_supported_ai_language(self) -> None:
        self.assertEqual(normalize_ai_language("Italian"), "Italian")
        self.assertEqual(normalize_ai_language("The language is Italian."), "Italian")
        self.assertIsNone(normalize_ai_language("UnsupportedLanguage"))

    def test_classification_uses_ai_result(self) -> None:
        with patch("services.language_detection.call_model", return_value="Italian") as model:
            language = classify_website_language(
                "https://isabellabakes.com",
                "Isabella Bakes",
                "Ricette italiane facili",
            )

        self.assertEqual(language, "Italian")
        self.assertIn("isabellabakes.com", model.call_args.args[0])

    def test_invalid_ai_result_returns_none_for_english_fallback(self) -> None:
        with patch("services.language_detection.call_model", return_value="I am not sure"):
            self.assertIsNone(
                classify_website_language("https://example.com", "Example", "")
            )


class WebsiteLanguageDetectionAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_ai_is_called_even_when_homepage_fetch_fails(self) -> None:
        with (
            patch(
                "services.language_detection.fetch_remote",
                AsyncMock(side_effect=RuntimeError("network unavailable")),
            ),
            patch(
                "services.language_detection.asyncio.to_thread",
                AsyncMock(return_value="Italian"),
            ) as to_thread,
        ):
            language = await detect_website_language(
                "https://isabellabakes.com",
                "Isabella Bakes",
            )

        self.assertEqual(language, "Italian")
        self.assertEqual(to_thread.call_args.args[3], "")


if __name__ == "__main__":
    unittest.main()
