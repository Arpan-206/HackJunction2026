"""tools/fake_rcsp_server.py: the core's real RCSP client finds both gloves, LEDs are logged, the control port presses buttons."""

import asyncio
import json

from core.rcsp import GloveControl, RcspClient
from tools.fake_rcsp_server import LEFT_ID, RIGHT_ID, FakeRcspServer


class StubSession:
    def __init__(self):
        self.buttons = []
        self.events = []
        self.hands = {}
        self.recorder = type("R", (), {"active": False, "master_hand": "right"})()

    def handle_button(self, side, press):
        self.buttons.append((side, press))

    def emit_event(self, name, hand, data):
        self.events.append((name, hand, data))


async def _until(pred, seconds=3.0):
    for _ in range(int(seconds / 0.05)):
        if pred():
            return True
        await asyncio.sleep(0.05)
    return pred()


async def test_core_client_against_fake_driver(tmp_path):
    led_log = tmp_path / "leds.jsonl"
    srv = FakeRcspServer(port=0, control_port=0, led_log=led_log)
    await srv.start()
    client = RcspClient("127.0.0.1", srv.port, reconnect_s=0.1)
    sess = StubSession()
    ctl = GloveControl(client, sess)
    await client.start()
    try:
        assert await _until(lambda: len(ctl.side_of) == 2 and len(srv.leds) >= 2)
        assert ctl.side_of == {LEFT_ID: "left", RIGHT_ID: "right"}
        assert {r["colour"] for r in srv.leds} == {"idle"}
        assert {r["side"] for r in srv.leds} == {"left", "right"}
        logged = [json.loads(x) for x in led_log.read_text().splitlines()]
        assert len(logged) == len(srv.leds)

        reader, writer = await asyncio.open_connection("127.0.0.1", srv.control_port)
        writer.write(b"right SinglePress\n")
        await writer.drain()
        assert (await reader.readline()).startswith(b"ok 1")
        writer.write(b"middle Press\n")
        await writer.drain()
        assert (await reader.readline()).startswith(b"error")
        writer.close()
        assert await _until(lambda: sess.buttons == [("right", "SinglePress")])

        sess.recorder.active = True
        await ctl.update_leds()
        assert await _until(lambda: srv.leds[-1]["colour"] == "recording")
        assert srv.leds[-1]["side"] == "right"
    finally:
        await client.stop()
        await srv.stop()
