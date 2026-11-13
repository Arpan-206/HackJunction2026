import asyncio
import json

import pytest

from core.rcsp import HEADER, T_COMMAND, T_ERROR, T_EVENT, T_OK, GloveControl, RcspClient, RcspError, RcspParser, pack


class FakeRcspServer:
    def __init__(self):
        self.server = None
        self.port = 0
        self.writers = []
        self.leds = []

    async def start(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def stop(self):
        self.server.close()
        for w in self.writers:
            w.close()
        try:
            await asyncio.wait_for(self.server.wait_closed(), 1.0)
        except asyncio.TimeoutError:
            pass

    async def push_button(self, device_id, kind):
        for w in self.writers:
            w.write(pack(T_EVENT, {"Publisher": "DeviceEvents", "Topic": "ButtonPushed",
                                   "EventData": {"DeviceId": device_id, "ButtonPushType": kind}}))
            await w.drain()

    async def handle(self, reader, writer):
        self.writers.append(writer)
        p = RcspParser()
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                for mtype, body in p.feed(data):
                    assert mtype == T_COMMAND
                    cmd, tid = body["Command"], body["TrackId"]
                    args = body.get("Arguments", {})
                    if cmd == "ListDevices":
                        resp = {"Devices": [{"DeviceId": 7, "DeviceType": "Smartgloves II", "Connections": ["usb"]},
                                            {"DeviceId": 8, "DeviceType": "Smartgloves II", "Connections": ["usb"]}]}
                    elif cmd == "GetDeviceInfo":
                        resp = {"DeviceId": args["DeviceId"], "Smartgloves": {"IsLeft": args["DeviceId"] == 7}}
                    elif cmd == "SetColorLed":
                        self.leds.append((args["DeviceId"], args["Red"], args["Green"], args["Blue"]))
                        resp = {}
                    elif cmd in ("DeviceSubscribe", "Subscribe", "SubscribeToData", "ReinitAlgo"):
                        resp = {}
                    elif cmd == "Explode":
                        writer.write(pack(T_ERROR, {"TrackId": tid, "Status": "Error", "Version": 1,
                                                    "Error": {"Code": "UnknownCommand", "Message": "no"}}))
                        continue
                    else:
                        resp = {}
                    # an event may arrive between a command and its reply
                    if cmd == "Subscribe":
                        writer.write(pack(T_EVENT, {"Publisher": "DeviceEvents", "Topic": "Connected", "EventData": {"DeviceId": 7}}))
                    writer.write(pack(T_OK, {"TrackId": tid, "Status": "Ok", "Version": 1, "Response": resp}))
                await writer.drain()
        except (ConnectionResetError, asyncio.CancelledError):
            pass


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


def test_header_pack_and_parse():
    raw = pack(T_COMMAND, {"Command": "ListDevices", "TrackId": "1", "Version": 1})
    marker, version, hsize, mtype, length = HEADER.unpack_from(raw, 0)
    assert (marker, version, hsize, mtype) == (0xDC, 1, 8, 1) and length == len(raw) - 8
    p = RcspParser()
    out = p.feed(raw[:5]) + p.feed(raw[5:])
    assert out == [(1, {"Command": "ListDevices", "TrackId": "1", "Version": 1})]


async def test_client_and_glove_control():
    srv = FakeRcspServer()
    await srv.start()
    client = RcspClient("127.0.0.1", srv.port, reconnect_s=0.1)
    sess = StubSession()
    ctl = GloveControl(client, sess)
    await client.start()
    await asyncio.wait_for(client.connected.wait(), 2.0)
    for _ in range(50):
        if len(ctl.side_of) == 2 and srv.leds:
            break
        await asyncio.sleep(0.05)
    assert ctl.side_of == {7: "left", 8: "right"}
    assert ("device", "left", {"device_id": 7, "state": "connected"}) in sess.events
    assert srv.leds and srv.leds[0][1:] == (0, 60, 255)      # idle = blue
    with pytest.raises(RcspError):
        await client.command("Explode")
    await srv.push_button(8, "DoublePress")
    for _ in range(20):
        if sess.buttons:
            break
        await asyncio.sleep(0.05)
    assert sess.buttons == [("right", "DoublePress")]
    ctl.on_messages([{"type": "event", "name": "step_passed", "hand": "left", "data": {}}])
    await asyncio.sleep(0.1)
    assert (7, 0, 255, 0) in srv.leds
    await client.stop()
    await srv.stop()
