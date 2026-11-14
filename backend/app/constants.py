"""Shared constants for the Geppetto backend: protocol values, motion maths, scoring and smoothing defaults."""

import sys
from pathlib import Path

APP_TITLE = "Geppetto backend"
API_PREFIX = "/api"
WS_GLOVES_PATH = "/ws/gloves"
WS_INGEST_PATH = "/ws/ingest"
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
BACKEND_ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = Path(__file__).resolve().parent / "data" / "seed"
# Every shipped seed lesson id starts with this; a stored one that no longer ships is removed at start-up.
SEED_LESSON_PREFIX = "seed-"
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
# Keyframes: share of each key's slot spent easing in from the previous key; the rest holds the key.
KEYFRAME_BLEND = 0.5

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
# Per-finger step weights (STATUS-weights.md, the core's [score] focus_min_weight and [record] weights). The worst
# finger and the hint only ever name a finger weighted at least FOCUS_MIN_WEIGHT; with none that heavy, the heaviest
# non-zero fingers stand in. Take consistency: a finger whose total flexion varies across the expert's takes by a
# standard deviation of TAKE_CONSISTENT_DEG or less keeps weight 1, TAKE_INCONSISTENT_DEG or more drops to
# TAKE_INCONSISTENT_FLOOR. Total flexion is three joints summed, so these are three times the core's per-joint numbers.
FOCUS_MIN_WEIGHT = 0.3
TAKE_CONSISTENT_DEG = 12.0
TAKE_INCONSISTENT_DEG = 45.0
TAKE_INCONSISTENT_FLOOR = 0.2
# A reference whose every finger moves less than this much total flexion (peak to peak) is a held pose: its timing is
# not scored, since aligning two near-constant series says nothing about when the learner moved.
STATIC_REFERENCE_RANGE_DEG = 12.0
STATIC_PRESETS = ("hold_pose", "idle")

# Expert takes into a model (POST /recordings/model, services/takes.py): "best take + spread". The medoid take (smallest
# total per-finger DTW distance to the others) becomes the reference, and each finger's tolerance is its robust spread
# around the medoid (the TAKES_SPREAD_PERCENTILE of that finger's DTW error over the other takes) times
# TAKES_TOLERANCE_SCALE, clamped to [FLOOR, CEIL]. Scale 2.5 puts a typical take-to-take wobble of about 7 degrees of total
# flexion at the 18 degree default; the floor keeps a rock-steady finger humane for a learner with a different hand, the
# ceiling (twice the default) stops a sloppy finger from being ignored. 2 takes are accepted with a warning; 3 to 5 is
# the recommended range, so one stray take cannot pick the reference.
TAKES_HARD_MIN = 2
TAKES_MIN = 3
TAKES_MAX = 5
TAKES_SPREAD_PERCENTILE = 75.0
TAKES_TOLERANCE_SCALE = 2.5
TAKES_TOLERANCE_FLOOR_DEG = 10.0
TAKES_TOLERANCE_CEIL_DEG = 36.0
# A take is an outlier when its mean per-finger distance to the medoid exceeds TAKES_OUTLIER_FACTOR times the median
# distance between the other takes (pairs not involving it) and is at least TAKES_OUTLIER_MIN_DEG, so a set of very
# consistent takes never flags a take that is only a few degrees off. Needs 3 or more takes (with 2 nobody can tell
# which one strayed).
TAKES_OUTLIER_FACTOR = 2.0
TAKES_OUTLIER_MIN_DEG = 12.0

# Hint wording thresholds.
HINT_MIN_DEVIATION_DEG = 4.0
HINT_TIMING_MS = 120.0

# Margin of error: the learner's own choice of how strict scoring and corrections are. Each level multiplies the step's
# tolerance bands (angle and timing) and every hint threshold, so the Gaussian score, within_tolerance, the written hint
# and the live corrections all move together. "standard" (1.0) is the behaviour without a margin. The quiet levels also
# say nothing about a finger, the timing or the wrist while it stays inside the widened band, so a slightly wrong swing
# passes with no correction.
MARGINS = ("strict", "standard", "relaxed", "just_trying")
MARGIN_MULTIPLIERS = {
    "strict": 0.6,
    "standard": 1.0,
    "relaxed": 1.5,
    "just_trying": 2.5,
}
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
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_OPENAI_MODEL = "google/gemma-4-31B-it"  # an OpenAI-compatible endpoint, e.g. Gemma on Verda (verda/)
# The tuned coach (coach_tune/, COACH_MODEL=tuned): Gemma 4 E2B with our LoRA merged, served by vLLM on Verda.
DEFAULT_TUNED_MODEL = "geppetto-coach-e2b"
TUNED_TIMEOUT_S = 2.0
LLM_TEMPERATURE = 0.4
# A field whose json_schema_extra holds {LLM_SCHEMA_SKIP_KEY: True} is left out of every schema sent to a model (the
# expert's take ids and per-finger tolerance, which only POST /recordings/model fills). Such a field needs a default.
LLM_SCHEMA_SKIP_KEY = "x-llm-skip"

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

