"""Glove status, fix steps, the driver tap on a real capture, per-wearer calibration and demo mode's drift check.

The driver capture is the shared `fixtures/rgmp/worn_driver.rgmp.gz` (both Smartgloves II worn, 14 Nov 2026, driver
1.9.7, firmware 3.4.0). Nothing here touches a real port or process: the rig service's probes are replaced. Replays of
the status, fix steps and drift check through the API live in test_glove_rgmp_replay.py.
"""

import gzip
import math
import struct
from pathlib import Path

import numpy as np
import pytest
from app import constants as c
from app.schemas.rig import GloveDeviceStatus, SensorStatus, WearerCalibration
from app.services.rig import core_link
from app.services.rig.calibration import (
    compare_drift,
    quality_of,
    summarise_hand,
    wrist_yaw_deg,
)
from app.services.rig.diagnosis import (
    RigSnapshot,
    connection_name,
    decode_flags,
    device_connection,
    diagnose,
    find_battery,
    is_ready,
    parse_tasklist_csv,
    sensor_name,
    sensor_statuses,
    side_from_info,
)
from app.services.rig.monitor import DriverTap, RateMeter, rcsp_device
from fastapi.testclient import TestClient

# The e2e tester's trimmed real capture (eight 0.3 s slices of a worn session); see scripts/make_rgmp_fixture.py.
FIXTURE = Path(__file__).parent / "fixtures" / "rgmp" / "worn_driver.rgmp.gz"
LEFT_ID, RIGHT_ID = 1572077328, 2811174587

# Shapes exactly as the real driver answered over RCSP (scratchpad captures of 14 Nov 2026).
LISTED = {
    "Connections": ["Serial"],
    "DeviceId": RIGHT_ID,
    "DeviceType": "Smartgloves",
    "IsBootloader": False,
    "Updatable": True,
}
INFO = {
    "DeviceType": "Smartgloves",
    "FwVersion": {"Build": 114, "Major": 3, "Minor": 4, "Patch": 0},
    "Smartgloves": {"IsLeft": False},
}


# ---- parsing what the driver sends ----


def test_rcsp_device_reads_the_real_list_and_info_shapes() -> None:
    dev = rcsp_device(LISTED, INFO)
    assert dev.side == "right"
    assert connection_name(dev.connection) == "usb"
    assert dev.battery_pct is None


def test_connection_names_cover_the_documented_values() -> None:
    assert [
        connection_name(x) for x in ("Serial", "UDP", "Emulated", "Unknown", None)
    ] == ["usb", "wifi", "emulated", "unknown", None]
    assert device_connection({"ConnectionType": "UDP"}) == "UDP"
    assert device_connection({"Connections": ["Serial", "UDP"]}) == "Serial"


def test_battery_is_found_anywhere_or_unknown() -> None:
    assert find_battery(INFO) is None
    assert find_battery({"Status": {"BatteryLevel": 0.42}}) == 42.0
    assert find_battery({"battery_pct": 87}) == 87.0
    assert find_battery({"Battery": True}) is None


def test_side_from_rcsp_info_and_rgmp_device_info() -> None:
    assert side_from_info({"Smartgloves": {"IsLeft": True}}) == "left"
    assert (
        side_from_info({"hand": "right", "friendly_name": "Smartgloves II (right)"})
        == "right"
    )
    assert side_from_info({"is_right_glove": False}) == "left"
    assert side_from_info({}) is None


def test_flags_decode_by_name_not_position() -> None:
    hub = {
        "11": "is_heading_reliable",
        "2": "is_magnetometer_saturated",
        "4": "is_accelerometer_saturated",
    }
    flags = decode_flags(hub, (1 << 11) | (1 << 2))
    assert flags == {
        "is_heading_reliable": True,
        "is_magnetometer_saturated": True,
        "is_accelerometer_saturated": False,
    }
    # The same name on another bit, as the emf_only group does, still decodes.
    assert decode_flags({"0": "is_emf_saturated"}, 1) == {"is_emf_saturated": True}


def test_sensor_names_and_statuses() -> None:
    assert [
        sensor_name(f)
        for f in (
            "thumb_finger_sensor",
            "little_finger_imu",
            "arm_sensor",
            "hub",
            "hub_imu",
            "xr_base",
        )
    ] == ["thumb", "little", "arm", "hub", "hub", None]
    sensors = sensor_statuses({"index": ["gyroscope"]}, ["EMF sensor"])
    assert [s.name for s in sensors] == list(c.GLOVE_SENSOR_NAMES)
    assert next(s for s in sensors if s.name == "index").saturated == ["gyroscope"]
    assert next(s for s in sensors if s.name == "hub").saturated == ["EMF sensor"]


