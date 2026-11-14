"""A recording folder from the real glove capture, and the words the model gets about it. No network."""

import json

import numpy as np
import pytest

import paths
import recording as R

FIXTURE = paths.CAPTURE_FIXTURE

pytestmark = pytest.mark.skipif(not FIXTURE.exists(), reason="real capture fixture not in the repo")


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    out = tmp_path_factory.mktemp("rec")
    return R.recording_from_capture(FIXTURE, out, side="right", marks=3, lesson_id="worn-right")


def test_capture_becomes_a_lesson_folder_with_sketches(folder):
    lesson = json.loads((folder / "lesson.json").read_text())
    assert lesson["schema"] == "geppetto.lesson/1"
    assert lesson["master"]["hand"] == "right"
    assert len(lesson["steps"]) == 3
    frames = sorted((folder / "frames").glob("step_*.jpg"))
    assert [p.name for p in frames] == ["step_00.jpg", "step_01.jpg", "step_02.jpg"]
    assert (folder / "trace.npz").exists()


def test_summary_describes_every_step_in_words(folder):
    rec = R.load_recording(folder)
    text = R.trace_summary(rec)
    assert "Demonstrating hand: right" in text
    assert "3 step(s)" in text
    for finger in ("thumb", "index", "middle", "ring", "little"):
        assert finger in text
    for word in ("1. ", "2. ", "3. "):
        assert word in text
    assert "Picture: step_00.jpg" in text
    assert "Finger travel" in text


def test_finger_words_follow_curl():
    straight = np.zeros(18)
    assert set(R.finger_words(straight).values()) == {"straight"}
    fist = np.full(18, 85.0)
    assert set(R.finger_words(fist).values()) == {"curled"}


def test_pick_frames_is_even_and_ordered(folder):
    rec = R.load_recording(folder)
    assert [p.name for p in R.pick_frames(rec, 2)] == ["step_00.jpg", "step_02.jpg"]
    assert len(R.pick_frames(rec, 10)) == 3


def test_image_data_url_is_small_jpeg(folder):
    rec = R.load_recording(folder)
    url = R.image_data_url(rec.frames[0])
    assert url.startswith("data:image/jpeg;base64,")
    assert len(url) < 200_000
