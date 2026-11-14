"""Offline replay of real Rokoko Smartgloves II captures (no hardware, always runs).

Fixtures under tests/fixtures/rgmp/ are short slices of real RGMP streams recorded from the Rokoko Device SDK
driver (127.0.0.1:12276) and the rkk-hand-solver (127.0.0.1:12277). Rebuild with scripts/make_rgmp_fixture.py.

- shaken_driver.rgmp.gz: gloves shaken around, not worn, 0.8 s contiguous.
- worn_driver.rgmp.gz / worn_solver.rgmp.gz: gloves worn, scripted poses, 8 slices (flat, fist, open, thumb, index,
  middle, ring, little), each a short contiguous run. Only group 0 (and 0, 2 for the solver) are kept in the slices;
  the definitions are verbatim.

Frame rate, gaps and monotonic time are therefore checked inside each contiguous slice.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest
from app import constants as c

from tests.rgmp_reader import (
    Capture,
    angle_between_deg,
    flag_names,
    parse_capture,
    quat_norm,
    rotation_range_deg,
)

FIX = Path(__file__).parent / "fixtures" / "rgmp"
LEFT_ID, RIGHT_ID = 1572077328, 2811174587
HANDS = {LEFT_ID: "left", RIGHT_ID: "right"}
FINGERS = ["thumb", "index", "middle", "ring", "little"]
PHASES = ["flat", "fist", "open", "thumb", "index", "middle", "ring", "little"]
SEGMENT_GAP_US = 100_000  # a jump this large is a cut between slices, not a dropout
MAX_GAP_US = 40_000  # inside a slice: no frame may be missing (nominal 12 ms)


@pytest.fixture(scope="module")
def shaken() -> Capture:
    return parse_capture((FIX / "shaken_driver.rgmp.gz").read_bytes())


@pytest.fixture(scope="module")
def worn() -> Capture:
    return parse_capture((FIX / "worn_driver.rgmp.gz").read_bytes())


@pytest.fixture(scope="module")
def worn_solver() -> Capture:
    return parse_capture((FIX / "worn_solver.rgmp.gz").read_bytes())


def segments(timestamps: list[int]) -> list[tuple[int, int]]:
    """Index ranges of contiguous runs (split where time jumps by more than SEGMENT_GAP_US)."""
    out, start = [], 0
    for i in range(1, len(timestamps)):
        if timestamps[i] - timestamps[i - 1] > SEGMENT_GAP_US:
            out.append((start, i))
            start = i
    out.append((start, len(timestamps)))
    return out


def phase_slices(cap: Capture, dev: int, group: int, target: str, measure: str):
    ser = cap.series(dev, group, measure, target)
    segs = segments([t for t, _ in ser])
    assert len(segs) == len(PHASES), (
        f"expected {len(PHASES)} phase slices, found {len(segs)}"
    )
    return {name: ser[a:b] for name, (a, b) in zip(PHASES, segs)}


# ---------------------------------------------------------------- definitions and identity


@pytest.mark.parametrize("name", ["shaken", "worn"])
def test_both_hands_present_with_right_ids_and_hands(name, request):
    cap: Capture = request.getfixturevalue(name)
    assert set(cap.definitions) == {LEFT_ID, RIGHT_ID}
    for dev, hand in HANDS.items():
        d = cap.definitions[dev]
        assert d["device_type"] == "Smartgloves II"
        assert d["device_info"]["hand"] == hand
        assert hand in d["device_info"]["friendly_name"]
        assert cap.device_frames(dev), f"no data frames for the {hand} glove"


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_definition_has_49_streams_in_two_groups(shaken, dev):
    groups = shaken.definitions[dev]["groups"]
    assert [g["name"] for g in groups] == ["default", "emf_only"]
    assert [len(g["streams"]) for g in groups] == [31, 18]
    assert sum(len(g["streams"]) for g in groups) == 49


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_default_group_layout_has_every_finger_sensor(shaken, dev):
    layout = shaken.layout(dev)[0]
    transforms = [s for s in layout if s.measure_type == "TRANSFORM"]
    finger_transforms = {
        s.target_frame: s
        for s in transforms
        if s.target_frame.endswith("_finger_sensor")
    }
    assert set(finger_transforms) == {f"{f}_finger_sensor" for f in FINGERS}
    for s in finger_transforms.values():
        assert s.size == 28  # FLOAT[7]: position xyz + quaternion
        assert s.reference_frame == "hub"
    # the driver also publishes an arm_sensor transform relative to coil_pro; nothing of ours may depend on it
    assert [s.target_frame for s in transforms if s.reference_frame == "coil_pro"] == [
        "arm_sensor"
    ]
    # every finger sensor has a status flags word to go with it
    flagged = {s.target_frame for s in layout if s.measure_type == "STATUS_FLAGS"}
    for finger in FINGERS:
        assert f"{finger}_finger_sensor" in flagged


@pytest.mark.parametrize("name", ["shaken", "worn"])
def test_every_frame_decodes_to_exactly_its_group_layout(name, request):
    """decode_frame raises on a size mismatch, so parsing the whole fixture is the layout check."""
    cap: Capture = request.getfixturevalue(name)
    for dev in HANDS:
        layout = cap.layout(dev)
        for f in cap.device_frames(dev):
            assert len(f.values) == len(layout[f.group])


# ---------------------------------------------------------------- timing


@pytest.mark.parametrize("name", ["shaken", "worn"])
@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_frame_rate_per_group_matches_definition(name, dev, request):
    cap: Capture = request.getfixturevalue(name)
    for gi, group in enumerate(cap.definitions[dev]["groups"]):
        frames = cap.device_frames(dev, gi)
        if not frames:
            continue  # the worn fixture keeps group 0 only
        expected = group["expected_rate_hz"]
        ts = [f.timestamp_us for f in frames]
        n_frames = dur_us = 0
        for a, b in segments(ts):
            n_frames += b - a - 1
            dur_us += ts[b - 1] - ts[a]
        rate = n_frames / (dur_us / 1e6)
        assert rate == pytest.approx(expected, rel=0.05), (
            f"{HANDS[dev]} {group['name']}: {rate:.2f} Hz"
        )


@pytest.mark.parametrize("name", ["shaken", "worn"])
@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_timestamps_strictly_increase_with_no_dropouts(name, dev, request):
    cap: Capture = request.getfixturevalue(name)
    for gi in range(len(cap.definitions[dev]["groups"])):
        ts = [f.timestamp_us for f in cap.device_frames(dev, gi)]
        if len(ts) < 2:
            continue
        for a, b in segments(ts):
            run = ts[a:b]
            gaps = [y - x for x, y in zip(run, run[1:])]
            assert all(g > 0 for g in gaps), "timestamps must increase"
            assert max(gaps) < MAX_GAP_US, (
                f"{HANDS[dev]} group {gi}: gap of {max(gaps) / 1000:.1f} ms"
            )


def test_shaken_capture_is_one_contiguous_run(shaken):
    for dev in HANDS:
        assert (
            len(segments([f.timestamp_us for f in shaken.device_frames(dev, 0)])) == 1
        )


# ---------------------------------------------------------------- values


@pytest.mark.parametrize("name", ["shaken", "worn"])
@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_every_transform_quaternion_has_unit_norm(name, dev, request):
    cap: Capture = request.getfixturevalue(name)
    layout = cap.layout(dev)
    checked = 0
    for f in cap.device_frames(dev):
        for stream, value in zip(layout[f.group], f.values):
            if stream.measure_type == "TRANSFORM" and len(value) == 7:
                assert quat_norm(value[3:7]) == pytest.approx(1.0, abs=1e-3), (
                    stream.target_frame
                )
                assert all(math.isfinite(v) for v in value)
                checked += 1
    assert checked > 100


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_shaken_capture_has_motion(shaken, dev):
    """Gloves were shaken: at least one finger sensor rotates well away from its first sample."""
    ranges = {
        f: rotation_range_deg(
            [
                v[3:7]
                for _, v in shaken.series(dev, 0, "TRANSFORM", f"{f}_finger_sensor")
            ]
        )
        for f in FINGERS
    }
    assert max(ranges.values()) > 20, ranges
    gyro = [
        math.sqrt(sum(x * x for x in v))
        for _, v in shaken.series(dev, 0, "ANGULAR_VELOCITY", "index_finger_imu")
    ]
    assert max(gyro) > 1.0, "no angular velocity in a shaken capture"


# ---------------------------------------------------------------- status flags (decoded by bit name)


def test_flag_names_decode_through_bit_mapping_not_fixed_bits():
    bm = {2: "alpha", 5: "beta", 9: "gamma"}
    assert flag_names(0, bm) == set()
    assert flag_names(1 << 5, bm) == {"beta"}
    assert flag_names((1 << 2) | (1 << 9), bm) == {"alpha", "gamma"}
    assert flag_names(1 << 3, bm) == set()  # a bit that is not named is ignored


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_status_flag_streams_name_the_saturation_bits(shaken, dev):
    streams = [s for s in shaken.layout(dev)[0] if s.measure_type == "STATUS_FLAGS"]
    assert streams
    for s in streams:
        assert s.bit_mapping, f"{s.target_frame} has no bit_mapping"
        assert all(isinstance(b, int) and 0 <= b < 32 for b in s.bit_mapping)
    for s in streams:
        if s.target_frame.endswith("_finger_sensor"):
            assert {
                "is_accelerometer_saturated",
                "is_gyroscope_saturated",
                "is_emf_saturated",
            } <= set(s.bit_mapping.values())
    hub = [s for s in streams if s.target_frame == "hub"]
    assert hub and "is_heading_reliable" in hub[0].bit_mapping.values()


@pytest.mark.parametrize("name", ["shaken", "worn"])
@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_real_status_words_decode_to_known_names_only(name, dev, request):
    cap: Capture = request.getfixturevalue(name)
    layout = cap.layout(dev)
    seen: set[str] = set()
    n = 0
    for f in cap.device_frames(dev, 0):
        for stream, value in zip(layout[f.group], f.values):
            if stream.measure_type == "STATUS_FLAGS":
                names = flag_names(value[0], stream.bit_mapping)
                assert names <= set(stream.bit_mapping.values())
                seen |= names
                n += 1
    assert n > 0
    if name == "worn":
        # worn gently: the capture notes record no saturation at all
        assert not {s for s in seen if s.endswith("_saturated")}, seen


def test_worn_capture_has_no_saturation_in_any_slice(worn):
    for dev in HANDS:
        layout = worn.layout(dev)[0]
        for f in worn.device_frames(dev, 0):
            for stream, value in zip(layout, f.values):
                if stream.measure_type == "STATUS_FLAGS":
                    assert not {
                        n
                        for n in flag_names(value[0], stream.bit_mapping)
                        if n.endswith("_saturated")
                    }


# ---------------------------------------------------------------- worn poses: finger isolation


def sensor_angles(cap: Capture, dev: int):
    """phase -> finger -> median rotation (deg) from the first frame of the flat slice."""
    per_finger = {
        f: phase_slices(cap, dev, 0, f"{f}_finger_sensor", "TRANSFORM") for f in FINGERS
    }
    ref = {f: per_finger[f]["flat"][0][1][3:7] for f in FINGERS}
    out = {}
    for ph in PHASES:
        out[ph] = {}
        for f in FINGERS:
            angs = sorted(
                angle_between_deg(v[3:7], ref[f]) for _, v in per_finger[f][ph]
            )
            out[ph][f] = angs[len(angs) // 2]
    return out, per_finger


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_flat_is_still_and_open_returns_low(worn, dev):
    angles, per_finger = sensor_angles(worn, dev)
    for f in FINGERS:
        flat = [v[3:7] for _, v in per_finger[f]["flat"]]
        assert rotation_range_deg(flat) < 5, f"{HANDS[dev]} {f} moved during flat"
        assert angles["open"][f] < 20, (
            f"{HANDS[dev]} {f} after open: {angles['open'][f]:.0f} deg"
        )


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_fist_curls_all_four_fingers_past_100_degrees(worn, dev):
    angles, _ = sensor_angles(worn, dev)
    for f in FINGERS[1:]:
        assert angles["fist"][f] > 100, f"{HANDS[dev]} {f}: {angles['fist'][f]:.0f} deg"
    assert angles["fist"]["thumb"] < angles["fist"]["index"]


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
@pytest.mark.parametrize("target", FINGERS)
def test_moving_one_finger_moves_that_sensor_most(worn, dev, target):
    """The target rotates far; fingers that are not its neighbours stay low. Adjacent fingers couple mechanically
    (ring and little in particular), so a neighbour may follow but must stay below the target."""
    angles, _ = sensor_angles(worn, dev)
    row = angles[target]
    need = 60 if target == "thumb" else 90
    assert row[target] > need, f"{HANDS[dev]} {target}: {row[target]:.0f} deg"
    i = FINGERS.index(target)
    neighbours = {FINGERS[j] for j in (i - 1, i + 1) if 0 <= j < len(FINGERS)}
    for f in FINGERS:
        if f == target:
            continue
        assert row[f] < row[target], (
            f"{HANDS[dev]} {target} phase: {f} {row[f]:.0f} >= target {row[target]:.0f}"
        )
        if f not in neighbours:
            assert row[f] < 40, (
                f"{HANDS[dev]} {target} phase: unrelated {f} moved {row[f]:.0f} deg"
            )
            assert row[target] - row[f] > 50


def test_left_and_right_agree_on_every_phase(worn):
    left, _ = sensor_angles(worn, LEFT_ID)
    right, _ = sensor_angles(worn, RIGHT_ID)
    for ph in ("fist", "thumb", "index", "middle", "ring", "little"):
        l_top = max(left[ph], key=left[ph].get)
        r_top = max(right[ph], key=right[ph].get)
        if ph == "fist":
            # all four fingers curl; the thumb is the one that stays low on both hands
            assert (
                min(left[ph], key=left[ph].get)
                == min(right[ph], key=right[ph].get)
                == "thumb"
            )
        else:
            assert l_top == r_top, f"{ph}: left moves {l_top}, right moves {r_top}"


# ---------------------------------------------------------------- solver (rkk-hand-solver, 12277)

SOLVER_FINGER_NUM = {"thumb": 1, "index": 2, "middle": 3, "ring": 4, "little": 5}


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def _rotvec_deg(q):
    if q[3] < 0:
        q = tuple(-v for v in q)
    s = math.sqrt(sum(v * v for v in q[:3]))
    if s < 1e-9:
        return (0.0, 0.0, 0.0)
    k = 2 * math.atan2(s, q[3]) / s
    return tuple(math.degrees(v * k) for v in q[:3])


def _mean_quat(qs):
    ref = qs[0]
    acc = [0.0] * 4
    for q in qs:
        sign = 1 if sum(a * b for a, b in zip(q, ref)) >= 0 else -1
        for i in range(4):
            acc[i] += sign * q[i]
    n = math.sqrt(sum(v * v for v in acc))
    return tuple(v / n for v in acc)


def local_flexion(cap: Capture, dev: int, finger: str, joint: str, phase: str):
    """Rotation vector (deg) of a local joint orientation in `phase`, relative to the same joint in the flat slice."""
    hand = HANDS[dev]
    frame = f"{hand}_finger{SOLVER_FINGER_NUM[finger]}_{joint}"
    sl = phase_slices(cap, dev, 0, frame, "ORIENTATION")
    flat = _mean_quat([v for _, v in sl["flat"]])
    now = _mean_quat([v for _, v in sl[phase]])
    return _rotvec_deg(_qmul((-flat[0], -flat[1], -flat[2], flat[3]), now))


def test_solver_definition_exposes_26_openxr_joints_per_hand(worn_solver):
    assert set(worn_solver.definitions) == {LEFT_ID, RIGHT_ID}
    for dev, hand in HANDS.items():
        d = worn_solver.definitions[dev]
        assert d["device_info"]["hand"] == hand
        assert d["device_info"]["source_device_id"] == dev
        assert [g["name"] for g in d["groups"]] == [
            "joints_local",
            "joints_world",
            "joints_openxr",
        ]
        assert all(len(g["streams"]) == 26 for g in d["groups"])


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
def test_solver_openxr_tips_retract_toward_the_palm_in_a_fist(worn_solver, dev):
    """OpenXR wrist frame: fingers point along -Z and the palm faces -Y. A fist pulls every tip back toward the wrist
    (z grows) and toward the palm (y shrinks)."""

    def tip_in_wrist(finger: str, phase: str):
        wrist = phase_slices(worn_solver, dev, 2, "xr_wrist", "TRANSFORM")[phase]
        tip = phase_slices(worn_solver, dev, 2, f"xr_{finger}_tip", "TRANSFORM")[phase]
        n = len(wrist)
        acc = [0.0, 0.0, 0.0]
        for (_, w), (_, t) in zip(wrist, tip):
            x, y, z, wq = (-w[3], -w[4], -w[5], w[6])  # conjugate: world -> wrist frame
            rel = [t[i] - w[i] for i in range(3)]
            tt = (
                2 * (y * rel[2] - z * rel[1]),
                2 * (z * rel[0] - x * rel[2]),
                2 * (x * rel[1] - y * rel[0]),
            )
            loc = (
                rel[0] + wq * tt[0] + (y * tt[2] - z * tt[1]),
                rel[1] + wq * tt[1] + (z * tt[0] - x * tt[2]),
                rel[2] + wq * tt[2] + (x * tt[1] - y * tt[0]),
            )
            for i in range(3):
                acc[i] += loc[i] / n
        return acc

    for finger in ("index", "middle", "ring", "little"):
        flat, fist = tip_in_wrist(finger, "flat"), tip_in_wrist(finger, "fist")
        assert flat[2] < -0.10, (
            f"{finger}: flat hand tip should be at least 10 cm along -Z, got {flat}"
        )
        assert fist[2] - flat[2] > 0.06, (
            f"{finger}: tip did not come back toward the wrist ({flat} -> {fist})"
        )
        assert fist[1] < flat[1], (
            f"{finger}: tip did not move toward the palm (-Y) ({flat} -> {fist})"
        )


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
@pytest.mark.parametrize("finger", ["index", "middle", "ring", "little"])
def test_solver_flexion_is_local_x_axis_and_negative(worn_solver, dev, finger):
    """MEASURED: in the solver's joints_local group (quaternion x,y,z,w) a fist rotates every finger joint about local
    +X by a NEGATIVE angle, on both hands. So the flexion axis is 0 (matches ROKOKO_FLEX_AXIS) and the sign is -1.
    Medial and distal joints are pure X rotations; proximal joints carry some abduction on Y and Z."""
    for joint in ("proximal", "medial", "distal"):
        x, y, z = local_flexion(worn_solver, dev, finger, joint, "fist")
        assert x < -35, f"{HANDS[dev]} {finger} {joint}: x={x:.0f}"
        assert abs(x) > 1.5 * max(abs(y), abs(z)), (
            f"{HANDS[dev]} {finger} {joint}: x={x:.0f} y={y:.0f} z={z:.0f}"
        )
        if joint != "proximal":
            assert abs(y) < 5 and abs(z) < 5
    assert c.ROKOKO_FLEX_AXIS == 0


@pytest.mark.parametrize("dev", [LEFT_ID, RIGHT_ID])
@pytest.mark.parametrize("finger", ["index", "middle", "ring", "little"])
def test_solver_joints_move_in_the_phase_of_their_finger(worn_solver, dev, finger):
    """The solver spreads a finger's flexion over its proximal, medial and distal joints differently per finger and
    hand (the isolated left index shows up almost only on the medial joint), so the total local X rotation of the
    three joints is the per-finger measure."""

    def total(phase: str) -> float:
        return sum(
            local_flexion(worn_solver, dev, finger, j, phase)[0]
            for j in ("proximal", "medial", "distal")
        )

    own, idle = total(finger), total("thumb")
    assert own < -70, f"{HANDS[dev]} {finger}: total x={own:.0f} in its own phase"
    assert abs(idle) < 45, (
        f"{HANDS[dev]} {finger}: total x={idle:.0f} while only the thumb moves"
    )


# ---------------------------------------------------------------- hooks for the backend glove status work

# The glove status (/api/gloves/status), its fix steps and the drift check, fed the same real captures. The status
# reads the driver's RGMP through app/services/rig/monitor.py (core.rgmp underneath); the drift check reads hand frames
# the way the bridge delivers them, so the solver capture goes through the core's own GloveSource and compat mapping.

import gzip
import json
import struct

import numpy as np
from fastapi.testclient import TestClient

from tests.rgmp_reader import TYPE_DATA, TYPE_DEFINITION, iter_messages


class _Clock:
    """A clock the replay moves along the device timestamps."""

    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def _messages(name: str, only: int | None = None) -> list[tuple[int, bytes]]:
    blob = gzip.decompress((FIX / name).read_bytes())
    out = []
    for typ, payload in iter_messages(blob):
        if only is not None:
            dev = (
                json.loads(payload)["device_id"]
                if typ == TYPE_DEFINITION
                else struct.unpack_from("<I", payload, 0)[0]
            )
            if dev != only:
                continue
        out.append((typ, struct.pack("<II", typ, len(payload)) + payload))
    return out


def _replay_status(
    client: TestClient,
    name: str,
    *,
    only: int | None = None,
    definitions_only: bool = False,
    wait_s: float = 0.0,
) -> dict:
    """Feed a driver capture to the status's driver tap, paced by device time, and read /api/gloves/status."""
    from app.services.rig.monitor import DriverTap

    rig = client.app.state.services.rig  # type: ignore[attr-defined]
    rig.port_open = lambda host, port: True
    rig.process_names = lambda: {
        c.ROKOKO_DRIVER_EXE.lower(),
        c.ROKOKO_SOLVER_EXE.lower(),
    }
    rig._probe = None
    clock = _Clock()
    rig.tap = DriverTap(lambda h, p: False, clock=clock)
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    for typ, msg in _messages(name, only):
        if typ == TYPE_DATA:
            if definitions_only:
                continue
            dev, _g, ts = struct.unpack_from("<IIQ", msg, 8)
            first.setdefault(dev, ts)
            # Slices are cut out of a longer capture; close the gaps so the rate reads as the live stream would.
            step = min(ts - last.get(dev, ts), 13_000)
            clock.t += step / 1e6 if dev == min(first) else 0.0
            last[dev] = ts
        elif typ != TYPE_DEFINITION:
            continue
        rig.tap.feed(msg)
    clock.t += wait_s
    return client.get("/api/gloves/status").json()


