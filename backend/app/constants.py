"""Shared constants for the Apprentice backend: protocol values, motion maths, scoring and smoothing defaults."""

from pathlib import Path

APP_TITLE = "Apprentice backend"
API_PREFIX = "/api"
WS_GLOVES_PATH = "/ws/gloves"
WS_INGEST_PATH = "/ws/ingest"
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
# A reference whose every finger moves less than this much total flexion (peak to peak) is a held pose: its timing is
# not scored, since aligning two near-constant series says nothing about when the learner moved.
STATIC_REFERENCE_RANGE_DEG = 12.0
STATIC_PRESETS = ("hold_pose", "idle")

# Hint wording thresholds.
HINT_MIN_DEVIATION_DEG = 4.0
HINT_TIMING_MS = 120.0

# Margin of error: the learner's own choice of how strict scoring and corrections are. Each level multiplies the step's
# tolerance bands (angle and timing) and every hint threshold, so the Gaussian score, within_tolerance, the written hint
# and the live corrections all move together. "standard" (1.0) is the behaviour without a margin. The quiet levels also
# say nothing about a finger, the timing or the wrist while it stays inside the widened band, so a slightly wrong swing
# passes with no correction.
MARGINS = ("strict", "standard", "relaxed", "just_trying")
MARGIN_MULTIPLIERS = {"strict": 0.6, "standard": 1.0, "relaxed": 1.5, "just_trying": 2.5}
MARGIN_QUIET = ("relaxed", "just_trying")
DEFAULT_MARGIN = "standard"

# Rokoko Studio Custom Streaming.
ROKOKO_DEFAULT_PORT = 14043
LZ4_FRAME_MAGIC = b"\x04\x22\x4d\x18"
ROKOKO_FLEX_AXIS = 0
ROKOKO_FLEX_SIGN = 1.0
# Joint names, verified against the Studio JSON v3 and v4 specs (research/09_rokoko.md). Finger order matches FINGERS.
ROKOKO_V3_FINGER_NAMES = ("Thumb", "Index", "Middle", "Ring", "Little")
ROKOKO_V3_SEGMENTS = ("Proximal", "Medial", "Distal")
ROKOKO_V4_SEGMENTS = ("Proximal", "Medial", "Distal")
ROKOKO_V4_THUMB_SEGMENTS = ("Metacarpal", "Proximal", "Distal")
ROKOKO_V3_META_GLOVE_KEYS = {"left": "hasLeftGlove", "right": "hasRightGlove"}
ROKOKO_V4_META_HAND_KEYS = {"left": "hasLeftHand", "right": "hasRightHand"}

# Studio Command API (HTTP, Pro and Enterprise plans). Request shape: http://host:port/{version}/{key}/{command}.
ROKOKO_COMMAND_PORT = 14053
ROKOKO_COMMAND_DEFAULT_KEY = "1234"
ROKOKO_COMMAND_TIMEOUT_S = 3.0
ROKOKO_COMMAND_OK_CODE = 0
ROKOKO_CALIBRATE_POSES = ("tpose", "straight-arms-down", "straight-arms-forward")
FLEXION_MIN_RAD = -0.5
FLEXION_MAX_RAD = 2.2

# LLM.
LLM_MAX_RETRIES = 2
LLM_TIMEOUT_S = 90.0
LLM_GEMINI_TIMEOUT_S = 20.0
LLM_GEMINI_HINT_TIMEOUT_S = 4.0
HTTP_SERVICE_UNAVAILABLE = 503
LLM_GEMINI_VIDEO_TIMEOUT_S = 120.0
OLLAMA_NUM_CTX = 16000
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_OLLAMA_MODEL = "gemma4:e4b"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
LLM_TEMPERATURE = 0.4

# Gemini free tier (per project and per model; the day resets at midnight Pacific). The figures are not in the public
# docs, they come from the AI Studio rate-limit screen as reported by third parties (research/06_gemini.md).
# Unknown models get the strictest figures. Budgets are a fraction of the limit so the demo never hits a real 429.
GEMINI_FREE_LIMITS = {
    "gemini-3.8-flash": (5, 20),
    "gemini-3.6-flash": (5, 20),
    "gemini-3.5-flash-lite": (10, 500),
    "gemini-3.1-flash-lite": (10, 500),
}
GEMINI_DEFAULT_LIMITS = (5, 20)
GEMINI_BUDGET_FRACTION = 0.8
GEMINI_HINT_MODEL = "gemini-3.5-flash-lite"
GEMINI_THINKING_LEVEL = "low"
GEMINI_USAGE_FILE = "gemini_usage.json"
GEMINI_MINUTE_WINDOW_S = 60.0
GEMINI_PACIFIC_FALLBACK_OFFSET_H = -8
GEMINI_PACIFIC_TZ = "America/Los_Angeles"
PROVIDER_RATE_LIMITED = "fake (rate limited)"
HTTP_TOO_MANY_REQUESTS = 429

# Live coach hint.
HINT_MAX_WORDS = 14
HINT_WRIST_MIN_DEG = 8.0
HINT_WRIST_TOLERANCE_DEG = 15.0
HINT_CACHE_TTL_S = 60.0
HINT_CACHE_MAX_ENTRIES = 256
HINT_PROMPT_DEG_STEP = 2
HINT_PROMPT_MS_STEP = 20
HINT_SLIGHT_DEG = 8.0
HINT_LOT_DEG = 20.0
HINT_JOINT_SHARE = 0.6
HINT_SEVERITY_MEDIUM = 1.0
HINT_SEVERITY_HIGH = 2.0
HINT_MAX_ATTEMPT = 1000
HINT_TEXT_MAX_CHARS = 200

# Practice plan and text-to-motion.
PLAN_MAX_STEPS = 20
PLAN_MAX_ATTEMPTS = 60
PLAN_MIN_DRILLS = 1
PLAN_MAX_DRILLS = 4
PLAN_SUMMARY_MAX_WORDS = 60
PLAN_TEXT_MAX_CHARS = 200
MOTION_TEXT_MAX_CHARS = 200
MOTION_MIN_BEAT_MS = 150.0
MOTION_MAX_BEAT_MS = 4000.0
MOTION_SLOWER_FACTOR = 2.0
MOTION_SCALE_SEQUENCE = (1, 2, 3, 4, 5)
MOTION_FIST_POSE = (1.0, 1.0, 1.0, 1.0, 1.0)

# Vision.
VISION_MAX_HANDS = 2
VISION_MIN_CONFIDENCE = 0.5

# Calibration-aware scoring.
CALIBRATION_MIN_RANGE_RAD = 0.05

# Video to lesson.
VIDEO_MAX_BYTES = 50 * 1024 * 1024
VIDEO_UPLOAD_CHUNK_BYTES = 1024 * 1024
VIDEO_MIME_TYPES = ("video/mp4", "video/webm", "video/quicktime")
VIDEO_SUFFIXES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
VIDEO_DEFAULT_PROMPT = "Teach the hand skill shown in this video."
VIDEO_PROCESSING_TIMEOUT_S = 60.0
VIDEO_POLL_INTERVAL_S = 1.0
VIDEO_FAKE_NOTE = "The AI Assistant could not watch the video, so this is a generic template based on your text and the file name."
