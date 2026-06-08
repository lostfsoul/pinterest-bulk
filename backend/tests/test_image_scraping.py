import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from bs4 import BeautifulSoup

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import Base  # noqa: E402
from models import Page, PageImage, Website  # noqa: E402
from routers.images import (  # noqa: E402
    ImageScrapeResult,
    canonical_image_url_key,
    extract_best_image_url,
    has_bad_image_ancestor,
    image_variant_score,
    scrape_page_into_db,
)
from services.image_dedupe import dedupe_image_variants  # noqa: E402
from services.image_metadata import ImageMetadata  # noqa: E402


class ImageUrlExtractionTests(unittest.TestCase):
    def test_extract_best_image_url_skips_inline_placeholder_for_lazy_url(self) -> None:
        img_tag = (
            ' src="data:image/svg+xml,%3Csvg%3E"'
            ' data-lazy-src="https://example.com/uploads/real.webp"'
            ' width="960" height="1200"'
        )

        self.assertEqual(
            extract_best_image_url(img_tag),
            "https://example.com/uploads/real.webp",
        )

    def test_extract_best_image_url_uses_largest_srcset_candidate(self) -> None:
        img_tag = (
            ' src="data:image/svg+xml,%3Csvg%3E"'
            ' srcset="https://example.com/small.webp 480w, https://example.com/large.webp 960w"'
        )

        self.assertEqual(
            extract_best_image_url(img_tag),
            "https://example.com/large.webp",
        )

    def test_bad_image_ancestor_detects_affiliate_product_block(self) -> None:
        soup = BeautifulSoup(
            """
            <div class="entry-content">
              <div id="faa-ob-block_matsato" class="no-ads ai-no-insert disable-ads">
                <div class="amazon-container">
                  <a class="amazon-image-link" href="https://get-matsato.com/?affiliate_id=1">
                    <img class="amazon-product-image" src="https://example.com/matsato.webp" />
                  </a>
                </div>
              </div>
            </div>
            """,
            "html.parser",
        )

        self.assertTrue(has_bad_image_ancestor(soup.find("img")))

    def test_canonical_image_url_key_groups_wordpress_size_variants(self) -> None:
        self.assertEqual(
            canonical_image_url_key("https://isabellabakes.com/wp-content/uploads/2026/02/5-18-768x960.webp"),
            canonical_image_url_key("https://isabellabakes.com/wp-content/uploads/2026/02/5-18.webp"),
        )

    def test_image_variant_score_prefers_original_over_resized_variant(self) -> None:
        self.assertGreater(
            image_variant_score("https://isabellabakes.com/wp-content/uploads/2026/02/5-18.webp"),
            image_variant_score("https://isabellabakes.com/wp-content/uploads/2026/02/5-18-768x960.webp"),
        )

    def test_dedupe_image_variants_keeps_original_and_distinct_image(self) -> None:
        urls = dedupe_image_variants(
            [
                "https://example.com/uploads/meal-768x960.webp",
                "https://example.com/uploads/meal.webp",
                "https://example.com/uploads/meal-step-2.webp",
            ],
            lambda url: url,
        )

        self.assertEqual(
            urls,
            [
                "https://example.com/uploads/meal.webp",
                "https://example.com/uploads/meal-step-2.webp",
            ],
        )


class ScrapePersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_scrape_preserves_existing_usable_images(self) -> None:
        db, page = self._build_page_with_existing_image()
        try:
            images = await scrape_page_into_db(page, db, [], pre_scrape_results=[])

            self.assertEqual(len(images), 1)
            stored = db.query(PageImage).filter(PageImage.page_id == page.id).all()
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0].url, "https://example.com/uploads/old.webp")
            self.assertIsNotNone(page.scraped_at)
        finally:
            db.close()

    async def test_excluded_only_scrape_preserves_existing_usable_images(self) -> None:
        db, page = self._build_page_with_existing_image()
        try:
            with patch(
                "routers.images.fetch_image_metadata",
                AsyncMock(return_value=ImageMetadata(width=960, height=1200, mime_type="image/svg+xml", format="SVG")),
            ):
                images = await scrape_page_into_db(
                    page,
                    db,
                    [],
                    pre_scrape_results=[ImageScrapeResult(url="https://example.com/uploads/placeholder.svg")],
                )

            self.assertEqual(len(images), 1)
            stored = db.query(PageImage).filter(PageImage.page_id == page.id).all()
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0].url, "https://example.com/uploads/old.webp")
            self.assertFalse(stored[0].is_excluded)
        finally:
            db.close()

    def _build_page_with_existing_image(self):
        engine = create_engine("sqlite:///:memory:")
        Session = sessionmaker(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = Session()
        try:
            website = Website(name="Example", url="https://example.com")
            db.add(website)
            db.commit()
            page = Page(
                website_id=website.id,
                url="https://example.com/post",
                title="Example Post",
                is_utility_page=False,
                is_enabled=True,
            )
            db.add(page)
            db.commit()
            old_image = PageImage(
                page_id=page.id,
                url="https://example.com/uploads/old.webp",
                is_excluded=False,
                width=960,
                height=1200,
                is_article_image=True,
                is_hq=True,
                category="article",
                excluded_by_global_rule=False,
                created_at=datetime.utcnow(),
            )
            db.add(old_image)
            db.commit()
            return db, page
        except Exception:
            db.close()
            raise


if __name__ == "__main__":
    unittest.main()
