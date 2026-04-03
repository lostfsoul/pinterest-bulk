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

GENERIC_SITEMAP_SECTIONS = {
    "post",
    "posts",
    "page",
    "pages",
    "attachment",
    "attachments",
    "author",
    "authors",
    "tag",
    "tags",
    "category",
    "categories",
    "product",
    "products",
    "sitemap",
    "wp",
    "wordpress",
}

SITEMAP_BUCKET_ALIASES = {
    "post": "post",
    "posts": "post",
    "page": "page",
    "pages": "page",
    "category": "category",
    "categories": "category",
    "tag": "tag",
    "tags": "tag",
    "product": "product",
    "products": "product",
    "author": "author",
    "authors": "author",
    "attachment": "attachment",
    "attachments": "attachment",
    "story": "web-story",
    "stories": "web-story",
    "web-story": "web-story",
    "web-stories": "web-story",
    "video": "video",
    "videos": "video",
}

SITEMAP_BUCKET_PRIORITY = {
    # Taxonomy/utility buckets should not be overwritten by post buckets
    # when the same URL appears in multiple sitemap files.
    "category": 90,
    "tag": 85,
    "author": 80,
    "attachment": 75,
    # Primary content buckets
    "post": 70,
    "product": 65,
    "web-story": 60,
    "video": 55,
    "page": 50,
    "other": 10,
    "unknown": 0,
}

UTILITY_URL_PATTERNS = [
    r"/about(?:-|_)?(?:us)?/?$",
    r"/contact(?:-|_)?(?:us)?/?$",
    r"/privacy(?:-|_)?policy/?$",
    r"/terms(?:-|_)?(?:and|&)?(?:-|_)?conditions?/?$",
    r"/cookie(?:-|_)?policy/?$",
    r"/disclaimer/?$",
    r"/affiliate(?:-|_)?disclosure/?$",
    r"/refund(?:-|_)?policy/?$",
    r"/shipping(?:-|_)?policy/?$",
    r"/login/?$",
    r"/register/?$",
    r"/my-account/?$",
    r"/cart/?$",
    r"/checkout/?$",
    r"/search/?$",
    r"/feed/?$",
    r"/author/[^/]+/?$",
]


def _normalize_url_for_lookup(url: str | None) -> str:
    if not url:
        return ""
    parsed = urlparse(url.strip())
    if not parsed.scheme:
        return ""
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme.lower()}://{netloc}{path}".lower()


def build_sitemap_fetch_candidates(sitemap_url: str) -> list[str]:
    """Return sitemap URL candidates across host/path variants."""
    parsed = urlparse((sitemap_url or "").strip())
    if not parsed.scheme or not parsed.netloc:
        return []

    hosts = [parsed.netloc]
    if parsed.netloc.startswith("www."):
        hosts.append(parsed.netloc[4:])
    else:
        hosts.append(f"www.{parsed.netloc}")

    original_path = parsed.path or "/sitemap_index.xml"
    path_variants = [original_path]
    if original_path.endswith("/sitemap_index.xml"):
        path_variants.append("/sitemap.xml")
    elif original_path.endswith("/sitemap.xml"):
        path_variants.append("/sitemap_index.xml")
    else:
        path_variants.extend(["/sitemap_index.xml", "/sitemap.xml"])

    candidates: list[str] = []
    seen: set[str] = set()
    for host in hosts:
        for path in path_variants:
            candidate = f"{parsed.scheme}://{host}{path}"
            if candidate in seen:
                continue
            seen.add(candidate)
            candidates.append(candidate)
    return candidates


def _extract_links_from_html(html: str, base_url: str) -> set[str]:
    """Extract absolute links from page HTML."""
    links: set[str] = set()
    for match in re.finditer(r'href=["\']([^"\']+)["\']', html, flags=re.IGNORECASE):
        href = (match.group(1) or "").strip()
        if not href:
            continue
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            parsed = urlparse(base_url)
            href = f"{parsed.scheme}://{parsed.netloc}{href}"
        elif not href.startswith(("http://", "https://")):
            href = urljoin(base_url, href)
        links.add(href)
    return links


