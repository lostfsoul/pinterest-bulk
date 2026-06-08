import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.pin_renderer import (  # noqa: E402
    _render_with_nodejs,
    delete_generated_media,
    select_render_image_urls,
)
from services.remote_fetch import (  # noqa: E402
    RemoteFetchError,
    fetch_remote,
    validate_remote_url,
)


class RemoteFetchSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_loopback_address(self) -> None:
        with self.assertRaises(RemoteFetchError):
            await validate_remote_url("http://127.0.0.1/private")

    async def test_rejects_response_larger_than_limit(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"content-type": "text/html"},
                content=b"x" * 32,
                request=request,
            )
        )
        async with httpx.AsyncClient(transport=transport) as client:
            with patch(
                "services.remote_fetch.validate_remote_url",
                AsyncMock(return_value=None),
            ):
                with self.assertRaises(RemoteFetchError):
                    await fetch_remote(
                        "https://example.com/page",
                        max_bytes=16,
                        client=client,
                    )

    async def test_revalidates_redirect_destination(self) -> None:
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                302,
                headers={"location": "http://127.0.0.1/private"},
                request=request,
            )
        )
        async with httpx.AsyncClient(transport=transport) as client:
            validator = AsyncMock(
                side_effect=[None, RemoteFetchError("private address")],
            )
            with patch("services.remote_fetch.validate_remote_url", validator):
                with self.assertRaises(RemoteFetchError):
                    await fetch_remote("https://example.com", client=client)
            self.assertEqual(validator.await_count, 2)


class RendererSelectionTests(unittest.TestCase):
    def test_selected_image_is_always_first(self) -> None:
        urls = select_render_image_urls(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            "https://example.com/b.jpg",
            2,
        )
        self.assertEqual(urls[0], "https://example.com/b.jpg")
        self.assertEqual(len(urls), 2)

    def test_single_slot_returns_only_selected_image(self) -> None:
        urls = select_render_image_urls(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            "https://example.com/b.jpg",
            1,
        )
        self.assertEqual(urls, ["https://example.com/b.jpg"])

    def test_wordpress_size_variant_is_not_selected_as_second_image(self) -> None:
        selected = "https://example.com/wp-content/uploads/2026/01/meal-768x960.webp"
        distinct = "https://example.com/wp-content/uploads/2026/01/meal-step-2.webp"
        urls = select_render_image_urls(
            [
                "https://example.com/wp-content/uploads/2026/01/meal.webp",
                selected,
                distinct,
            ],
            selected,
            2,
        )

        self.assertEqual(urls, [selected, distinct])

    def test_generated_media_delete_is_scoped_to_render_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            render_dir = Path(temp_dir)
            media_file = render_dir / "pin_1.png"
            media_file.write_bytes(b"png")
            with patch("services.pin_renderer.RENDERER_DIR", render_dir):
                delete_generated_media("/static/pins/pin_1.png?v=1")
            self.assertFalse(media_file.exists())


class RendererProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_node_renderer_is_killed_after_timeout(self) -> None:
        class FakeProcess:
            returncode = None

            def __init__(self):
                self.calls = 0
                self.killed = False

            async def communicate(self):
                self.calls += 1
                if self.calls == 1:
                    await asyncio.sleep(1)
                return b"", b""

            def kill(self):
                self.killed = True
                self.returncode = -9

        process = FakeProcess()
        with (
            patch(
                "services.pin_renderer.asyncio.create_subprocess_exec",
                AsyncMock(return_value=process),
            ),
            patch("services.pin_renderer.RENDER_TIMEOUT_SECONDS", 0.01),
        ):
            with self.assertRaises(TimeoutError):
                await _render_with_nodejs({"outputPath": "/tmp/unused.png"})
        self.assertTrue(process.killed)


if __name__ == "__main__":
    unittest.main()