def test_status_replays_both_real_gloves_as_connected_and_streaming(
    client: TestClient,
) -> None:
    body = _replay_status(client, "worn_driver.rgmp.gz")
    left, right = body["gloves"]
    for g, dev in ((left, LEFT_ID), (right, RIGHT_ID)):
        assert g["connected"] and g["device_id"] == dev and g["streaming"] is True
        assert 70 <= g["driver_fps"] <= 95, g["driver_fps"]
        assert (
            g["battery_pct"] is None
        )  # driver 1.9.7 has no battery anywhere: the screen says "battery: unknown"
        assert all(not s["saturated"] for s in g["sensors"])
    # The app itself runs the simulator here, so the one step is to bring frames through the core and the bridge.
    assert {i["code"] for i in body["issues"]} == {"no_frames"}


def test_status_says_nobody_subscribed_when_only_definitions_arrive(
    client: TestClient,
) -> None:
    body = _replay_status(
        client,
        "worn_driver.rgmp.gz",
        definitions_only=True,
        wait_s=c.ROKOKO_SUBSCRIBE_GRACE_S + 0.5,
    )
    assert [g["streaming"] for g in body["gloves"]] == [False, False]
    assert [g["driver_fps"] for g in body["gloves"]] == [None, None]
    codes = [i["code"] for i in body["issues"]]
    assert codes == ["not_streaming"], codes
    assert (
        "not a glove fault" in body["issues"][0]["fix"]
        and "python -m core" in body["issues"][0]["fix"]
    )


