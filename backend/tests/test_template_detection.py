import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.template_detection import (  # noqa: E402
    build_manifest_v2,
    migrate_manifest_to_v2,
    parse_svg_structure,
    project_manifest_v2_to_legacy_zones,
)


class TemplateDetectionTests(unittest.TestCase):
    def test_parse_svg_structure_detects_images_and_text(self) -> None:
        svg = '''
        <svg xmlns="http://www.w3.org/2000/svg" width="750" height="1575" viewBox="0 0 750 1575">
          <image id="hero" x="0" y="300" width="750" height="900" href="https://example.com/a.jpg" />
          <text x="80" y="200" font-size="72">Summer Salad</text>
        </svg>
        '''
        structure = parse_svg_structure(svg)

        self.assertEqual(structure["canvas"]["width"], 750)
        self.assertEqual(structure["canvas"]["height"], 1575)
        self.assertTrue(len(structure["image_assets"]) >= 1)
        self.assertTrue(len(structure["text_candidates"]) >= 1)

    def test_build_manifest_v2_preserves_existing_replacement_and_font_file(self) -> None:
        structure = {
            "canvas": {"width": 750, "height": 1575},
            "image_assets": [],
            "text_candidates": [
                {
                    "candidate_id": "candidate_text_1",
                    "source_type": "svg_text",
                    "bounds": {"x": 40, "y": 60, "width": 640, "height": 180},
                    "text_hint": "Original headline",
                    "confidence": 0.9,
                },
                {
                    "candidate_id": "candidate_text_2",
                    "source_type": "vector_path_cluster",
                    "bounds": {"x": 80, "y": 260, "width": 520, "height": 100},
                    "text_hint": "Original secondary",
                    "confidence": 0.6,
                },
            ],
        }
        previous_manifest = {
            "version": 2,
            "canvas": {
                "source_width": 750,
                "source_height": 1575,
                "target_width": 750,
                "target_height": 1575,
            },
            "zones": [
                {
                    "id": "zone_main_1",
                    "type": "main_text",
                    "source_type": "svg_text",
                    "editable": True,
                    "confidence": 0.92,
                    "bounds": {"x": 40, "y": 60, "width": 640, "height": 180},
                    "text": "Original headline",
                    "style": {
                        "font_family": "My Font",
                        "font_size": 64,
                        "font_weight": 700,
                        "fill": "#111111",
                        "align": "center",
                        "font_file": "my-font-file.otf",
                    },
                    "replacement": {
                        "text": "Edited Headline",
                        "font_family": "My Font",
                        "font_file": "my-font-file.otf",
                    },
                }
            ],
            "assets": [],
            "meta": {"detected_at": "", "needs_review": False, "strategy": "detection-first"},
        }

        manifest = build_manifest_v2(structure, ocr_results=None, previous_manifest=previous_manifest)
        main_zone = next(zone for zone in manifest["zones"] if zone["type"] == "main_text")

        self.assertEqual(main_zone["replacement"]["text"], "Edited Headline")
        self.assertEqual(main_zone["style"]["font_file"], "my-font-file.otf")
        self.assertEqual(main_zone["replacement"]["font_file"], "my-font-file.otf")

    def test_migrate_v1_to_v2_keeps_custom_font_mapping(self) -> None:
        structure = {
            "canvas": {"width": 750, "height": 1575},
            "image_assets": [],
            "text_candidates": [],
        }
        legacy_manifest = {
            "version": 1,
            "canvas": {"source_width": 750, "source_height": 1575, "target_width": 750, "target_height": 1575},
            "title_zone": {"x": 0, "y": 500, "width": 750, "height": 180},
            "text_style": {
                "font_family": "Main Family",
                "text_color": "#000000",
                "text_align": "center",
                "custom_font_file": "main-custom.otf",
            },
            "secondary_text_slots": [
                {
                    "slot_id": "secondary_1",
                    "x": 100,
                    "y": 720,
                    "width": 500,
                    "height": 90,
                    "font_family": "Secondary Family",
                    "custom_font_file": "secondary-custom.otf",
                    "text_color": "#111111",
                }
            ],
            "secondary_text_defaults": {"secondary_1": "Use site url"},
            "image_slots": [],
        }

        migrated = migrate_manifest_to_v2(legacy_manifest, structure)
        main_zone = next(zone for zone in migrated["zones"] if zone["type"] == "main_text")
        secondary_zone = next(zone for zone in migrated["zones"] if zone["type"] == "secondary_text")

        self.assertEqual(main_zone["style"]["font_file"], "main-custom.otf")
        self.assertEqual(main_zone["replacement"]["font_file"], "main-custom.otf")
        self.assertEqual(secondary_zone["style"]["font_file"], "secondary-custom.otf")

    def test_project_manifest_to_legacy_maps_main_and_secondary_font_files(self) -> None:
        manifest_v2 = {
            "version": 2,
            "canvas": {
                "source_width": 750,
                "source_height": 1575,
                "target_width": 750,
                "target_height": 1575,
            },
            "zones": [
                {
                    "id": "zone_main_1",
                    "type": "main_text",
                    "source_type": "ocr_image",
                    "editable": True,
                    "confidence": 0.9,
                    "bounds": {"x": 0, "y": 500, "width": 750, "height": 180},
                    "text": "Main",
                    "style": {
                        "font_family": "Main",
                        "font_size": 64,
                        "font_weight": 700,
                        "fill": "#111111",
                        "align": "center",
                        "font_file": "main.otf",
                    },
                    "replacement": {
                        "text": "Main edited",
                        "font_family": "Main",
                        "font_file": "main.otf",
                    },
                },
                {
                    "id": "zone_secondary_1",
                    "type": "secondary_text",
                    "source_type": "ocr_image",
                    "editable": True,
                    "confidence": 0.8,
                    "bounds": {"x": 100, "y": 740, "width": 500, "height": 90},
                    "text": "Secondary",
                    "style": {
                        "font_family": "Secondary",
                        "font_size": 32,
                        "font_weight": 700,
                        "fill": "#111111",
                        "align": "center",
                        "font_file": "secondary.otf",
                    },
                    "replacement": {
                        "text": "Secondary edited",
                        "font_family": "Secondary",
                        "font_file": "secondary.otf",
                    },
                },
            ],
            "assets": [],
            "meta": {"detected_at": "", "needs_review": False, "strategy": "detection-first"},
        }

        projected = project_manifest_v2_to_legacy_zones(manifest_v2)
        text_props = projected["text_zone"]["props"]
        secondary_slots = text_props["secondary_text_slots"]

        self.assertEqual(text_props["custom_font_file"], "main.otf")
        self.assertEqual(secondary_slots[0]["custom_font_file"], "secondary.otf")


if __name__ == '__main__':
    unittest.main()
