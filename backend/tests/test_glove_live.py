"""Opt-in tests against the real Rokoko Smartgloves II. Run with GLOVES_LIVE=1 and `-m hardware`.

    GLOVES_LIVE=1 uv run pytest -m hardware -v -s

Needs the Rokoko Device SDK driver (rokoko-sdk.exe: RGMP 12276, RCSP 45451) and the rkk-hand-solver (RGMP 12277)
running with both gloves plugged in. For a one-glove run set GLOVES_EXPECT=right (or left; default both):

    GLOVES_LIVE=1 GLOVES_EXPECT=right uv run pytest -m hardware -v -s

Nothing here changes glove settings; it only lists devices and subscribes to data (the driver streams nothing otherwise). The "still"
test needs the gloves resting on a table.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import pytest

from tests import glove_live as live
from tests.rgmp_reader import Capture

pytestmark = [
    pytest.mark.hardware,
    pytest.mark.skipif(
        not live.live_enabled(),
        reason="set GLOVES_LIVE=1 to run tests against real gloves",
    ),
]

_EXPECT = {"both": {"left", "right"}, "left": {"left"}, "right": {"right"}}
_expect = os.environ.get("GLOVES_EXPECT", "both").strip().lower() or "both"
if _expect not in _EXPECT:
    raise ValueError(f"GLOVES_EXPECT must be both, left or right, got {_expect!r}")
HANDS = _EXPECT[_expect]
RATE_WINDOW_S = 5.0


def _devices_by_hand(cap: Capture) -> dict[str, int]:
    by_hand = {d["device_info"]["hand"]: dev for dev, d in cap.definitions.items()}
    missing = HANDS - set(by_hand)
    assert not missing, f"expected gloves {sorted(HANDS)}, no stream for {sorted(missing)}"
    return {hand: by_hand[hand] for hand in sorted(HANDS)}


@pytest.fixture(scope="module")
def streams():
    with (
        live.StreamSubscription()
    ):  # the driver sends data only while an RCSP client has subscribed
        driver, solver = live.record_both(RATE_WINDOW_S)
    return driver, solver


@pytest.fixture(scope="module")
def driver_capture(streams) -> Capture:
    return streams[0].capture()


# ---------------------------------------------------------------- connections


@pytest.mark.parametrize(
    "name,port",
    [
        ("RGMP driver", live.RGMP_PORT),
        ("RCSP", live.RCSP_PORT),
        ("hand solver RGMP", live.SOLVER_PORT),
    ],
)
def test_port_reachable(name, port):
    assert live.port_open(port), f"{name} is not listening on 127.0.0.1:{port}"


def test_rcsp_lists_both_gloves(record_property):
    """RCSP lists exactly the expected gloves (GLOVES_EXPECT), on the expected sides."""
    reply = live.rcsp_command("ListDevices")
    record_property("ListDevices", reply)
    print("\nRCSP ListDevices reply:", reply)
    devices = reply["Response"]["Devices"]
    assert len(devices) == len(HANDS), f"expected gloves {sorted(HANDS)}, RCSP lists {len(devices)} devices"
    for d in devices:
        assert {
            "DeviceId",
            "DeviceType",
            "Connections",
            "IsBootloader",
            "Updatable",
        } <= set(d)
        assert d["DeviceType"] == "Smartgloves"
        assert d["IsBootloader"] is False
    sides = {}
    for d in devices:
        info = live.rcsp_command("GetDeviceInfo", {"DeviceId": d["DeviceId"]})[
            "Response"
        ]
        print(f"RCSP GetDeviceInfo {d['DeviceId']} keys:", sorted(info))
        sides[d["DeviceId"]] = "left" if info["Smartgloves"]["IsLeft"] else "right"
    assert set(sides.values()) == HANDS, f"expected gloves {sorted(HANDS)}, RCSP sides {sorted(sides.values())}"
    # battery is not part of the RCSP commands of driver 1.9.7; if a future driver adds it, it must be a percentage
    for d in devices:
        info = live.rcsp_command("GetDeviceInfo", {"DeviceId": d["DeviceId"]})[
            "Response"
        ]
        for key, value in {**d, **info}.items():
            if "batter" in key.lower() and isinstance(value, (int, float)):
                assert 0 <= value <= 100, f"{key}={value}"


def test_rcsp_sides_match_rgmp_definitions(driver_capture):
    ids = {}
    for d in live.rcsp_command("ListDevices")["Response"]["Devices"]:
        info = live.rcsp_command("GetDeviceInfo", {"DeviceId": d["DeviceId"]})[
            "Response"
        ]
        ids[d["DeviceId"]] = "left" if info["Smartgloves"]["IsLeft"] else "right"
    rgmp = {
        dev: d["device_info"]["hand"] for dev, d in driver_capture.definitions.items()
    }
    assert rgmp == ids


# ---------------------------------------------------------------- stream health


def test_definitions_arrive_for_both_hands_within_3s(streams):
    """Definitions for the expected gloves (GLOVES_EXPECT) arrive on driver and solver within 3 s."""
    driver, solver = streams
    for label, rec in (("driver", driver), ("solver", solver)):
        assert len(rec.definition_at) == len(HANDS), (
            f"{label}: definitions for {sorted(rec.definition_at)}, expected gloves {sorted(HANDS)}"
        )
        assert max(rec.definition_at.values()) < 3.0, f"{label}: {rec.definition_at}"
    cap = driver.capture()
    assert {d["device_info"]["hand"] for d in cap.definitions.values()} == HANDS
    assert all(d["device_type"] == "Smartgloves II" for d in cap.definitions.values())
    assert all(
        sum(len(g["streams"]) for g in d["groups"]) == 49
        for d in cap.definitions.values()
    )


def test_each_glove_streams_at_least_90_percent_of_expected_rate(
    streams, driver_capture
):
    driver, _ = streams
    for dev in _devices_by_hand(driver_capture).values():
        d = driver_capture.definitions[dev]
        for gi, group in enumerate(d["groups"]):
            n = sum(1 for _t, dv, g, _ts in driver.arrivals if dv == dev and g == gi)
            rate = n / driver.seconds
            want = 0.9 * group["expected_rate_hz"]
            print(
                f"{d['device_info']['hand']} {group['name']}: {rate:.1f} Hz (need >= {want:.1f})"
            )
            assert rate >= want, (
                f"{d['device_info']['hand']} {group['name']}: {rate:.1f} Hz < {want:.1f}"
            )


def test_solver_streams_both_hands_at_expected_rate(streams):
    """The solver streams every expected glove (GLOVES_EXPECT) at 90 percent of its expected rate or better."""
    _, solver = streams
    cap = solver.capture()
    for dev in _devices_by_hand(cap).values():
        d = cap.definitions[dev]
        for gi, group in enumerate(d["groups"]):
            n = sum(1 for _t, dv, g, _ts in solver.arrivals if dv == dev and g == gi)
            assert n / solver.seconds >= 0.9 * group["expected_rate_hz"], (
                f"{d['device_info']['hand']} {group['name']}"
            )


def test_frame_age_stays_under_100ms(streams, driver_capture):
    """Device clocks are not host clocks, so age is the transport delay above the fastest frame of the window."""
    driver, _ = streams
    for dev in _devices_by_hand(driver_capture).values():
        ages = sorted(driver.frame_ages_s(dev))
        p99, worst = ages[int(len(ages) * 0.99)], ages[-1]
        print(
            f"{driver_capture.definitions[dev]['device_info']['hand']}: p99 age {p99 * 1000:.1f} ms, max {worst * 1000:.1f} ms"
        )
        assert p99 < 0.100
        assert worst < 0.250


def test_timestamps_increase_per_group(streams):
    driver, _ = streams
    last: dict[tuple[int, int], int] = {}
    for _t, dev, grp, ts in driver.arrivals:
        assert ts > last.get((dev, grp), -1), (
            f"time went backwards on device {dev} group {grp}"
        )
        last[(dev, grp)] = ts


def test_no_coil_pro_dependency(driver_capture, streams):
    """Finger data must not need the coil_pro frame: finger sensor streams and the solver output are hub based."""
    for d in driver_capture.definitions.values():
        for g in d["groups"]:
            for s in g["streams"]:
                if str(s.get("target_frame", "")).endswith("_finger_sensor"):
                    assert s.get("reference_frame") != "coil_pro", (
                        f"{s['measure_type']} {s['target_frame']}"
                    )
    for d in streams[1].capture().definitions.values():
        assert "coil_pro" not in str(d["groups"])
    app = Path(__file__).resolve().parent.parent / "app"
    offenders = [
        str(p) for p in app.rglob("*.py") if "coil_pro" in p.read_text(encoding="utf-8")
    ]
    assert not offenders, offenders


def test_rokoko_studio_is_not_running():
    names = [n.lower() for n in live.running_processes()]
    studio = [n for n in names if "rokoko studio" in n or "rokokostudio" in n]
    assert not studio, f"close Rokoko Studio, it holds the devices: {studio}"


def test_still_gloves_have_low_gyro_noise():
    """Keep the gloves resting on a table for this test."""
    with live.StreamSubscription():
        rec = live.record(live.RGMP_PORT, 2.0)
    cap = rec.capture()
    for hand, dev in _devices_by_hand(cap).items():
        layout = cap.layout(dev)[0]
        idx = [
            i
            for i, s in enumerate(layout)
            if s.measure_type == "ANGULAR_VELOCITY"
            and s.target_frame.endswith("_finger_imu")
        ]
        mags = sorted(
            math.sqrt(sum(x * x for x in f.values[i]))
            for f in cap.device_frames(dev, 0)
            for i in idx
        )
        median, p99 = mags[len(mags) // 2], mags[int(len(mags) * 0.99)]
        print(
            f"{hand}: gyro median {median:.4f} rad/s, p99 {p99:.4f} rad/s over {len(mags)} samples"
        )
        assert median < 0.1, (
            f"{hand} glove is moving or its gyro is noisy: median {median:.3f} rad/s"
        )
        assert p99 < 0.5, f"{hand} glove is moving: p99 {p99:.3f} rad/s"