def test_status_with_only_the_right_glove_names_the_missing_left(
    client: TestClient,
) -> None:
    body = _replay_status(client, "worn_driver.rgmp.gz", only=RIGHT_ID)
    left, right = body["gloves"]
    assert not left["connected"] and right["connected"] and right["streaming"]
    missing = next(i for i in body["issues"] if i["code"] == "glove_missing")
    assert (
        missing["side"] == "left"
        and not missing["blocking"]
        and "left glove" in missing["fix"]
    )


def test_shaken_slice_streams_without_false_saturation(client: TestClient) -> None:
    """The trimmed shaken slice moves hard but carries no saturation bit (see the flag tests above), so the status
    must not invent one; saturation by bit name is covered with a patched word in tests/test_rig.py."""
    body = _replay_status(client, "shaken_driver.rgmp.gz")
    assert all(g["streaming"] and g["driver_fps"] for g in body["gloves"])
    assert not [
        i for i in body["issues"] if i["code"] in ("saturation", "low_frame_rate")
    ], body["issues"]


def test_a_glove_that_drops_and_comes_back_returns_without_a_restart(
    client: TestClient,
) -> None:
    """Unplugging the left glove (the driver sends an RGMP disconnect) names it missing; plugging it back in (a fresh
    definition, then data) brings both gloves back on the same running app."""
    _replay_status(client, "worn_driver.rgmp.gz")
    rig = client.app.state.services.rig  # type: ignore[attr-defined]
    rig.tap.feed(struct.pack("<II", 3, 4) + struct.pack("<I", LEFT_ID))
    gone = client.get("/api/gloves/status").json()
    assert not gone["gloves"][0]["connected"] and gone["gloves"][1]["connected"]
    assert any(
        i["code"] == "glove_missing" and i["side"] == "left" for i in gone["issues"]
    )
    for typ, msg in _messages("worn_driver.rgmp.gz", only=LEFT_ID):
        if typ in (TYPE_DEFINITION, TYPE_DATA):
            rig.tap.feed(msg)
    back = client.get("/api/gloves/status").json()
    assert [g["connected"] for g in back["gloves"]] == [True, True]
    assert back["gloves"][0]["streaming"] is True
    assert not any(i["code"] == "glove_missing" for i in back["issues"])


