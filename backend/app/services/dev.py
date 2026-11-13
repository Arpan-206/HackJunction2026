"""Runtime-tunable development state: glove source, smoothing, LLM provider and simulator motion."""

from app.schemas.api import DevState, DevStatePatch, SmoothingState
from app.services.gloves.manager import GloveManager
from app.services.llm.registry import LLMState


class DevService:
    """Reads and applies the dev state across the pipeline."""

    def __init__(self, gloves: GloveManager, llm: LLMState) -> None:
        """Hold the components the dev state controls."""
        self._gloves = gloves
        self._llm = llm

    def state(self) -> DevState:
        """Return the current dev state."""
        params = self._gloves.smoother.params
        return DevState(
            glove_source=self._gloves.source_name,
            smoothing=SmoothingState(enabled=params.enabled, min_cutoff=params.min_cutoff, beta=params.beta),
            llm_provider=self._llm.name,  # type: ignore[arg-type]
            simulator_motion=self._gloves.simulator_motion,
        )

    async def apply(self, patch: DevStatePatch) -> DevState:
        """Apply the provided fields and return the new state."""
        if patch.simulator_motion is not None:
            self._gloves.set_simulator_motion(patch.simulator_motion)
        if patch.smoothing is not None:
            self._gloves.smoother.configure(**patch.smoothing.model_dump())
        if patch.llm_provider is not None:
            self._llm.select(patch.llm_provider)
        if patch.glove_source is not None and patch.glove_source != self._gloves.source_name:
            await self._gloves.switch_source(patch.glove_source)
        return self.state()
