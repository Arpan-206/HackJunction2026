"""Client for the Rokoko Studio Command API (HTTP, default port 14053). Needs a Pro or Enterprise plan.

Requests are POSTs to http://{host}:{port}/{version}/{api_key}/{command} with a JSON body. A scene must be open in
Studio. Replies are {description, response_code, startTime, parameters}; response_code 0 means OK.
Not used by any route yet; the intended use is a "calibrate gloves" or "record this lesson" button.
"""

from typing import Any

import httpx

from app import constants as c
from app.core.errors import BadRequestError, ServiceUnavailableError


class StudioCommandClient:
    """Thin async wrapper over the Studio Command API."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = c.ROKOKO_COMMAND_PORT,
        api_key: str = c.ROKOKO_COMMAND_DEFAULT_KEY,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Remember where Studio listens; a transport can be injected for tests."""
        self._base = f"http://{host}:{port}"
        self._key = api_key
        self._transport = transport

    async def send(
        self, command: str, body: dict[str, Any] | None = None, version: str = "v2"
    ) -> dict[str, Any]:
        """POST one command and return the decoded reply, raising when Studio is unreachable or refuses it."""
        url = f"{self._base}/{version}/{self._key}/{command}"
        try:
            async with httpx.AsyncClient(
                timeout=c.ROKOKO_COMMAND_TIMEOUT_S, transport=self._transport
            ) as client:
                response = await client.post(url, json=body or {})
            reply = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailableError(
                f"Rokoko Studio Command API not reachable at {self._base}: {exc}"
            ) from exc
        if (
            reply.get("response_code", c.ROKOKO_COMMAND_OK_CODE)
            != c.ROKOKO_COMMAND_OK_CODE
        ):
            raise BadRequestError(
                f"Studio refused '{command}': {reply.get('description')} (code {reply.get('response_code')})"
            )
        return reply

    async def info(self) -> dict[str, Any]:
        """List live devices in the open scene."""
        return await self.send("info", {"devices_info": True, "clips_info": False})

    async def calibrate(
        self,
        countdown_s: int = 3,
        pose: str = "straight-arms-down",
        device_id: str | None = None,
    ) -> dict[str, Any]:
        """Calibrate the gloves after a countdown; the wearer must hold the pose."""
        if pose not in c.ROKOKO_CALIBRATE_POSES:
            raise BadRequestError(f"pose must be one of {c.ROKOKO_CALIBRATE_POSES}")
        body: dict[str, Any] = {
            "countdown_delay": countdown_s,
            "skip_suit": True,
            "skip_gloves": False,
            "use_custom_pose": True,
            "pose": pose,
        }
        if device_id:
            body["device_id"] = device_id
        return await self.send("calibrate", body, version="v1")

    async def start_recording(self, filename: str = "") -> dict[str, Any]:
        """Start a Studio-side recording (a backup of the lesson)."""
        return await self.send("recording/start", {"filename": filename}, version="v1")

    async def stop_recording(self, back_to_live: bool = True) -> dict[str, Any]:
        """Stop the recording and stay in live view."""
        return await self.send(
            "recording/stop", {"back_to_live": back_to_live}, version="v1"
        )

    async def set_livestream(self, enabled: bool) -> dict[str, Any]:
        """Switch live streaming on or off (the 'livestream' command from Rokoko's examples)."""
        return await self.send("livestream", {"enabled": enabled})
