"""Application factory and lifespan."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import constants as c
from app.api import ws
from app.api.router import api_router
from app.api.routes import ingest
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.services.container import build_services

logging.basicConfig(level=logging.INFO)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app, creating the services in its lifespan."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Create the singleton services, start the glove source, and stop it on shutdown."""
        services = build_services(settings)
        app.state.services = services
        await services.gloves.start()
        await services.rig.start()
        services.core_export.start()
        try:
            yield
        finally:
            services.core_export.stop()
            await services.rig.stop()
            await services.gloves.stop()

    app = FastAPI(title=c.APP_TITLE, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(api_router)
    app.include_router(ws.router)
    app.include_router(ingest.ws_router)
    return app


app = create_app()