async def fetch_sitemap(sitemap_url: str) -> str | None:
    """Fetch sitemap XML content."""
    candidates = build_sitemap_fetch_candidates(sitemap_url) or [sitemap_url]
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for candidate in candidates:
                try:
                    response = await client.get(candidate)
                    response.raise_for_status()
                    return response.text
                except Exception as candidate_error:
                    print(f"Error fetching sitemap candidate {candidate}: {candidate_error}")
    except Exception as e:
        print(f"Error fetching sitemap: {e}")
    return None


def derive_section_from_sitemap_url(sitemap_url: str) -> str | None:
    """Infer a useful section/category name from a sitemap filename."""
    filename = urlparse(sitemap_url).path.rsplit("/", 1)[-1].lower()
    if not filename:
        return None

    filename = re.sub(r"\.xml(?:\.gz)?$", "", filename).replace("_", "-")
    filename = re.sub(r"-?sitemap\d*$", "", filename)
    filename = re.sub(r"-{2,}", "-", filename).strip("-")
    if not filename:
        return None

    parts = [part for part in filename.split("-") if part]
    noisy_tokens = {"index", "main"}
    if "category" in parts:
        idx = parts.index("category")
        tail = [p for p in parts[idx + 1:] if p not in noisy_tokens]
        if tail:
            return " ".join(tail)

    if "tag" in parts:
        idx = parts.index("tag")
        tail = [p for p in parts[idx + 1:] if p not in noisy_tokens]
        if tail:
            return " ".join(tail)

    parts = [part for part in parts if part not in noisy_tokens]
    if not parts:
        return None

    return " ".join(parts)


def derive_sitemap_bucket_from_source(sitemap_url: str | None) -> str:
    """Infer canonical sitemap bucket from sitemap source URL."""
    if not sitemap_url:
        return "unknown"

    filename = urlparse(sitemap_url).path.rsplit("/", 1)[-1].lower()
    filename = re.sub(r"\.xml(?:\.gz)?$", "", filename).replace("_", "-")
    if not filename:
        return "unknown"

    # Typical Yoast/RankMath style: post-sitemap1, page-sitemap, category-sitemap
    normalized = re.sub(r"-?sitemap\d*$", "", filename)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    if normalized:
        direct = SITEMAP_BUCKET_ALIASES.get(normalized)
        if direct:
            return direct

    tokens = [token for token in filename.split("-") if token]
    if not tokens:
        return "unknown"

    # WordPress core style: wp-sitemap-posts-post-1
    if len(tokens) >= 4 and tokens[0] == "wp" and tokens[1] == "sitemap":
        for token in tokens[2:]:
            mapped = SITEMAP_BUCKET_ALIASES.get(token)
            if mapped:
                return mapped

    # Generic: pick first recognized token from filename.
    for token in tokens:
        mapped = SITEMAP_BUCKET_ALIASES.get(token)
        if mapped:
            return mapped

    # Keep bucket space tight for generation UX.
    return "other"


def is_generation_eligible_default(sitemap_bucket: str, is_utility_page: bool) -> bool:
    """Conservative default eligibility for generation after sitemap import."""
    if is_utility_page:
        return False
    return sitemap_bucket == "post"


def derive_section_from_page_url(page_url: str) -> str | None:
    """Infer category-like section from a content URL, tuned for WordPress permalinks."""
    path_parts = [part for part in urlparse(page_url).path.split("/") if part]
    if not path_parts:
        return None

    lowered_parts = [part.lower() for part in path_parts]
    if "category" in lowered_parts:
        idx = lowered_parts.index("category")
        if idx + 1 < len(path_parts):
            return path_parts[idx + 1].replace("-", " ").replace("_", " ").lower()

    filtered: list[str] = []
    for part in lowered_parts:
        if re.fullmatch(r"\d{4}", part):
            continue
        if re.fullmatch(r"\d{1,2}", part):
            continue
        if part == "amp":
            continue
        filtered.append(part)

    # Single non-date slug is usually the post permalink itself; avoid using it as category.
    if len(filtered) <= 1:
        return None

    return filtered[0].replace("-", " ").replace("_", " ")


