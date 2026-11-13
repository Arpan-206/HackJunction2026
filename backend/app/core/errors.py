"""Application errors that map directly to HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base error carrying an HTTP status code and a message."""

    status_code = 500

    def __init__(self, detail: str) -> None:
        """Store the human-readable detail."""
        super().__init__(detail)
        self.detail = detail


class NotFoundError(AppError):
    """The requested resource does not exist."""

    status_code = 404


class ConflictError(AppError):
    """The request conflicts with current state."""

    status_code = 409


class BadRequestError(AppError):
    """The request is well-formed but cannot be satisfied."""

    status_code = 400


class ServiceUnavailableError(AppError):
    """An optional dependency or upstream service is unavailable."""

    status_code = 503


class NotImplementedFeatureError(AppError):
    """The feature exists as a stub only."""

    status_code = 501


def register_error_handlers(app: FastAPI) -> None:
    """Install the handler that turns AppError into a JSON response."""

    @app.exception_handler(AppError)
    async def _handle(_: Request, exc: AppError) -> JSONResponse:
        """Render an AppError as {detail}."""
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
