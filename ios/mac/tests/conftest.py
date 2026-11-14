import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# core/camera/depth.py (the shared DepthFrame) is in the main checkout's working tree and
# not yet on origin/main. Until it lands, load it read-only from GEPPETTO_MAIN_CHECKOUT
# (default: the main checkout that holds this worktree). Once it is on main this does nothing.
try:
    import core.camera.depth  # noqa: F401
except ImportError:
    main = Path(os.environ.get("GEPPETTO_MAIN_CHECKOUT", ROOT.parents[2] if ".claude" in ROOT.parts else ROOT))
    src = main / "core" / "camera" / "depth.py"
    spec = importlib.util.spec_from_file_location("core.camera.depth", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["core.camera.depth"] = mod
    spec.loader.exec_module(mod)