# Expert media (POST /media): tutorial videos and the webcam filmed during a take, stored under <data_dir>/media.
MEDIA_DIR_NAME = "media"
MEDIA_MAX_BYTES = 200 * 1024 * 1024
MEDIA_MIME_TYPES = VIDEO_MIME_TYPES
MEDIA_SUFFIXES = VIDEO_SUFFIXES
MEDIA_URL_PREFIX = f"{API_PREFIX}/media/"
# Longest sync offset accepted (seconds into the video at which a take starts), and a sane cap on a stated duration.
MEDIA_MAX_OFFSET_S = 3600.0
MEDIA_MAX_DURATION_S = 4 * 3600.0

# Real gloves through the Rokoko Device SDK (status screen, calibration area, demo mode). The core (repo root `core/`)
# owns the glove data path; the backend only watches it: process and port checks, the driver's RCSP device list and
# events (read-only, except ReinitAlgo from the calibration area), and STATUS_FLAGS from a diagnostic RGMP tap.
REPO_ROOT = BACKEND_ROOT.parent
ROKOKO_SDK_DIRNAME = "Rokoko Device SDK"
ROKOKO_SDK_BIN = "bin"
_EXE = ".exe" if sys.platform == "win32" else ""
ROKOKO_SOLVER_EXE = f"rkk-hand-solver{_EXE}"
ROKOKO_DRIVER_EXE = f"rokoko-sdk{_EXE}"
ROKOKO_STUDIO_PROCESS = "Rokoko Studio.exe"
ROKOKO_DRIVER_HOST = "127.0.0.1"
ROKOKO_DRIVER_RGMP_PORT = 12276
ROKOKO_SOLVER_RGMP_PORT = 12277
ROKOKO_RCSP_PORT = 45451
# What the app starts when nothing serves 12276: the solver, which starts the driver itself (`--driver-arg` is passed
# through). `--emit both --emit-openxr` gives the core joints_local and joints_openxr; `--listen` serves 12277.
ROKOKO_SOLVER_ARGS = ("--emit", "both", "--emit-openxr", "--listen", "127.0.0.1:12277")
# The command a person runs when the driver is already up (the fix step for a missing solver).
ROKOKO_SOLVER_MANUAL = (
    "rkk-hand-solver --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277"
)
ROKOKO_DRIVER_ARGS = ("--auto-stream-usb",)
ROKOKO_SOLVER_LOG = "rkk-hand-solver.log"
ROKOKO_STOP_TIMEOUT_S = 3.0
ROKOKO_PORT_PROBE_TIMEOUT_S = 0.25
ROKOKO_PROCESS_CACHE_S = 2.0
ROKOKO_RCSP_TIMEOUT_S = 2.0
ROKOKO_RCSP_RECONNECT_S = 2.0
ROKOKO_DEVICE_REFRESH_S = 5.0
ROKOKO_TAP_RECONNECT_S = 2.0
ROKOKO_LOG_TAIL_BYTES = 16_000
# RCSP ConnectionType values (sdk.rokoko.com/reference/rcsp) to what the status screen says.
ROKOKO_CONNECTION_NAMES = {
    "serial": "usb",
    "usb": "usb",
    "udp": "wifi",
    "wifi": "wifi",
    "emulated": "emulated",
}
# RCSP DeviceEvents topics the monitor listens to, and the Logs topics it keeps for the fix steps.
ROKOKO_EVENT_TOPICS = (
    "Connected",
    "Disconnected",
    "Calibrated",
    "EmfSaturated",
    "GyrSaturated",
    "AccSaturated",
)
ROKOKO_LOG_TOPICS = ("Error", "Warning")
ROKOKO_LOG_KEEP = 20
# Driver output that means another program holds the USB devices (Rokoko Studio, usually), or that none were found.
ROKOKO_BUSY_PATTERNS = (
    "access is denied",
    "device busy",
    "resource busy",
    "being used by another process",
)
ROKOKO_NO_USB_PATTERNS = ("no serial devices", "no usb devices", "no devices found")
# STATUS_FLAGS names (sdk.rokoko.com/reference/products/smartgloves). Bits are looked up by name in each stream's
# bit_mapping, never by position.
GLOVE_SATURATION_FLAGS = {
    "is_magnetometer_saturated": "magnetometer",
    "is_accelerometer_saturated": "accelerometer",
    "is_gyroscope_saturated": "gyroscope",
    "is_emf_saturated": "EMF sensor",
}
GLOVE_HEADING_FLAG = "is_heading_reliable"
GLOVE_SENSOR_NAMES = ("thumb", "index", "middle", "ring", "little", "arm", "hub")
# RCSP saturation events, by topic, to the same sensor words; an event marks its glove for a few seconds.
GLOVE_SATURATION_EVENTS = {
    "EmfSaturated": "EMF sensor",
    "GyrSaturated": "gyroscope",
    "AccSaturated": "accelerometer",
}
GLOVE_SATURATION_EVENT_HOLD_S = 5.0
GLOVE_BATTERY_KEYS = (
    "battery",
    "battery_pct",
    "batterylevel",
    "battery_level",
    "batterypercent",
    "batterypercentage",
)
# Frame rates: the driver streams Smartgloves at 83.33 Hz; the app stream is about 60 Hz.
GLOVE_RATE_WINDOW_S = 2.0
# Measured 83.39 Hz per group on the real gloves; below 75 is worth a warning (core test agent, 14 Nov 2026).
GLOVE_MIN_DRIVER_FPS = 75.0
GLOVE_MIN_STREAM_FPS = 40.0
# A hand counts as tracked with a frame within 250 ms, as in the core.
GLOVE_STALE_FRAME_S = 0.25
# The driver sends data only while an RCSP client holds SubscribeToData; a definition with no data for this long
# means nobody subscribed (the core does it when it runs with --rcsp).
ROKOKO_SUBSCRIBE_GRACE_S = 2.0
# The hub heading flag flickers frame to frame (about 87 percent set while worn); judge it over about a second.
GLOVE_HEADING_WINDOW_FRAMES = 84