def test_tasklist_parsing() -> None:
    text = '"System Idle Process","0","Services","0","8 K"\r\n"Rokoko Studio.exe","4242","Console","1","300,000 K"\r\n'
    assert parse_tasklist_csv(text) == {"system idle process", "rokoko studio.exe"}


# ---- the driver tap on the real capture ----


class Clock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def _frames(data: bytes) -> list[bytes]:
    """Split a raw capture into its RGMP messages."""
    out, i = [], 0
    while i + 8 <= len(data):
        _, ln = struct.unpack_from("<II", data, i)
        out.append(data[i : i + 8 + ln])
        i += 8 + ln
    return out


def _feed_paced(tap: DriverTap, clock: Clock, messages: list[bytes]) -> None:
    """Feed each message, advancing the clock as the first glove's timestamps advance.

    The fixture is cut into slices; the cuts are closed up (at most one frame period) so it plays as one live stream.
    """
    last: dict[int, int] = {}
    lead: int | None = None
    for msg in messages:
        prefix, _ = struct.unpack_from("<II", msg, 0)
        if prefix == 2:
            dev, _, ts = struct.unpack_from("<IIQ", msg, 8)
            lead = dev if lead is None else lead
            if dev == lead:
                clock.t += min(ts - last.get(dev, ts), 13_000) / 1e6
            last[dev] = ts
        tap.feed(msg)


@pytest.fixture
def worn() -> list[bytes]:
    return _frames(gzip.decompress(FIXTURE.read_bytes()))


def test_tap_reads_both_real_gloves_at_the_driver_rate(worn: list[bytes]) -> None:
    clock = Clock()
    tap = DriverTap(lambda h, p: False, clock=clock)
    _feed_paced(tap, clock, worn)
    left, right = tap.by_side("left"), tap.by_side("right")
    assert left is not None and left.device_id == LEFT_ID
    assert right is not None and right.device_id == RIGHT_ID
    for dev in (left, right):
        # Two groups at 83.33 Hz each reach the socket; only the default group counts.
        assert 75 <= (dev.meter.fps() or 0) <= 90
        assert dev.saturation() == {}
        assert dev.heading is not None
        assert dev.battery_pct is None


def test_tap_finds_saturation_by_bit_name(worn: list[bytes]) -> None:
    rgmp = core_link.rgmp()
    assert rgmp is not None
    parser = rgmp.RgmpParser()
    clock = Clock()
    tap = DriverTap(lambda h, p: False, clock=clock)
    patched: list[bytes] = []
    done = False
    for msg in worn:
        parsed = parser.feed(msg)
        if not done and parsed and parsed[0][0] == "data":
            frame = parsed[0][1]
            stream = next(
                (
                    s
                    for s in frame.group.streams
                    if s.measure_type == "STATUS_FLAGS"
                    and s.target_frame == "index_finger_sensor"
                ),
                None,
            )
            if (
                frame.device_id == RIGHT_ID
                and frame.group.index == 0
                and stream is not None
            ):
                bit = next(
                    int(b)
                    for b, n in stream.raw["bit_mapping"].items()
                    if n == "is_gyroscope_saturated"
                )
                at = 8 + 16 + stream.offset
                word = struct.unpack_from("<I", msg, at)[0] | (1 << bit)
                msg = msg[:at] + struct.pack("<I", word) + msg[at + 4 :]
                done = True
        patched.append(msg)
    assert done
    _feed_paced(tap, clock, patched)
    right = tap.by_side("right")
    assert right is not None and right.saturation() == {"index": ["gyroscope"]}
    assert tap.by_side("left").saturation() == {}  # type: ignore[union-attr]
    clock.t += c.GLOVE_SATURATION_EVENT_HOLD_S + 1
    assert right.saturation() == {}


def test_rate_meter() -> None:
    meter = RateMeter(window_s=2.0)
    for i in range(121):
        meter.tick(10.0 + i / 60)
    assert meter.fps(12.0) == pytest.approx(60.0, abs=0.5)
    assert meter.age_s(12.5) == pytest.approx(0.5, abs=0.01)
    assert meter.fps(20.0) is None