def is_utility_page_url(page_url: str, sitemap_bucket: str) -> bool:
    """Detect utility pages that should be imported but disabled by default."""
    path = urlparse(page_url).path.lower()
    if sitemap_bucket in {"category", "tag", "author", "attachment"}:
        return True
    return any(re.search(pattern, path) for pattern in UTILITY_URL_PATTERNS)


def resolve_page_section(page_url: str, sitemap_source: str | None) -> str:
    """Choose a stable page section from sitemap metadata and URL structure."""
    sitemap_section = derive_section_from_sitemap_url(sitemap_source or "")
    if sitemap_section and sitemap_section not in GENERIC_SITEMAP_SECTIONS:
        return sitemap_section

    url_section = derive_section_from_page_url(page_url)
    if url_section:
        return url_section

    if sitemap_section:
        return sitemap_section

    return "uncategorized"


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


async def enrich_post_sections_from_wordpress_api(website: Website, db: Session) -> tuple[int, str | None]:
    """Best-effort enrichment of post sections using WordPress categories via wp-json.

    Returns: (updated_pages_count, error_message)
    """
    website_url = website.url or ""
    parsed = urlparse(website_url)
    if not parsed.scheme or not parsed.netloc:
        return 0, "invalid website url"

    base = f"{parsed.scheme}://{parsed.netloc}"
    categories_endpoint = f"{base}/wp-json/wp/v2/categories"
    posts_endpoint = f"{base}/wp-json/wp/v2/posts"

    posts = db.query(Page).filter(
        Page.website_id == website.id,
        Page.sitemap_bucket == "post",
    ).all()
    if not posts:
        return 0, None

    posts_by_url = {_normalize_url_for_lookup(page.url): page for page in posts}
    category_pages_count = db.query(Page).filter(
        Page.website_id == website.id,
        Page.sitemap_bucket == "category",
    ).count()
    if category_pages_count == 0:
        return 0, None

    category_slug_by_id: dict[int, str] = {}

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        try:
            page_number = 1
            while True:
                response = await client.get(
                    categories_endpoint,
                    params={
                        "per_page": 100,
                        "page": page_number,
                        "_fields": "id,slug,name",
                    },
                )
                response.raise_for_status()
                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break
                for item in batch:
                    cat_id = item.get("id")
                    slug = (item.get("slug") or "").strip().lower()
                    if isinstance(cat_id, int) and slug:
                        category_slug_by_id[cat_id] = slug
                total_pages = int(response.headers.get("X-WP-TotalPages", "1") or 1)
                if page_number >= total_pages:
                    break
                page_number += 1
        except Exception as exc:
            return 0, f"wp categories fetch failed: {exc}"

        if not category_slug_by_id:
            return 0, "no wp categories returned"

        updated = 0
        try:
            page_number = 1
            while True:
                response = await client.get(
                    posts_endpoint,
                    params={
                        "per_page": 100,
                        "page": page_number,
                        "_fields": "link,categories",
                    },
                )
                response.raise_for_status()
                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break

                for item in batch:
                    link = item.get("link")
                    categories = item.get("categories")
                    if not isinstance(link, str) or not isinstance(categories, list) or not categories:
                        continue
                    page = posts_by_url.get(_normalize_url_for_lookup(link))
                    if not page:
                        continue

                    primary_slug = None
                    for cat_id in categories:
                        if isinstance(cat_id, int) and cat_id in category_slug_by_id:
                            primary_slug = category_slug_by_id[cat_id]
                            break
                    if not primary_slug:
                        continue

                    next_section = primary_slug.replace("-", " ").replace("_", " ").strip().lower() or "post"
                    if page.section != next_section:
                        page.section = next_section
                        updated += 1

                total_pages = int(response.headers.get("X-WP-TotalPages", "1") or 1)
                if page_number >= total_pages:
                    break
                page_number += 1
        except Exception as exc:
            return updated, f"wp posts fetch failed: {exc}"

    return updated, None


