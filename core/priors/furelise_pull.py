"""Pull FurElise hand joints and key presses without the 47 GB download.

FurElise (Wang et al., SIGGRAPH Asia 2024, CC BY-NC 4.0) ships one
``dataset.zip``. Each piece has ``motion.pkl`` (a pickled dict whose first
entry is ``left.joints``, an N x 21 x 3 float32 array, followed by the
much larger MANO vertices) and ``vis/pressed_keys.pkl`` (one N x 88
float32 array, one column per piano key).

This module reads the zip over HTTP range requests, decompresses only the
head of ``motion.pkl`` until the left-hand joint array is complete, and
stops. The pickles are never unpickled (a pickle can run code): the raw
array bytes are read with ``pickletools`` and ``numpy.frombuffer``.
Nothing raw is written to disk: the caller converts the joints to our 18
angle features at once (core/priors/piano.py).

The right hand's joints sit after about 60 MB of left-hand vertices per
piece, so they are not pulled on the Mac. Our 18 features are angles
between bones, so they do not depend on the side; the left hand stands in
for both.
"""

from __future__ import annotations

import io
import pickletools
from dataclasses import dataclass

import numpy as np

from .remote_zip import open_remote_zip

DATASET_URL = "https://huggingface.co/datasets/rcwang/for_elise/resolve/main/dataset.zip"
FPS = 59.94
N_KEYS = 88


@dataclass
class PieceJoints:
    piece_id: str
    joints_left: np.ndarray  # (N, 21, 3) float32, metres, world frame
    pressed: np.ndarray  # (N, 88) float32, nonzero while a key is down
    bytes_read: int


def first_array(buf: bytes, inner: tuple[int, ...]) -> np.ndarray | None:
    """The first float32 ndarray payload in a pickle prefix, or None if cut.

    ``inner`` is the trailing shape, for example (21, 3); the payload size
    must be a multiple of it.
    """
    per = int(np.prod(inner)) * 4
    try:
        for op, arg, _pos in pickletools.genops(io.BytesIO(buf)):
            if op.name in ("BINBYTES", "BINBYTES8") and isinstance(arg, (bytes, bytearray)):
                if len(arg) >= per and len(arg) % per == 0:
                    return np.frombuffer(bytes(arg), dtype="<f4").reshape((-1, *inner)).copy()
    except ValueError:
        return None
    return None


def _read_until_array(stream, inner: tuple[int, ...], step: int = 1 << 20) -> tuple[np.ndarray, int]:
    buf = bytearray()
    while True:
        chunk = stream.read(step)
        if not chunk:
            raise ValueError("stream ended before the first array was whole")
        buf += chunk
        arr = first_array(bytes(buf), inner)
        if arr is not None:
            return arr, len(buf)


def pull_piece(zf, piece_id: str) -> PieceJoints:
    with zf.open(f"dataset/{piece_id}/motion.pkl") as f:
        joints, nbytes = _read_until_array(f, (21, 3))
    with zf.open(f"dataset/{piece_id}/vis/pressed_keys.pkl") as f:
        pressed = first_array(f.read(), (N_KEYS,))
    if pressed is None:
        raise ValueError(f"piece {piece_id}: no pressed keys array")
    return PieceJoints(piece_id, joints, pressed, nbytes)


def piece_ids(zf) -> list[str]:
    return sorted({n.split("/")[1] for n in zf.namelist() if n.endswith("/motion.pkl")})


def open_dataset():
    return open_remote_zip(DATASET_URL)