# ---- fix steps ----


def _glove(side: str, **kw: object) -> GloveDeviceStatus:
    base = {
        "connected": True,
        "connection": "usb",
        "fps": 60.0,
        "driver_fps": 83.3,
        "last_frame_age_ms": 15.0,
        "sensors": [SensorStatus(name=n) for n in c.GLOVE_SENSOR_NAMES],
    }
    return GloveDeviceStatus(side=side, **{**base, **kw})  # type: ignore[arg-type]


def _snap(**kw: object) -> RigSnapshot:
    base = {
        "source": "external",
        "studio_running": False,
        "driver_port_open": True,
        "driver_process": True,
        "solver_port_open": True,
        "rcsp_connected": True,
        "can_start": True,
        "gloves": [_glove("left"), _glove("right")],
        "driver_lines": [],
    }
    return RigSnapshot(**{**base, **kw})  # type: ignore[arg-type]


def codes(s: RigSnapshot) -> list[str]:
    return [i.code for i in diagnose(s)]


def test_all_well_has_no_fix_steps() -> None:
    s = _snap()
    assert codes(s) == []
    assert is_ready(s.gloves, diagnose(s))


def test_driver_not_running_says_start_it() -> None:
    issues = diagnose(
        _snap(
            driver_port_open=False,
            driver_process=False,
            rcsp_connected=False,
            solver_port_open=False,
            gloves=[_glove("left", connected=False), _glove("right", connected=False)],
        )
    )
    assert [i.code for i in issues] == ["driver_not_running"]
    assert (
        "rokoko-sdk --auto-stream-usb" in issues[0].fix
        and "Start the gloves" in issues[0].fix
    )
    assert not is_ready([], issues)


def test_studio_comes_first_and_busy_driver_says_close_studio() -> None:
    issues = diagnose(
        _snap(
            studio_running=True,
            driver_lines=["ERROR open: Access is denied. (os error 5)"],
            gloves=[_glove("left", connected=False), _glove("right", connected=False)],
        )
    )
    assert [i.code for i in issues][:2] == ["studio_running", "device_busy"]
    assert "Close Rokoko Studio" in issues[0].fix
    assert "Close Studio" in issues[1].fix


def test_solver_missing() -> None:
    issues = diagnose(_snap(solver_port_open=False))
    assert issues[0].code == "solver_not_running" and "--no-driver" in issues[0].fix
    assert "--listen 127.0.0.1:12277" in issues[0].fix and issues[0].blocking
    # Gloves seen by the driver are not blamed while only the solver is missing.
    assert [i.code for i in issues] == ["solver_not_running"]


def test_solver_command_serves_both_groups_on_12277() -> None:
    from app.services.rig.processes import solver_command

    alone = solver_command(Path("bin"), with_driver=False)
    assert (
        alone[-1] == "--no-driver"
        and alone[alone.index("--listen") + 1] == "127.0.0.1:12277"
    )
    assert alone[alone.index("--emit") + 1] == "both" and "--emit-openxr" in alone
    with_driver = solver_command(Path("bin"), with_driver=True)
    assert (
        "--no-driver" not in with_driver
        and with_driver[with_driver.index("--driver-arg") + 1] == "--auto-stream-usb"
    )


def test_no_usb_devices_says_reconnect_or_try_another_cable() -> None:
    issues = diagnose(
        _snap(
            gloves=[_glove("left", connected=False), _glove("right", connected=False)]
        )
    )
    assert [i.code for i in issues] == ["no_usb_devices"]
    assert "another cable" in issues[0].fix


def test_one_glove_names_the_missing_hand() -> None:
    issues = diagnose(_snap(gloves=[_glove("left"), _glove("right", connected=False)]))
    assert [(i.code, i.side) for i in issues] == [("glove_missing", "right")]
    assert "right glove" in issues[0].title
    assert is_ready([_glove("left")], issues)


def test_low_frame_rate_mentions_battery_or_wifi() -> None:
    issues = diagnose(
        _snap(
            gloves=[_glove("left", driver_fps=31.0, connection="wifi"), _glove("right")]
        )
    )
    assert [(i.code, i.side) for i in issues] == [("low_frame_rate", "left")]
    assert "battery" in issues[0].fix and "Wi-Fi" in issues[0].fix


