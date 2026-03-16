"""
Password-only app authentication helpers.
"""
import hashlib
import hmac
import os

from fastapi import Request, Response


AUTH_COOKIE_NAME = "pin_auth"
AUTH_COOKIE_VALUE = "authenticated"
AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10


def get_app_password() -> str:
    """Return the configured app password."""
    return os.getenv("APP_PASSWORD", "").strip()


def is_auth_enabled() -> bool:
    """Return whether password auth is enabled."""
    return bool(get_app_password())


def get_auth_secret() -> str:
    """Return the signing secret for auth cookies."""
    return os.getenv("APP_SESSION_SECRET", "").strip() or get_app_password()


def sign_cookie_value(value: str) -> str:
    """Create a stable signature for the cookie payload."""
    secret = get_auth_secret().encode("utf-8")
    message = value.encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def build_auth_cookie() -> str:
    """Build a signed auth cookie value."""
    return f"{AUTH_COOKIE_VALUE}.{sign_cookie_value(AUTH_COOKIE_VALUE)}"


def verify_password(password: str) -> bool:
    """Compare a provided password against the configured password."""
    configured_password = get_app_password()
    if not configured_password:
        return True
    return hmac.compare_digest(password, configured_password)


def is_request_authenticated(request: Request) -> bool:
    """Return whether the current request is authenticated."""
    if not is_auth_enabled():
        return True

    cookie = request.cookies.get(AUTH_COOKIE_NAME, "")
    if "." not in cookie:
        return False

    value, signature = cookie.split(".", 1)
    if value != AUTH_COOKIE_VALUE:
        return False

    expected_signature = sign_cookie_value(value)
    return hmac.compare_digest(signature, expected_signature)


def set_auth_cookie(response: Response, request: Request) -> None:
    """Attach the long-lived auth cookie to the response."""
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=build_auth_cookie(),
        max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    """Remove the auth cookie from the response."""
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
