"""scripts/slot: prompts, logs, step geometry, and the depth step against the fake phone (no gloves, no backend)."""

import io
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts" / "slot"))

import slot_steps as S  # noqa: E402
from slot_links import Trace, free_port, port_open  # noqa: E402
from slot_log import AUTO_ANSWER, Console, Result, RunLog  # noqa: E402
from slot_main import parse_steps, read_lessons  # noqa: E402


def test_console_answers_and_auto_mode():
    out = io.StringIO()
    c = Console(auto=False, out=out, inp=io.StringIO("\nx\nr\nretry\n\n"))
    c.enter()
    assert c.judge(Result("ok", "fine")) == "retry"  # "x" is refused, then "r"
    assert "Type one of" in out.getvalue()
    assert c.judge(Result("bad", "no")) == "retry"  # the full word works too
    assert c.judge(Result("bad", "no")) == "fail"  # Enter takes the default
    auto = Console(auto=True, out=io.StringIO())
    for v, a in AUTO_ANSWER.items():
        assert auto.judge(Result(v, "")) == a
    with pytest.raises(ValueError):
        Result("maybe", "")


def test_runlog_writes_jsonl_and_summary(tmp_path):
    log = RunLog(tmp_path / "run", dry_run=True, meta={"started": "now", "wearer": "test"})
    tr = Trace()
    tr.add("shell", "echo hi", True, "hi")
    log.add(1, "depth", "Depth clip", 1, time.time(), Result("bad", "slow", fix="use the cable"), "retry", tr)
    log.add(1, "depth", "Depth clip", 2, time.time(), Result("ok", "30 fps"), "pass", Trace())
    log.add(2, "right_thumb", "Right thumb", 1, time.time(), Result("bad", "thumb 3 deg", fix="fold it"), "fail", Trace())
    lines = [json.loads(x) for x in (tmp_path / "run" / "results.jsonl").read_text().splitlines()]
    assert [r["attempt"] for r in lines] == [1, 2, 1]
    assert lines[0]["commands"][0]["command"] == "echo hi"
    md = (tmp_path / "run" / "summary.md").read_text()
    assert "| 1 | Depth clip | ok | pass | 2 | 30 fps |" in md
    assert "Step 2, Right thumb: fold it" in md
    assert "use the cable" not in md  # only the last attempt's fix, and only when not passed
    assert "DRY RUN" in md


def test_parse_steps_and_lessons(tmp_path):
    assert parse_steps("2,3") == {2, 3}
    assert parse_steps("4-6,8") == {4, 5, 6, 8}
    f = tmp_path / "l.txt"
    f.write_text("# comment\nPinch\n\n  Wave  \n")
    assert read_lessons(f) == ["Pinch", "Wave"]
    assert len(read_lessons(REPO / "scripts" / "slot" / "lessons.txt")) >= 1


def _joints(heading_deg):
    """26 joints with the wrist at the origin and the middle proximal along the heading."""
    j = [[0.0, 0.0, 0.0] for _ in range(26)]
    h = math.radians(heading_deg)
    j[12] = [-0.08 * math.sin(h), 0.0, -0.08 * math.cos(h)]
    return j


def test_palm_heading_convention():
    assert S.palm_heading_deg(_joints(0)) == pytest.approx(0.0, abs=1e-6)
    assert S.palm_heading_deg(_joints(90)) == pytest.approx(90.0)  # fingers to the person's left, world -X
    left = _joints(0)
    left[12] = [-0.08, 0.0, 0.0]
    assert S.palm_heading_deg(left) == pytest.approx(90.0)
    assert abs(S.circ_mean_deg([170.0, -170.0])) == pytest.approx(180.0, abs=1e-6)
    assert S.ang_diff(10, 350) == pytest.approx(20.0)
    frames = [{"hands": {"left": {"joints": _joints(5)}, "right": None}}] * 3
    hs = S.headings(frames)
    assert hs["left"] == pytest.approx(5.0) and hs["right"] is None


def test_deg_ranges_from_backend_calibration():
    cal = {"flat": {f: [0.1, 0.1, 0.1] for f in S.FINGERS},
           "fist": {**{f: [0.6, 0.6, 0.6] for f in S.FINGERS}, "thumb": [0.0, 0.05, 0.05]}}
    r = S._deg_ranges(cal)
    assert r["index"] == pytest.approx(math.degrees(1.5), abs=0.1)
    assert r["thumb"] < 0  # the failure seen on Sat 14 Nov: thumb less bent in the fist


def test_module_of_template():
    assert S._module_of("python -m tools.depth_check {file}") == "tools.depth_check"
    assert S._module_of("./check.sh {file}") is None


def test_depth_step_against_fake_phone(tmp_path):
    """Step 1 end to end on the fake sender: records, summarises, and skips the missing lidar check cleanly."""
    port = free_port()
    sender = subprocess.Popen([sys.executable, "-m", "ios.mac.fake_sender", "--port", str(port)], cwd=REPO,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if port_open(port):
                break
            time.sleep(0.1)
        ctx = S.Ctx(console=Console(auto=True, out=io.StringIO()), repo=REPO, py=sys.executable, run_dir=tmp_path,
                    wearer="test", dry=True, opts=S.Options(depth_seconds=2.0, depth_check="python -m tools.no_such_check {file}"),
                    core_port=0, backend_url="", depth_host="127.0.0.1", depth_port=port, data_dir=tmp_path, cfg=None)
        r = S.step_depth(ctx)
    finally:
        sender.terminate()
        sender.wait(5)
    assert r.verdict == "look", r.summary  # fake phone: a person must still judge the real clip
    assert r.details["depth_check"] == "skipped"
    assert r.details["info"]["frames"] > 20
    assert (tmp_path / "depth_clip.gdrec.gz").exists()
    cmds = [e["command"] for e in ctx.trace.entries]
    assert any("ios.mac.record" in x for x in cmds) and any("SKIPPED" in e["output"] for e in ctx.trace.entries)


def test_depth_step_reports_missing_phone(tmp_path):
    port = free_port()
    ctx = S.Ctx(console=Console(auto=True, out=io.StringIO()), repo=REPO, py=sys.executable, run_dir=tmp_path,
                wearer="test", dry=True, opts=S.Options(depth_seconds=1.0), core_port=0, backend_url="",
                depth_host="127.0.0.1", depth_port=port, data_dir=tmp_path, cfg=None)
    r = S.step_depth(ctx)
    assert r.verdict == "error" and "forward.sh" in r.fix
