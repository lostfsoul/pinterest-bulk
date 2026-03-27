"""
Image metadata fetching service.
Fetches image dimensions, file size, and MIME type via HEAD request.
"""
import httpx
from dataclasses import dataclass
from typing import Literal

# User agent for requests
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PinterestCSVTool/1.0; +https://github.com/pinterest-csv-tool)"
}

# Mapping of MIME types to format names
MIME_TO_FORMAT = {
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WebP",
    "image/svg+xml": "SVG",
    "image/bmp": "BMP",
    "image/tiff": "TIFF",
    "image/x-icon": "ICO",
}


@dataclass
class ImageMetadata:
    """Metadata extracted from an image URL."""
    width: int | None = None
    height: int | None = None
    file_size: int | None = None  # bytes
    mime_type: str | None = None
    format: str | None = None


async def fetch_image_metadata(image_url: str) -> ImageMetadata:
    """
    Fetch metadata for an image URL using a HEAD request.

    Returns an ImageMetadata object with available information.
    Note: HEAD requests don't return Content-Length for many servers,
    so we also try a small range request to get file size.
    """
    metadata = ImageMetadata()

    # Skip data URIs - they're base64 encoded inline images (usually placeholders)
    if image_url.startswith("data:"):
        return metadata

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=HEADERS) as client:
            # First try HEAD request
            response = await client.head(image_url)

            # Get MIME type from Content-Type header
            content_type = response.headers.get("content-type", "")
            if content_type:
                metadata.mime_type = content_type.split(";")[0].strip().lower()
                metadata.format = MIME_TO_FORMAT.get(metadata.mime_type, metadata.mime_type.upper().replace("IMAGE/", ""))

            # Try to get file size from Content-Length
            content_length = response.headers.get("content-length")
            if content_length:
                try:
                    metadata.file_size = int(content_length)
                except (ValueError, TypeError):
                    pass

            # For many CDNs, HEAD doesn't return Content-Length
            # Try a small range request to get file size
            if metadata.file_size is None:
                try:
                    range_response = await client.get(
                        image_url,
                        headers={"Range": "bytes=0-0"}
                    )
                    content_range = range_response.headers.get("content-range", "")
                    if content_range:
                        # Content-Range: bytes 0-0/12345
                        if "/" in content_range:
                            size_str = content_range.split("/")[-1]
                            if size_str != "*":
                                metadata.file_size = int(size_str)
                except Exception:
                    pass

            # Try to determine dimensions from the URL pattern
            # Many image CDNs include dimensions in the URL
            url_lower = image_url.lower()
            if "width" in url_lower or "w_" in url_lower or "-w-" in url_lower:
                # Try to extract width from URL patterns like ?w=800, /w_800/, /-w-800-/
                import re
                width_match = re.search(r'[/_-]w[_-]?(\d+)', url_lower)
                if width_match:
                    metadata.width = int(width_match.group(1))
                height_match = re.search(r'[/_-]h[_-]?(\d+)', url_lower)
                if height_match:
                    metadata.height = int(height_match.group(1))

    except Exception as e:
        print(f"Error fetching metadata for {image_url}: {e}")

    return metadata


def is_hq_image(metadata: ImageMetadata, url: str) -> bool:
    """
    Determine if an image qualifies as HQ based on metadata and URL.

    HQ Criteria:
    - Dimensions >= 600x600
    - File size >= 50KB
    - Filename contains "hq", "high-quality", "original", "large"
    """
    url_lower = url.lower()

    # Check URL patterns for HQ indicators
    hq_patterns = ["hq", "high-quality", "high_quality", "original", "large", "full", "fullsize", "full-size"]
    if any(pattern in url_lower for pattern in hq_patterns):
        return True

    # Check dimensions
    if metadata.width and metadata.height:
        if metadata.width >= 600 and metadata.height >= 600:
            return True

    # Check file size (50KB = 51200 bytes)
    if metadata.file_size and metadata.file_size >= 51200:
        return True

    return False