def _solver_hand_frames() -> dict[tuple[str, str], tuple[np.ndarray, list[float]]]:
    """(side, phase) -> (flexion (n, 15) radians, wrist yaws in degrees), as the bridge would deliver them."""
    from app.services.rig import core_link
    from app.services.rig.calibration import wrist_yaw_deg

    core_link.rgmp()  # puts the repo root on sys.path
    from core import compat
    from core.clock import FakeClock
    from core.config import load_config
    from core.rgmp import GloveSource

    clock = FakeClock()
    src = GloveSource(load_config(), clock)
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    phase: dict[int, int] = {}
    rows: dict[tuple[str, str], tuple[list, list]] = {}
    for typ, msg in _messages("worn_solver.rgmp.gz"):
        dev = None
        if typ == TYPE_DATA:
            dev, _g, ts = struct.unpack_from("<IIQ", msg, 8)
            first.setdefault(dev, ts)
            if dev in last and ts - last[dev] > SEGMENT_GAP_US:
                phase[dev] = phase.get(dev, 0) + 1
            last[dev] = ts
            clock.set_us(1_700_000_000_000_000 + ts - first[dev])
        src.feed(msg)
        side = src.sides.get(dev) if dev is not None else None
        if side is None:
            continue
        hand, _ = src.poll(clock.now_us())[side]
        if hand is None:
            continue
        g = compat.hand_to_glove_hand(hand)
        flex, yaws = rows.setdefault((side, PHASES[phase.get(dev, 0)]), ([], []))
        flex.append([v for f in FINGERS for v in g["flexion"][f]])
        yaws.append(wrist_yaw_deg(g["wrist_quat"]))
    return {k: (np.array(f), y) for k, (f, y) in rows.items()}