def test_saturation_and_an_unsettled_heading_raise_no_issue() -> None:
    sensors = [
        SensorStatus(name="index", saturated=["gyroscope"]),
        SensorStatus(name="hub", saturated=["magnetometer"]),
    ]
    issues = diagnose(
        _snap(
            gloves=[
                _glove("left", heading_reliable=False),
                _glove("right", sensors=sensors),
            ]
        )
    )
    assert issues == []


def test_unsubscribed_gloves_are_not_a_glove_fault() -> None:
    idle = {
        "streaming": False,
        "driver_fps": None,
        "fps": None,
        "last_frame_age_ms": None,
    }
    issues = diagnose(_snap(gloves=[_glove("left", **idle), _glove("right", **idle)]))
    assert [i.code for i in issues] == ["not_streaming"]
    assert issues[0].side is None and "not a glove fault" in issues[0].fix
    one = diagnose(
        _snap(gloves=[_glove("left", connected=False), _glove("right", **idle)])
    )
    assert [i.code for i in one] == ["glove_missing", "not_streaming"] and one[
        1
    ].side == "right"


def test_tap_tells_definitions_without_data_from_streaming(worn: list[bytes]) -> None:
    clock = Clock()
    tap = DriverTap(lambda h, p: False, clock=clock)
    for msg in worn:
        if struct.unpack_from("<I", msg, 0)[0] == 1:
            tap.feed(msg)
    right = tap.by_side("right")
    assert right is not None and right.streaming() is None  # too early to say
    clock.t += c.ROKOKO_SUBSCRIBE_GRACE_S
    assert right.streaming() is False and right.meter.fps() is None
    _feed_paced(tap, clock, worn)
    assert tap.by_side("right").streaming() is True  # type: ignore[union-attr]


def test_no_frames_reaching_the_app_points_at_core_and_bridge() -> None:
    issues = diagnose(
        _snap(
            gloves=[_glove("left", fps=None, last_frame_age_ms=None), _glove("right")]
        )
    )
    assert (
        issues[0].code == "no_frames"
        and "ingest_bridge" in issues[0].fix
        and issues[0].blocking
    )


# ---- calibration maths ----


def _yaw_quat(deg: float) -> list[float]:
    h = math.radians(deg) / 2
    return [0.0, math.sin(h), 0.0, math.cos(h)]


def test_wrist_yaw() -> None:
    assert wrist_yaw_deg([0, 0, 0, 1]) == pytest.approx(0.0)
    assert wrist_yaw_deg(_yaw_quat(30)) == pytest.approx(30.0)
    assert wrist_yaw_deg(_yaw_quat(-170)) == pytest.approx(-170.0)


def _neutral(
    side: str = "right",
    flex_deg: float = 4.0,
    noise_deg: float = 0.3,
    yaw: float = 10.0,
    n: int = 90,
):
    rng = np.random.default_rng(1)
    flex = np.radians(flex_deg + rng.normal(0, noise_deg, size=(n, 15)))
    return summarise_hand(side, flex, [yaw + float(x) for x in rng.normal(0, 1.0, n)])  # type: ignore[arg-type]


def test_neutral_summary_and_quality_reading() -> None:
    hand = _neutral()
    assert hand.yaw_zero_deg == pytest.approx(10.0, abs=0.5)
    assert hand.noise_deg == pytest.approx(0.3, abs=0.1)
    assert math.degrees(hand.offsets["index"][0]) == pytest.approx(4.0, abs=0.3)
    good = quality_of([hand], 0.97)
    assert good.grade == "good" and good.notes == []
    shaky = quality_of([_neutral(noise_deg=5.0)], None)
    assert (
        shaky.grade == "poor"
        and shaky.heading_reliable is None
        and "still" in shaky.notes[0]
    )
    unreliable = quality_of([hand], 0.5)
    assert unreliable.grade == "good" and unreliable.notes == []
    assert unreliable.heading_reliable == 0.5


def _saved(hand) -> WearerCalibration:
    return WearerCalibration(
        id="cal1",
        wearer="Ada",
        created_at="2026-11-14T10:00:00+00:00",
        neutral=[hand],
        quality=quality_of([hand], None),
    )


