"""Aggregates every HTTP route module under the /api prefix."""

from fastapi import APIRouter

from app import constants as c
from app.api.routes import calibrations, coach, dev, health, lessons, motion, moves, ingest, recordings, score, vision

api_router = APIRouter(prefix=c.API_PREFIX)
for module in (health, moves, lessons, calibrations, recordings, motion, score, coach, vision, dev, ingest):
    api_router.include_router(module.router)
