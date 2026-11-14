"""Aggregates every HTTP route module under the /api prefix."""

from fastapi import APIRouter

from app import constants as c
from app.api.routes import (
    calibrations,
    coach,
    dev,
    fingerspelling,
    gloves,
    health,
    ingest,
    lessons,
    motion,
    moves,
    recordings,
    score,
    vision,
)

api_router = APIRouter(prefix=c.API_PREFIX)
for module in (
    health,
    moves,
    fingerspelling,
    lessons,
    calibrations,
    recordings,
    motion,
    score,
    coach,
    vision,
    dev,
    ingest,
    gloves,
):
    api_router.include_router(module.router)
