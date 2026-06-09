import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.trend_ranking import _derive_active_period, rank_pages_for_trends  # noqa: E402
from routers.pins import (  # noqa: E402
    assign_board_name,
    generate_pin_description,
    normalize_generation_keywords,
    sanitize_generated_text,
    select_keywords_for_generation,
)


def page(page_id: int, title: str) -> SimpleNamespace:
    return SimpleNamespace(id=page_id, website_id=1, title=title, url=f"https://example.com/{page_id}")


ACTIVE_MONTH, ACTIVE_SEASON = _derive_active_period()


def trend(
    keyword: str,
    period_type: str = "month",
    period_value: str | None = ACTIVE_MONTH,
    weight: float = 1.0,
) -> SimpleNamespace:
    return SimpleNamespace(
        keyword=keyword,
        period_type=period_type,
        period_value=period_value,
        weight=weight,
    )


def rank_pages(pages: list[SimpleNamespace], trends: list[SimpleNamespace], **kwargs):
    return rank_pages_for_trends(
        pages,
        trend_keywords_by_website={1: trends},
        generation_settings_by_website={1: {"trend": {"enabled": True}}},
        **kwargs,
    )


class TrendRankingTests(unittest.TestCase):
    def test_month_phrase_matches_full_and_reordered_titles(self) -> None:
        pages = [
            page(1, "Cheesy Chicken Pasta Bake"),
            page(2, "Pasta with Cheesy Chicken"),
        ]

        ranked, meta = rank_pages(pages, [trend("Cheesy Chicken Pasta")])

        self.assertEqual([item.id for item in ranked], [1, 2])
        self.assertEqual([item["bucket"] for item in meta["page_scores"]], ["month", "month"])

    def test_two_word_partial_match_is_valid(self) -> None:
        pages = [
            page(1, "One-pot Chicken Pasta"),
            page(2, "Cheesy Pasta Salad"),
        ]

        ranked, meta = rank_pages(pages, [trend("Cheesy Chicken Pasta")])

        self.assertEqual([item.id for item in ranked], [1, 2])
        self.assertTrue(all(item["score"] > 0 for item in meta["page_scores"]))

    def test_one_word_hit_falls_to_evergreen(self) -> None:
        pages = [
            page(1, "Cheesy Chicken Pasta Bake"),
            page(2, "The Best Pasta Shapes"),
        ]

        ranked, meta = rank_pages(pages, [trend("Cheesy Chicken Pasta")])

        self.assertEqual([item.id for item in ranked], [1, 2])
        self.assertEqual(meta["page_scores"][1]["bucket"], "evergreen")
        self.assertEqual(meta["page_scores"][1]["score"], 0.0)

    def test_month_priority_removes_pages_before_season_pass(self) -> None:
        pages = [
            page(1, "Cheesy Chicken Pasta Banana Bread Muffins"),
            page(2, "Banana Muffin Tops Recipe"),
        ]
        trends = [
            trend("Banana Bread Muffins", period_type="season", period_value=ACTIVE_SEASON, weight=10.0),
            trend("Cheesy Chicken Pasta", period_type="month", period_value=ACTIVE_MONTH, weight=1.0),
        ]

        ranked, meta = rank_pages(pages, trends)

        self.assertEqual([item.id for item in ranked], [1, 2])
        self.assertEqual(meta["page_scores"][0]["bucket"], "month")
        self.assertEqual(meta["page_scores"][1]["bucket"], "season")

    def test_always_rows_and_seo_keywords_do_not_create_trend_matches(self) -> None:
        pages = [
            page(1, "Cheesy Chicken Pasta Bake"),
            page(2, "The Best Shapes"),
        ]
        trends = [
            trend("Pasta Shapes", period_type="always", period_value=None, weight=10.0),
            trend("Cheesy Chicken Pasta", period_type="month", period_value=ACTIVE_MONTH, weight=1.0),
        ]

        ranked, meta = rank_pages(
            pages,
            trends,
            seo_keywords_by_url={"https://example.com/2": ["Cheesy Chicken Pasta"]},
        )

        self.assertEqual([item.id for item in ranked], [1, 2])
        self.assertEqual(meta["page_scores"][1]["bucket"], "evergreen")


class SEOKeywordGenerationTests(unittest.TestCase):
    def test_generation_keywords_are_normalized_and_limited(self) -> None:
        keywords = normalize_generation_keywords(
            ["  Easy   Dinner  ", "easy dinner", "Quick Meal", "", "Quick   Meal"],
            limit=3,
        )

        self.assertEqual(keywords, ["Easy Dinner", "Quick Meal"])
        self.assertEqual(select_keywords_for_generation(keywords), ["Easy Dinner", "Quick Meal"])

    def test_fallback_description_does_not_print_keyword_label(self) -> None:
        description = generate_pin_description(
            page(1, "Easy Weeknight Dinner"),
            ["quick dinner", "family meals"],
        )

        self.assertIn("quick dinner", description)
        self.assertNotIn("Keywords:", description)


class BoardAssignmentTests(unittest.TestCase):
    BOARDS = [
        "Easy Dinner Recipes",
        "Pasta Recipes",
        "Healthy Recipes",
        "Dessert Recipes",
        "Easy Baking Recipes",
        "Italian Recipes",
        "Salad Recipes",
        "Vegetarian Recipes",
        "Summer Recipes",
    ]

    def assign(self, title: str) -> str:
        item = page(1, title)
        return assign_board_name(
            page=item,
            board_candidates=self.BOARDS,
            keywords=[],
            ai_suggestion="",
            fallback=self.BOARDS[0],
        )

    def test_italian_dessert_uses_dessert_board(self) -> None:
        self.assertEqual(
            self.assign("Tiramisu alle fragole senza cottura fresco e delizioso"),
            "Dessert Recipes",
        )

    def test_italian_pasta_uses_pasta_board(self) -> None:
        self.assertEqual(
            self.assign("Pasta fredda con salmone e rucola fresca e gustosa"),
            "Pasta Recipes",
        )

    def test_italian_salad_uses_salad_board(self) -> None:
        self.assertEqual(
            self.assign("Insalata di ceci con rucola fresca e ricca di nutrienti"),
            "Salad Recipes",
        )

    def test_exact_ai_candidate_still_has_priority(self) -> None:
        item = page(1, "Tiramisu alle fragole")
        self.assertEqual(
            assign_board_name(
                page=item,
                board_candidates=self.BOARDS,
                keywords=[],
                ai_suggestion="Easy Baking Recipes",
                fallback=self.BOARDS[0],
            ),
            "Easy Baking Recipes",
        )

    def test_percent_encoded_emoji_is_not_exported_as_text(self) -> None:
        self.assertEqual(
            sanitize_generated_text("Rotoli al limone %F0%9F%8D%8B"),
            "Rotoli al limone",
        )


if __name__ == "__main__":
    unittest.main()
