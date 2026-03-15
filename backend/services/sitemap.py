"""
Sitemap fetching and parsing service.
"""
import re
from typing import Any
from urllib.parse import urljoin, urlparse
import httpx
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Page, Website, ImportLog
from schemas import SitemapImportResponse


async def fetch_sitemap(sitemap_url: str) -> str | None:
    """Fetch sitemap XML content."""
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(sitemap_url)
            response.raise_for_status()
            return response.text
    except Exception as e:
        print(f"Error fetching sitemap: {e}")
        return None


def derive_section_from_sitemap_url(sitemap_url: str) -> str | None:
    """Infer a useful section/category name from a sitemap filename."""
    filename = urlparse(sitemap_url).path.rsplit("/", 1)[-1].lower()
    if not filename:
        return None

    filename = re.sub(r"\.xml(?:\.gz)?$", "", filename)
    filename = filename.replace("sitemap-", "").replace("-sitemap", "")
    filename = filename.replace("_", "-")

    noisy_tokens = {"post", "posts", "page", "pages", "index", "1", "2", "3"}
    parts = [part for part in filename.split("-") if part and part not in noisy_tokens]
    if not parts:
        return None

    return " ".join(parts)


def parse_sitemap_xml(xml_content: str, base_url: str = "") -> list[str]:
    """Parse sitemap XML and extract URLs."""
    import xml.etree.ElementTree as ET

    urls = []
    try:
        root = ET.fromstring(xml_content)

        # Handle different namespace formats
        namespaces = {
            "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
            "sitemap": "http://www.sitemaps.org/schemas/sitemap/0.9",
        }

        # Try to find <url> elements directly
        url_elements = root.findall(".//url", namespaces) + root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}url")

        if not url_elements:
            # Try without namespace
            url_elements = root.findall(".//url")

        for url_elem in url_elements:
            loc_elem = url_elem.find(
                "loc",
                {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            )
            if loc_elem is None:
                loc_elem = url_elem.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
            if loc_elem is None:
                # Try without namespace
                loc_elem = url_elem.find("loc")

            if loc_elem is not None and loc_elem.text:
                url = loc_elem.text.strip()
                if base_url:
                    url = urljoin(base_url, url)
                urls.append(url)

        # Check for sitemap index (referencing other sitemaps)
        sitemap_elements = (
            root.findall(".//sitemap", namespaces) +
            root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}sitemap")
        )
        if not sitemap_elements:
            sitemap_elements = root.findall(".//sitemap")

        if sitemap_elements and not url_elements:
            # This is a sitemap index - return empty for now
            # Could be extended to fetch child sitemaps recursively
            pass

    except Exception as e:
        print(f"Error parsing sitemap XML: {e}")

    return urls


async def fetch_and_parse_sitemap(sitemap_url: str, base_url: str = "") -> list[dict[str, str | None]]:
    """Fetch and parse sitemap, handling sitemap indexes recursively."""
    urls = []
    sitemap_urls_to_fetch = [sitemap_url]
    fetched_sitemaps = set()
    max_sitemaps = 50  # Safety limit
    fetch_count = 0

    while sitemap_urls_to_fetch and fetch_count < max_sitemaps:
        current_url = sitemap_urls_to_fetch.pop(0)

        if current_url in fetched_sitemaps:
            continue
        fetched_sitemaps.add(current_url)
        fetch_count += 1

        xml_content = await fetch_sitemap(current_url)
        if not xml_content:
            continue

        # Parse the sitemap
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(xml_content)

            # Check for URL entries
            url_elements = (
                root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}url") +
                root.findall(".//url")
            )
            for url_elem in url_elements:
                loc_elem = url_elem.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
                if loc_elem is None:
                    loc_elem = url_elem.find("loc")
                if loc_elem is not None and loc_elem.text:
                    url = loc_elem.text.strip()
                    if base_url:
                        url = urljoin(base_url, url)
                    urls.append({
                        "url": url,
                        "sitemap_source": current_url,
                        "section": derive_section_from_sitemap_url(current_url),
                    })

            # Check for sitemap index entries (child sitemaps)
            sitemap_elements = (
                root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}sitemap") +
                root.findall(".//sitemap")
            )
            for sitemap_elem in sitemap_elements:
                loc_elem = sitemap_elem.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
                if loc_elem is None:
                    loc_elem = sitemap_elem.find("loc")
                if loc_elem is not None and loc_elem.text:
                    child_sitemap_url = loc_elem.text.strip()
                    if child_sitemap_url not in fetched_sitemaps:
                        sitemap_urls_to_fetch.append(child_sitemap_url)

        except Exception as e:
            print(f"Error parsing sitemap {current_url}: {e}")

    return urls