def test_drift_check_on_real_hands_passes_when_still_and_fails_on_a_fist() -> None:
    from app.schemas.rig import WearerCalibration
    from app.services.rig.calibration import compare_drift, quality_of, summarise_hand

    hands = _solver_hand_frames()
    neutral, still, fist = [], {}, {}
    still_yaw, fist_yaw = {}, {}
    for side in ("left", "right"):
        flex, yaws = hands[(side, "flat")]
        half = len(flex) // 2
        neutral.append(summarise_hand(side, flex[:half], yaws[:half]))  # type: ignore[arg-type]
        still[side], still_yaw[side] = flex[half:], yaws[half:]
        fist[side], fist_yaw[side] = hands[(side, "fist")]
    quality = quality_of(neutral, 1.0)
    assert (
        quality.noise_deg is not None and quality.noise_deg < c.QUALITY_NOISE_GOOD_DEG
    )  # flat slice is still
    assert quality.grade == "good", (
        quality
    )  # a real flat hand is not zero flexion; the bias bands allow for it
    saved = WearerCalibration(
        id="replay",
        wearer="Replay",
        created_at="2026-11-14T00:00:00Z",
        neutral=neutral,
        quality=quality,
    )
    ok = compare_drift(saved, still, still_yaw)  # type: ignore[arg-type]
    assert ok.ok, ok
    curled = compare_drift(saved, fist, fist_yaw)  # type: ignore[arg-type]
    assert (
        not curled.ok
        and max(h.flex_drift_deg for h in curled.hands) > c.DRIFT_MAX_FLEX_DEG
    )