def test_drift_check_passes_when_still_and_fails_when_moved() -> None:
    hand = _neutral()
    live = {"right": np.radians(np.full((60, 15), 4.5))}
    ok = compare_drift(_saved(hand), live, {"right": [11.0] * 60})  # type: ignore[arg-type]
    assert ok.ok and ok.max_flex_deg == c.DRIFT_MAX_FLEX_DEG
    bent = compare_drift(
        _saved(hand),
        {"right": np.radians(np.full((60, 15), 20.0))},
        {"right": [10.0] * 60},
    )  # type: ignore[arg-type]
    assert not bent.ok and "Recalibrate" in bent.message
    turned = compare_drift(_saved(hand), live, {"right": [40.0] * 60})  # type: ignore[arg-type]
    assert not turned.ok and "heading" in turned.message


# ---- API ----


@pytest.fixture
def rig_client(client: TestClient) -> TestClient:
    """The app with the rig's port and process probes replaced: nothing runs, no Studio."""
    rig = client.app.state.services.rig  # type: ignore[attr-defined]
    rig.port_open = lambda host, port: False
    rig.process_names = lambda: set()
    return client


def test_status_endpoint_reports_a_stopped_driver(rig_client: TestClient) -> None:
    body = rig_client.get("/api/gloves/status").json()
    assert body["source"] == "simulator" and not body["ready"]
    assert [g["side"] for g in body["gloves"]] == ["left", "right"]
    assert (
        body["gloves"][0]["fps"] is None
    )  # simulator frames never count as glove frames
    assert body["issues"][0]["code"] == "driver_not_running"
    assert body["driver"]["managed"] is False


def test_status_endpoint_sees_studio(rig_client: TestClient) -> None:
    rig = rig_client.app.state.services.rig  # type: ignore[attr-defined]
    rig.process_names = lambda: {"rokoko studio.exe"}
    rig._probe = None
    body = rig_client.get("/api/gloves/status").json()
    assert body["issues"][0]["code"] == "studio_running"
    started = rig_client.post("/api/gloves/driver", json={"action": "start"})
    assert started.status_code == 409


def test_reinit_without_driver_touches_nothing(rig_client: TestClient) -> None:
    assert rig_client.post("/api/gloves/reinit").json() == {"devices": 0}


def test_wearer_calibration_round_trip_and_drift_check(rig_client: TestClient) -> None:
    neutral = rig_client.post(
        "/api/gloves/calibrations/neutral",
        json={"wearer": "  Ada  Lovelace ", "duration_s": 0.4},
    )
    assert neutral.status_code == 200, neutral.text
    cal = neutral.json()
    assert cal["wearer"] == "Ada Lovelace" and {h["side"] for h in cal["neutral"]} == {
        "left",
        "right",
    }
    assert (
        cal["quality"]["grade"] in ("good", "fair", "poor") and cal["reinit"] is False
    )

    flat = rig_client.post(
        "/api/calibrations", json={"side": "right", "phase": "flat", "duration_s": 0.2}
    ).json()
    fist = rig_client.post(
        "/api/calibrations", json={"side": "right", "phase": "fist", "duration_s": 0.2}
    ).json()
    done = rig_client.post(
        f"/api/gloves/calibrations/{cal['id']}/finish",
        json={"range_calibration_ids": {"right": fist["id"]}, "verified": True},
    ).json()
    assert (
        done["range_calibration_ids"] == {"right": fist["id"]}
        and done["verified"] is True
    )
    assert flat["side"] == "right"
    wrong = rig_client.post(
        f"/api/gloves/calibrations/{cal['id']}/finish",
        json={"range_calibration_ids": {"left": fist["id"]}},
    )
    assert wrong.status_code == 400

    latest = rig_client.get(
        "/api/gloves/calibrations/latest", params={"wearer": "ada lovelace"}
    ).json()
    assert latest["id"] == cal["id"]
    assert [c_["id"] for c_ in rig_client.get("/api/gloves/calibrations").json()] == [
        cal["id"]
    ]

    drift = rig_client.post(
        "/api/gloves/drift_check", json={"wearer": "Ada Lovelace", "duration_s": 0.3}
    ).json()
    assert drift["ok"] is True and drift["calibration_id"] == cal["id"]
    assert (
        rig_client.post(
            "/api/gloves/drift_check", json={"wearer": "Nobody"}
        ).status_code
        == 404
    )


def test_neutral_capture_validates_the_wearer(rig_client: TestClient) -> None:
    assert (
        rig_client.post(
            "/api/gloves/calibrations/neutral", json={"wearer": "   "}
        ).status_code
        == 422
    )
    assert (
        rig_client.post(
            "/api/gloves/calibrations/neutral", json={"wearer": "x" * 41}
        ).status_code
        == 422
    )