# Calibration area and demo mode.
WEARER_MAX_CHARS = 40
NEUTRAL_DEFAULT_DURATION_S = 3.0
NEUTRAL_MAX_DURATION_S = 10.0
NEUTRAL_MIN_FRAMES = 10
REINIT_SETTLE_S = 2.0
DRIFT_CHECK_DURATION_S = 2.0
# Drift from the saved neutral pose that asks for a recalibration: mean joint flexion change per hand, and wrist yaw.
DRIFT_MAX_FLEX_DEG = 8.0
DRIFT_MAX_YAW_DEG = 15.0
# Quality reading bands: noise at rest (joint flexion standard deviation), bias (neutral flexion away from flat) and
# heading reliability (share of the capture with is_heading_reliable set).
QUALITY_NOISE_GOOD_DEG = 1.0
QUALITY_NOISE_FAIR_DEG = 3.0
# A flat hand does not read as zero through the solver: the real worn capture gives a mean of 15 to 16 degrees per
# joint (index about 37 summed, little 59 to 79), so the bias bands sit above that.
QUALITY_BIAS_GOOD_DEG = 22.0
QUALITY_BIAS_FAIR_DEG = 32.0
QUALITY_HEADING_GOOD = 0.95
QUALITY_HEADING_FAIR = 0.6
# Verification step: how far each finger's total flexion must travel (open to closed) for the hand to count as following.
VERIFY_MIN_TRAVEL_DEG = 60.0

# Expert training persistence: the scratch draft on disk, file bundles (export and import) and automatic backups.
# One file per draft under <data_dir>/drafts; the draft itself is the frontend's object, kept as opaque JSON.
DRAFTS_DIR_NAME = "drafts"
DRAFT_KINDS = ("scratch",)
DRAFT_MAX_BYTES = 512 * 1024
# Oldest drafts beyond this many are pruned when a draft is saved.
DRAFTS_KEEP = 20
# Bundle file format (GET /lessons/{id}/export, GET /export/all, POST /lessons/import).
BUNDLE_FORMAT = "geppetto.bundle"
BUNDLE_FORMAT_VERSION = 1
BUNDLE_FILE_SUFFIX = ".geppetto.json"
# A referenced video is embedded as base64 only when it is this small; larger ones are listed by id.
BUNDLE_MEDIA_EMBED_MAX_BYTES = 2 * 1024 * 1024
# After every publish (POST or PUT /lessons) the lesson's bundle is written to <data_dir>/exports; the newest N per
# lesson name are kept.
EXPORTS_DIR_NAME = "exports"
EXPORT_BACKUPS_KEEP = 5
EXPORT_SLUG_MAX_CHARS = 48

# Dev file reveal (POST /api/dev/reveal, GET /api/dev/locate): finds a stored file under <data_dir> so a developer can
# open its folder or copy its path, e.g. to send a take to someone. Answers only requests from this machine, and only
# while the flag is on (env DEV_REVEAL=false turns it off). The kinds and the folder each one lives in under <data_dir>.
DEV_REVEAL_ENABLED = True
DEV_LOCAL_HOSTS = ("127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1")
DEV_REVEAL_DIRS = {
    "recording": "recordings",
    "lesson": "lessons",
    "draft": DRAFTS_DIR_NAME,
    "export": EXPORTS_DIR_NAME,
    "calibration": "calibrations",
    "media": MEDIA_DIR_NAME,
}
# An export id is a file name in <data_dir>/exports (with or without .geppetto.json), or a lesson id for its newest backup.
DEV_EXPORT_NAME_PATTERN = r"^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$"