async def enrich_post_sections_from_category_pages(website: Website, db: Session) -> tuple[int, str | None]:
    """Fallback enrichment when wp-json is blocked.

    For each category page URL imported from category sitemap, fetch page HTML,
    collect internal links, and map matching post URLs to that category slug.
    """
    website_url = website.url or ""
    parsed_site = urlparse(website_url)
    if not parsed_site.scheme or not parsed_site.netloc:
        return 0, "invalid website url"
    site_host = parsed_site.netloc.lower().lstrip("www.")

    post_pages = db.query(Page).filter(
        Page.website_id == website.id,
        Page.sitemap_bucket == "post",
    ).all()
    if not post_pages:
        return 0, None
    post_by_url = {_normalize_url_for_lookup(page.url): page for page in post_pages}

    category_pages = db.query(Page).filter(
        Page.website_id == website.id,
        Page.sitemap_bucket == "category",
    ).all()
    if not category_pages:
        return 0, "no category sitemap pages"

    updated = 0
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for category_page in category_pages:
            category_url = (category_page.url or "").strip()
            if not category_url:
                continue
            category_slug = urlparse(category_url).path.strip("/").split("/")[-1].lower()
            if not category_slug:
                continue
            category_label = category_slug.replace("-", " ").replace("_", " ").strip()
            if not category_label:
                continue

            try:
                response = await client.get(category_url)
                response.raise_for_status()
            except Exception:
                continue

            links = _extract_links_from_html(response.text, category_url)
            for link in links:
                parsed = urlparse(link)
                host = parsed.netloc.lower().lstrip("www.")
                if host and host != site_host:
                    continue
                normalized = _normalize_url_for_lookup(link)
                page = post_by_url.get(normalized)
                if not page:
                    continue
                if page.section != category_label:
                    page.section = category_label
                    updated += 1

    if updated == 0:
        return 0, "no post links matched from category pages"
    return updated, None


async def fetch_sitemap_groups(sitemap_url: str) -> list[dict[str, str]]:
    """Return sitemap group entries from a sitemap index URL."""
    import xml.etree.ElementTree as ET

    for candidate in build_sitemap_fetch_candidates(sitemap_url) or [sitemap_url]:
        xml_content = await fetch_sitemap(candidate)
        if not xml_content:
            continue

        groups: list[dict[str, str]] = []
        try:
            root = ET.fromstring(xml_content)
            sitemap_elements = (
                root.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}sitemap") +
                root.findall(".//sitemap")
            )
            for sitemap_elem in sitemap_elements:
                loc_elem = sitemap_elem.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
                if loc_elem is None:
                    loc_elem = sitemap_elem.find("loc")
                if loc_elem is None or not loc_elem.text:
                    continue

                group_url = loc_elem.text.strip()
                bucket = derive_sitemap_bucket_from_source(group_url)
                groups.append(
                    {
                        "sitemap_url": group_url,
                        "label": urlparse(group_url).path.rsplit("/", 1)[-1] or group_url,
                        "bucket": bucket,
                        "is_default": "true" if bucket == "post" else "false",
                    }
                )
        except Exception:
            continue

        if groups:
            return groups

    return []


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


def dedupe_url_entries(url_entries: list[dict[str, str | None]]) -> list[dict[str, str | None]]:
    """De-duplicate sitemap entries by URL and keep the best sitemap source.

    Some websites emit the same URL in multiple sitemaps. We keep one record per URL
    and choose the entry with the highest sitemap-bucket priority so taxonomy URLs are
    not mislabeled as post URLs.
    """
    best_by_url: dict[str, dict[str, str | None]] = {}
    for entry in url_entries:
        url = (entry.get("url") or "").strip()
        if not url:
            continue

        current = best_by_url.get(url)
        if current is None:
            best_by_url[url] = entry
            continue

        current_bucket = derive_sitemap_bucket_from_source(current.get("sitemap_source"))
        next_bucket = derive_sitemap_bucket_from_source(entry.get("sitemap_source"))
        current_priority = SITEMAP_BUCKET_PRIORITY.get(current_bucket, 0)
        next_priority = SITEMAP_BUCKET_PRIORITY.get(next_bucket, 0)

        # If same priority, prefer the candidate with a concrete sitemap source.
        if next_priority > current_priority:
            best_by_url[url] = entry
        elif next_priority == current_priority:
            current_source = (current.get("sitemap_source") or "").strip()
            next_source = (entry.get("sitemap_source") or "").strip()
            if not current_source and next_source:
                best_by_url[url] = entry

    return list(best_by_url.values())


