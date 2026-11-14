"""Health check route."""

from fastapi import APIRouter

from app.api.deps import GlovesDep, LLMDep
from app.schemas.api import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(gloves: GlovesDep, llm: LLMDep) -> HealthResponse:
    """Report that the service is up and which glove source and LLM provider are active."""
    return HealthResponse(glove_source=gloves.source_name, llm_provider=llm.name)
