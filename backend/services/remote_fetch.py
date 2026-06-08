"""Bounded remote HTTP fetching with basic SSRF protection."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import ipaddress
import socket
from typing import Mapping
from urllib.parse import urljoin, urlparse

import httpx


DEFAULT_MAX_REDIRECTS = 5
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_HTML_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_METADATA_BYTES = 64 * 1024


class RemoteFetchError(ValueError):
    """Raised when a remote request is unsafe or exceeds configured limits."""


@dataclass
class RemoteResponse:
    url: str
    status_code: int
    headers: dict[str, str]
    content: bytes

    @property
    def text(self) -> str:
        content_type = self.headers.get("content-type", "")
        encoding = "utf-8"
        if "charset=" in content_type.lower():
            encoding = content_type.lower().split("charset=", 1)[1].split(";", 1)[0].strip()
        try:
            return self.content.decode(encoding, errors="replace")
        except LookupError:
            return self.content.decode("utf-8", errors="replace")


def _validate_scheme_and_host(url: str) -> tuple[str, int]:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise RemoteFetchError("Only HTTP and HTTPS URLs are allowed")
    if not parsed.hostname:
        raise RemoteFetchError("Remote URL must include a hostname")
    if parsed.username or parsed.password:
        raise RemoteFetchError("Credentials in remote URLs are not allowed")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.hostname, port


def _validate_ip(ip_text: str) -> None:
    try:
        address = ipaddress.ip_address(ip_text)
    except ValueError as exc:
        raise RemoteFetchError("Remote hostname resolved to an invalid address") from exc
    if not address.is_global:
        raise RemoteFetchError("Remote URL resolves to a private or reserved address")


async def validate_remote_url(url: str) -> None:
    hostname, port = _validate_scheme_and_host(url)
    try:
        literal_address = ipaddress.ip_address(hostname)
    except ValueError:
        literal_address = None
    if literal_address is not None:
        _validate_ip(str(literal_address))
        return
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise RemoteFetchError(f"Could not resolve remote hostname: {hostname}") from exc
    if not infos:
        raise RemoteFetchError(f"Could not resolve remote hostname: {hostname}")
    for info in infos:
        _validate_ip(info[4][0])


def validate_remote_url_sync(url: str) -> None:
    hostname, port = _validate_scheme_and_host(url)
    try:
        literal_address = ipaddress.ip_address(hostname)
    except ValueError:
        literal_address = None
    if literal_address is not None:
        _validate_ip(str(literal_address))
        return
    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RemoteFetchError(f"Could not resolve remote hostname: {hostname}") from exc
    if not infos:
        raise RemoteFetchError(f"Could not resolve remote hostname: {hostname}")
    for info in infos:
        _validate_ip(info[4][0])


def _validated_content_length(headers: Mapping[str, str], max_bytes: int) -> None:
    raw = headers.get("content-length")
    if not raw:
        return
    try:
        length = int(raw)
    except (TypeError, ValueError):
        return
    if length > max_bytes:
        raise RemoteFetchError(f"Remote response exceeds {max_bytes} bytes")


async def fetch_remote(
    url: str,
    *,
    method: str = "GET",
    headers: Mapping[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = MAX_HTML_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    client: httpx.AsyncClient | None = None,
) -> RemoteResponse:
    current_url = str(url or "").strip()
    own_client = client is None
    remote_client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
    try:
        for _ in range(max_redirects + 1):
            await validate_remote_url(current_url)
            async with remote_client.stream(
                method.upper(),
                current_url,
                headers=dict(headers or {}),
                follow_redirects=False,
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise RemoteFetchError("Remote redirect is missing a location")
                    current_url = urljoin(current_url, location)
                    continue

                response.raise_for_status()
                response_headers = {key.lower(): value for key, value in response.headers.items()}
                if method.upper() == "HEAD":
                    content = b""
                else:
                    _validated_content_length(response_headers, max_bytes)
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise RemoteFetchError(f"Remote response exceeds {max_bytes} bytes")
                        chunks.append(chunk)
                    content = b"".join(chunks)
                return RemoteResponse(
                    url=str(response.url),
                    status_code=response.status_code,
                    headers=response_headers,
                    content=content,
                )
        raise RemoteFetchError("Remote URL exceeded the redirect limit")
    finally:
        if own_client:
            await remote_client.aclose()


def fetch_remote_sync(
    url: str,
    *,
    method: str = "GET",
    headers: Mapping[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = MAX_IMAGE_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
) -> RemoteResponse:
    current_url = str(url or "").strip()
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        for _ in range(max_redirects + 1):
            validate_remote_url_sync(current_url)
            with client.stream(
                method.upper(),
                current_url,
                headers=dict(headers or {}),
                follow_redirects=False,
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise RemoteFetchError("Remote redirect is missing a location")
                    current_url = urljoin(current_url, location)
                    continue

                response.raise_for_status()
                response_headers = {key.lower(): value for key, value in response.headers.items()}
                if method.upper() == "HEAD":
                    content = b""
                else:
                    _validated_content_length(response_headers, max_bytes)
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise RemoteFetchError(f"Remote response exceeds {max_bytes} bytes")
                        chunks.append(chunk)
                    content = b"".join(chunks)
                return RemoteResponse(
                    url=str(response.url),
                    status_code=response.status_code,
                    headers=response_headers,
                    content=content,
                )
    raise RemoteFetchError("Remote URL exceeded the redirect limit")
