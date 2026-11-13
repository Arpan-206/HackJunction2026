"""Shared constants for the Apprentice backend: protocol values, motion maths, scoring and smoothing defaults."""

from pathlib import Path

APP_TITLE = "Apprentice backend"
API_PREFIX = "/api"
WS_GLOVES_PATH = "/ws/gloves"
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
BACKEND_ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = Path(__file__).resolve().parent / "data" / "seed"
MOVES_FILE = Path(__file__).resolve().parent / "data" / "moves.json"
DEFAULT_DATA_DIR = BACKEND_ROOT / "data"

FINGERS = ("thumb", "index", "middle", "ring", "little")
SIDES = ("left", "right")
JOINTS_PER_FINGER = 3
ID_LENGTH = 12
SAFE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"

STREAM_HZ = 60.0
SUBSCRIBER_QUEUE_SIZE = 8
MAX_PREVIEW_DURATION_S = 30.0
MAX_RECORDING_FRAMES = 60 * 60 * 5
CALIBRATION_DEFAULT_DURATION_S = 1.5
CALIBRATION_MAX_DURATION_S = 10.0
FRAME_DECIMALS = 4

DEFAULT_TOLERANCE_ANGLE_DEG = 18.0
DEFAULT_TOLERANCE_TIMING_MS = 250.0
DEFAULT_REPETITIONS = 3
DEFAULT_MASTER_NAME = "Master"

SEQUENCE_DEFAULT_BEAT_MS = 620.0
SWING_DEFAULT_BEAT_MS = 1500.0
PINCH_DEFAULT_BEAT_MS = 800.0

# Flexion (radians) at curl 0 and the extra flexion at curl 1, per finger and joint. Ported from the prototype renderer.
RELAXED_FLEXION = (
    (0.10, 0.18, 0.15),
    (0.28, 0.38, 0.24),
    (0.28, 0.38, 0.24),
    (0.28, 0.38, 0.24),
    (0.30, 0.40, 0.26),
)
FULL_FLEXION = (
    (0.75, 0.75, 0.55),
    (1.15, 1.30, 0.85),
    (1.15, 1.30, 0.85),
    (1.15, 1.30, 0.85),
    (1.15, 1.30, 0.85),
)
THUMB_FLEXION_SCALE = 0.8
CURL_MIN = -0.2
CURL_MAX = 1.0
BREATHE_AMPLITUDE = 0.02
BREATHE_RATE = 1.3
IDLE_CURL = 0.05

SEQ_PRESS_WINDOW = 0.42
SEQ_LIFT_START = 0.75
SEQ_LIFT_AMOUNT = 0.12
SEQ_PRESS_CURL = 0.36
SEQ_NEIGHBOUR_CURL = 0.05

SWING_BACKSWING_END = 0.55
SWING_CONTACT_END = 0.68
SWING_BACKSWING_YAW = 0.55
SWING_CONTACT_SWEEP = 1.25
SWING_FOLLOW_YAW = -0.7
SWING_SQUEEZE = 0.06
SWING_ROLL_FACTOR = 0.35
SWING_PITCH = -0.25
GRIP_CURLS = {
    "shakehand": (0.62, 0.80, 0.84, 0.86, 0.88),
    "penhold": (0.55, 0.35, 0.85, 0.88, 0.90),
}

PINCH_THUMB_CURL = 0.45
PINCH_FINGER_CURL = 0.5

# One Euro filter defaults (Casiez et al. 2012), tuned for radians at about 60 Hz.
SMOOTHING_ENABLED = True
SMOOTHING_MIN_CUTOFF = 1.5
SMOOTHING_BETA = 0.4
SMOOTHING_D_CUTOFF = 1.0
SMOOTHING_DEADBAND_RAD = 0.004
SMOOTHING_FALLBACK_DT = 1.0 / STREAM_HZ

# Scoring.
SCORE_FPS = 30.0
DTW_WINDOW_FRACTION = 0.25
DTW_MIN_WINDOW = 5
MAX_FLEXION_RAD = 2.2
SCORE_SIGMA_FACTOR = 1.5
FINGER_WEIGHT = 0.8
TIMING_WEIGHT = 0.2
MIN_SCORE_FRAMES = 2

# Hint wording thresholds.
HINT_MIN_DEVIATION_DEG = 4.0
HINT_TIMING_MS = 120.0

# Rokoko Studio Custom Streaming.
ROKOKO_DEFAULT_PORT = 14043
LZ4_FRAME_MAGIC = b"\x04\x22\x4d\x18"
ROKOKO_FLEX_AXIS = 0
ROKOKO_FLEX_SIGN = 1.0
FLEXION_MIN_RAD = -0.5
FLEXION_MAX_RAD = 2.2

# LLM.
LLM_MAX_RETRIES = 2
LLM_TIMEOUT_S = 90.0
OLLAMA_NUM_CTX = 16000
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_OLLAMA_MODEL = "gemma4:e4b"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
LLM_TEMPERATURE = 0.4

# Vision.
VISION_MAX_HANDS = 2
VISION_MIN_CONFIDENCE = 0.5