def filter_page_urls(url_entries: list[dict[str, str | None]], base_domain: str = "") -> list[dict[str, str | None]]:
    """Filter URLs to keep only article/content pages."""
    filtered = []
    base_domain_parsed = urlparse(base_domain).netloc.lower() if base_domain else ""

    # Patterns to exclude
    exclude_patterns = [
        r"/tag/",
        r"/category/",
        r"/author/",
        r"/feed",
        r"/rss",
        r"/comment",
        r"/wp-json",
        r"\.css$",
        r"\.js$",
        r"\.jpg$",
        r"\.png$",
        r"\.gif$",
        r"\.pdf$",
        r"/page/\d+",
    ]

    # Patterns to prefer
    include_patterns = [
        r"/\d{4}/",  # Year in URL like /2024/
        r"/blog/",
        r"/article/",
        r"/post/",
    ]

    for entry in url_entries:
        url = entry["url"] or ""
        parsed = urlparse(url)
        url_lower = url.lower()

        # Skip if base domain doesn't match
        if base_domain_parsed and base_domain_parsed not in parsed.netloc.lower():
            continue

        # Check exclude patterns
        if any(re.search(pattern, url_lower) for pattern in exclude_patterns):
            continue

        filtered.append(entry)

    return filtered


async def import_sitemap(website_id: int, db: Session) -> SitemapImportResponse:
    """Import sitemap for a website. Handles sitemap indexes recursively."""
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        return SitemapImportResponse(
            total_urls=0, new_pages=0, updated_pages=0, errors=["Website not found"]
        )

    if not website.sitemap_url:
        return SitemapImportResponse(
            total_urls=0, new_pages=0, updated_pages=0, errors=["No sitemap URL configured"]
        )

    # Fetch and parse sitemap (handles indexes recursively)
    all_urls = await fetch_and_parse_sitemap(website.sitemap_url, website.url)
    if not all_urls:
        return SitemapImportResponse(
            total_urls=0,
            new_pages=0,
            updated_pages=0,
            errors=["Failed to fetch or parse sitemap"]
        )

    # Filter URLs
    page_urls = filter_page_urls(all_urls, website.url)

    # Import pages
    new_pages = 0
    updated_pages = 0
    skipped_pages = 0
    errors = []

    # Get all existing URLs for this website in one query
    existing_urls = {
        page.url: page
        for page in db.query(Page).filter(Page.website_id == website_id).all()
    }

    # Also check for URLs that exist for other websites
    all_existing_urls = set(
        url for (url,) in db.query(Page.url).filter(Page.url.in_([entry["url"] for entry in page_urls])).all()
    )

    for entry in page_urls:
        url = entry["url"] or ""
        try:
            # Check if this URL already exists for this website
            if url in existing_urls:
                # Already exists for this website, skip
                skipped_pages += 1
                continue

            # Check if URL exists for another website
            if url in all_existing_urls:
                # Reassign to this website
                existing_page = db.query(Page).filter(Page.url == url).first()
                if existing_page:
                    existing_page.website_id = website_id
                    existing_page.section = entry.get("section")
                    existing_page.sitemap_source = entry.get("sitemap_source")
                    existing_urls[url] = existing_page
                    updated_pages += 1
                continue

            # New page - create it
            parsed = urlparse(url)
            path_parts = [p for p in parsed.path.split("/") if p]
            title = path_parts[-1].replace("-", " ").replace("_", " ").title() if path_parts else None

            page = Page(
                website_id=website_id,
                url=url,
                title=title,
                section=entry.get("section"),
                sitemap_source=entry.get("sitemap_source"),
                is_enabled=True,
            )
            db.add(page)
            existing_urls[url] = page  # Track to avoid duplicates in this batch
            new_pages += 1

        except Exception as e:
            errors.append(f"Error importing {url}: {str(e)}")

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        errors.append(f"Database error: {str(e)}")

    # Log the import
    import_log = ImportLog(
        type="sitemap",
        website_id=website_id,
        items_count=len(page_urls),
        success_count=new_pages + updated_pages,
        error_count=len(errors),
        details={"sitemap_url": website.sitemap_url, "errors": errors[:10]},
    )
    db.add(import_log)
    db.commit()

    return SitemapImportResponse(
        total_urls=len(page_urls),
        new_pages=new_pages,
        updated_pages=updated_pages,
        errors=errors[:10],  # Limit errors in response
    )


def clean_url(url: str) -> str:
    """Normalize URL for comparison."""
    url = url.strip().lower()
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    # Remove trailing slash
    if url.endswith("/"):
        url = url[:-1]
    # Remove www prefix for comparison
    url = re.sub(r"^https?://www\.", "https://", url)
    return url
