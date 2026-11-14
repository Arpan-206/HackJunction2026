"""Moved to core/camera/gdrec.py so the core does not import ios/ at run time. Re-exported here."""
from core.camera.gdrec import (  # noqa: F401
    ARRIVAL, FILE_MAGIC, RecordingWriter, frames, read_note, read_recording)