async def import_sitemap(
    website_id: int,
    db: Session,
    selected_sitemaps: list[str] | None = None,
) -> SitemapImportResponse:
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

    selected_sources = [item.strip() for item in (selected_sitemaps or []) if item and item.strip()]
    # Fetch and parse sitemap(s)
    if selected_sources:
        all_urls: list[dict[str, str | None]] = []
        for source in selected_sources:
            all_urls.extend(await fetch_and_parse_sitemap(source, website.url))
        sitemap_used = ",".join(selected_sources)
    else:
        all_urls = await fetch_and_parse_sitemap(website.sitemap_url, website.url)
        sitemap_used = website.sitemap_url

    # Fallback for WordPress sites where sitemap index path differs.
    if not all_urls and website.sitemap_url and not selected_sources:
        for fallback in build_sitemap_fetch_candidates(website.sitemap_url):
            fallback_urls = await fetch_and_parse_sitemap(fallback, website.url)
            if fallback_urls:
                all_urls = fallback_urls
                sitemap_used = fallback
                break

    if not all_urls:
        return SitemapImportResponse(
            total_urls=0,
            new_pages=0,
            updated_pages=0,
            errors=["Failed to fetch or parse sitemap"]
        )

    # Filter URLs
    page_urls = filter_page_urls(all_urls, website.url)
    page_urls = dedupe_url_entries(page_urls)

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
            sitemap_source = entry.get("sitemap_source")
            sitemap_bucket = derive_sitemap_bucket_from_source(sitemap_source)
            next_section = resolve_page_section(url, sitemap_source)
            is_utility_page = is_utility_page_url(url, sitemap_bucket)
            should_enable = is_generation_eligible_default(sitemap_bucket, is_utility_page)

            # Check if this URL already exists for this website
            if url in existing_urls:
                existing_page = existing_urls[url]
                next_source = sitemap_source
                if (
                    existing_page.section != next_section
                    or existing_page.sitemap_source != next_source
                    or existing_page.sitemap_bucket != sitemap_bucket
                    or existing_page.is_utility_page != is_utility_page
                    or existing_page.is_enabled != should_enable
                ):
                    existing_page.section = next_section
                    existing_page.sitemap_source = next_source
                    existing_page.sitemap_bucket = sitemap_bucket
                    existing_page.is_utility_page = is_utility_page
                    existing_page.is_enabled = should_enable
                    updated_pages += 1
                else:
                    skipped_pages += 1
                continue

            # Check if URL exists for another website
            if url in all_existing_urls:
                # Reassign to this website
                existing_page = db.query(Page).filter(Page.url == url).first()
                if existing_page:
                    existing_page.website_id = website_id
                    existing_page.section = next_section
                    existing_page.sitemap_source = sitemap_source
                    existing_page.sitemap_bucket = sitemap_bucket
                    existing_page.is_utility_page = is_utility_page
                    existing_page.is_enabled = should_enable
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
                section=next_section,
                sitemap_source=sitemap_source,
                sitemap_bucket=sitemap_bucket,
                is_utility_page=is_utility_page,
                is_enabled=should_enable,
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

    wp_updated = 0
    wp_error = None
    try:
        wp_updated, wp_error = await enrich_post_sections_from_wordpress_api(website, db)
        if wp_updated:
            db.commit()
    except Exception as exc:
        db.rollback()
        wp_error = str(exc)
    if wp_error:
        fallback_updated, fallback_error = await enrich_post_sections_from_category_pages(website, db)
        if fallback_updated:
            db.commit()
            wp_updated = wp_updated + fallback_updated
        else:
            errors.append(f"WordPress category enrichment: {wp_error}")
            if fallback_error:
                errors.append(f"Category-page fallback: {fallback_error}")

    # Log the import
    import_log = ImportLog(
        type="sitemap",
        website_id=website_id,
        items_count=len(page_urls),
        success_count=new_pages + updated_pages,
        error_count=len(errors),
        details={"sitemap_url": sitemap_used, "errors": errors[:10]},
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
