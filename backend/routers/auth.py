"""
Authentication router for the app password gate.
"""
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from services.auth import (
    clear_auth_cookie,
    is_auth_enabled,
    is_request_authenticated,
    set_auth_cookie,
    verify_password,
)

router = APIRouter()


class AuthLoginRequest(BaseModel):
    """Password login payload."""
    password: str


class AuthStatusResponse(BaseModel):
    """Current auth status."""
    authenticated: bool
    enabled: bool


@router.get("/status", response_model=AuthStatusResponse)
def auth_status(request: Request) -> AuthStatusResponse:
    """Return whether auth is enabled and the current request is authenticated."""
    enabled = is_auth_enabled()
    authenticated = is_request_authenticated(request)
    return AuthStatusResponse(
        authenticated=authenticated,
        enabled=enabled,
    )


@router.post("/login", response_model=AuthStatusResponse)
def login(
    payload: AuthLoginRequest,
    request: Request,
    response: Response,
) -> AuthStatusResponse:
    """Authenticate with the configured app password."""
    if not is_auth_enabled():
        return AuthStatusResponse(authenticated=True, enabled=False)

    if not verify_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    set_auth_cookie(response, request)
    return AuthStatusResponse(authenticated=True, enabled=True)


@router.post("/logout", response_model=AuthStatusResponse)
def logout(response: Response) -> AuthStatusResponse:
    """Clear the current auth cookie."""
    clear_auth_cookie(response)
    return AuthStatusResponse(authenticated=False, enabled=is_auth_enabled())
