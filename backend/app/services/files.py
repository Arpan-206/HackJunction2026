"""Dev aid: find a stored file under <data_dir> (a take, lesson, draft, backup, calibration or video) and show it in the
operating system's file manager, so a developer can copy it or send it on. Every path is checked to stay inside the
data folder."""

import logging
import re
import subprocess
import sys
from pathlib import Path

from app import constants as c
from app.core.errors import BadRequestError, NotFoundError
from app.services.bundles import BundleService, slug
from app.services.lessons import LessonService
from app.services.media import MediaService

log = logging.getLogger(__name__)

_SAFE_ID = re.compile(c.SAFE_ID_PATTERN)
_EXPORT_NAME = re.compile(c.DEV_EXPORT_NAME_PATTERN)


def open_in_file_manager(path: Path) -> bool:
    """Open the file manager with the file selected (Windows Explorer, macOS Finder) or its folder (Linux).

    Returns False when no file manager could be started; the path is still useful to copy.
    """
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    except OSError:
        log.warning("could not open a file manager for %s", path)
        return False
    return True


class FileLocator:
    """Resolves (kind, id) to a file that exists inside the data folder, or raises."""

    def __init__(
        self,
        data_dir: Path,
        media: MediaService,
        lessons: LessonService,
        bundles: BundleService,
    ) -> None:
        """Keep the data folder and the services that know where media and backups live."""
        self._root = data_dir.resolve()
        self._media = media
        self._lessons = lessons
        self._bundles = bundles

    def locate(self, kind: str, item_id: str) -> Path:
        """The absolute path of a stored file; 400 for an unsafe id or kind, 404 when missing or outside the data folder."""
        folder = c.DEV_REVEAL_DIRS.get(kind)
        if folder is None:
            raise BadRequestError(f"unknown kind: {kind!r}")
        if kind == "export":
            path = self._export(item_id)
        else:
            if not _SAFE_ID.match(item_id):
                raise BadRequestError(f"invalid id: {item_id!r}")
            if kind == "media":
                path, _ = self._media.path(item_id)
            else:
                path = self._root / folder / f"{item_id}.json"
        return self._inside(path, kind, item_id)

    def _export(self, item_id: str) -> Path:
        """A backup in <data_dir>/exports by file name (with or without the bundle suffix), or a lesson's newest one."""
        if not _EXPORT_NAME.match(item_id) or ".." in item_id:
            raise BadRequestError(f"invalid id: {item_id!r}")
        exports = self._root / c.EXPORTS_DIR_NAME
        name = (
            item_id
            if item_id.endswith(c.BUNDLE_FILE_SUFFIX)
            else f"{item_id}{c.BUNDLE_FILE_SUFFIX}"
        )
        if (exports / name).is_file() or not _SAFE_ID.match(item_id):
            return exports / name
        try:
            lesson = self._lessons.get(item_id)
        except NotFoundError:
            return exports / name
        backups = self._bundles.backups(slug(lesson.title))
        if not backups:
            raise NotFoundError(f"no backup of lesson {item_id} yet")
        return backups[-1]

    def _inside(self, path: Path, kind: str, item_id: str) -> Path:
        """The resolved path, only when it is an existing file inside the data folder."""
        resolved = path.resolve()
        if not resolved.is_relative_to(self._root) or not resolved.is_file():
            raise NotFoundError(f"{kind} {item_id} not found")
        return resolved
