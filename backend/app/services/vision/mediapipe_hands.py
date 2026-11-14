"""Webcam hand detection with MediaPipe. The vision extra is imported lazily."""

from typing import Any

from app import constants as c
from app.core.errors import BadRequestError, ServiceUnavailableError
from app.schemas.api import VisionHand, VisionResponse

INSTALL_HINT = "MediaPipe is not installed. Run: uv sync --extra vision"


class MediaPipeHands:
    """Detects hands in a JPEG and returns normalised landmarks."""

    def __init__(self) -> None:
        """Defer model creation until the first request."""
        self._hands: Any = None
        self._cv2: Any = None

    def _load(self) -> None:
        """Import the optional dependencies and build the detector."""
        if self._hands is not None:
            return
        try:
            import cv2
            import mediapipe as mp
        except ImportError as exc:
            raise ServiceUnavailableError(INSTALL_HINT) from exc
        solutions = getattr(mp, "solutions", None)
        if solutions is None:
            raise ServiceUnavailableError(
                "This MediaPipe build has no legacy solutions API; install mediapipe<0.10.20"
            )
        self._cv2 = cv2
        self._hands = solutions.hands.Hands(
            static_image_mode=True,
            max_num_hands=c.VISION_MAX_HANDS,
            min_detection_confidence=c.VISION_MIN_CONFIDENCE,
        )

    def detect(self, jpeg: bytes) -> VisionResponse:
        """Return the hands found in a JPEG image. wrist_pos is the wrist landmark in normalised image coordinates."""
        self._load()
        import numpy as np

        image = self._cv2.imdecode(
            np.frombuffer(jpeg, dtype=np.uint8), self._cv2.IMREAD_COLOR
        )
        if image is None:
            raise BadRequestError("could not decode image")
        result = self._hands.process(self._cv2.cvtColor(image, self._cv2.COLOR_BGR2RGB))
        hands: list[VisionHand] = []
        for landmarks, handedness in zip(
            result.multi_hand_landmarks or [],
            result.multi_handedness or [],
            strict=False,
        ):
            points = [(lm.x, lm.y, lm.z) for lm in landmarks.landmark]
            label = handedness.classification[0].label.lower()
            hands.append(
                VisionHand(
                    side="left" if label == "left" else "right",
                    wrist_pos=points[0],
                    landmarks=points,
                )
            )
        return VisionResponse(hands=hands)
