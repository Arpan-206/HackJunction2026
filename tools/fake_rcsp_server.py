"""FAKE Rokoko driver, RCSP side only (TCP, 8-byte header plus JSON; core/rcsp.py).

Not real hardware. It lets the glove button and the ring LED run end to end
with no gloves: the core connects with `--rcsp`, finds two Smartgloves II,
subscribes, and sets LED colours. Every SetColorLed is written to a JSONL log.
Button presses are pushed on demand through a small control port: send one
line "right SinglePress" (or left, DoublePress, LongPress) and the server
sends a ButtonPushed event to every connected client.

    python -m tools.fake_rcsp_server --port 45451 --control-port 45452 --led-log logs/leds.jsonl
    printf 'right SinglePress\\n' | nc 127.0.0.1 45452

Device ids default to the real pair seen on Sat 14 Nov (left 3552246405,
right 291175775), so logs read the same as a real slot.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path

from core.rcsp import LED_COLOURS, T_COMMAND, T_EVENT, T_OK, RcspParser, pack

log = logging.getLogger("fake_rcsp")

LEFT_ID = 3552246405
RIGHT_ID = 291175775
PRESS_KINDS = ("SinglePress", "DoublePress", "LongPress")
COLOUR_NAMES = {tuple(v): k for k, v in LED_COLOURS.items()}


class FakeRcspServer:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 45451,
        control_port: int = 0,
        led_log: Path | None = None,
        left_id: int = LEFT_ID,
        right_id: int = RIGHT_ID,
    ) -> None:
        self.host = host
        self.port = port
        self.control_port = control_port
        self.led_log = Path(led_log) if led_log else None
        self.ids = {"left": int(left_id), "right": int(right_id)}
        self.leds: list[dict] = []
        self.commands: list[str] = []
        self.writers: list[asyncio.StreamWriter] = []
        self._server: asyncio.base_events.Server | None = None
        self._control: asyncio.base_events.Server | None = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self.host, self.port)
        self.port = self._server.sockets[0].getsockname()[1]
        if self.control_port is not None and self.control_port >= 0:
            self._control = await asyncio.start_server(
                self._handle_control, self.host, self.control_port
            )
            self.control_port = self._control.sockets[0].getsockname()[1]
        if self.led_log:
            self.led_log.parent.mkdir(parents=True, exist_ok=True)

    async def stop(self) -> None:
        for s in (self._server, self._control):
            if s is not None:
                s.close()
        for w in self.writers:
            w.close()

    def side_of(self, device_id: int) -> str | None:
        for side, did in self.ids.items():
            if did == device_id:
                return side
        return None

    async def push_button(self, side: str, kind: str = "SinglePress") -> int:
        """Send ButtonPushed for that glove to every client. Returns the client count."""
        body = {
            "Publisher": "DeviceEvents",
            "Topic": "ButtonPushed",
            "EventData": {"DeviceId": self.ids[side], "ButtonPushType": kind},
        }
        n = 0
        for w in list(self.writers):
            try:
                w.write(pack(T_EVENT, body))
                await w.drain()
                n += 1
            except (ConnectionError, RuntimeError):
                pass
        log.info("pushed %s %s to %d client(s)", side, kind, n)
        return n

    def _record_led(self, args: dict) -> None:
        did = int(args.get("DeviceId", -1))
        rgb = (int(args.get("Red", 0)), int(args.get("Green", 0)), int(args.get("Blue", 0)))
        rec = {
            "t": time.time(),
            "device_id": did,
            "side": self.side_of(did),
            "rgb": list(rgb),
            "colour": COLOUR_NAMES.get(rgb, "other"),
        }
        self.leds.append(rec)
        if self.led_log:
            with self.led_log.open("a") as f:
                f.write(json.dumps(rec) + "\n")

    def _reply(self, cmd: str, args: dict) -> dict:
        if cmd == "ListDevices":
            return {
                "Devices": [
                    {"DeviceId": did, "DeviceType": "Smartgloves II", "Connections": ["usb"]}
                    for did in self.ids.values()
                ]
            }
        if cmd == "GetDeviceInfo":
            did = int(args.get("DeviceId", -1))
            return {"DeviceId": did, "Smartgloves": {"IsLeft": did == self.ids["left"]}}
        if cmd == "SetColorLed":
            self._record_led(args)
        return {}

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.writers.append(writer)
        parser = RcspParser()
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                for mtype, body in parser.feed(data):
                    if mtype != T_COMMAND:
                        continue
                    cmd = str(body.get("Command"))
                    self.commands.append(cmd)
                    resp = self._reply(cmd, body.get("Arguments") or {})
                    writer.write(
                        pack(
                            T_OK,
                            {"TrackId": body.get("TrackId"), "Status": "Ok", "Version": 1, "Response": resp},
                        )
                    )
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            if writer in self.writers:
                self.writers.remove(writer)

    async def _handle_control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                parts = line.decode(errors="replace").split()
                if len(parts) == 2 and parts[0] in self.ids and parts[1] in PRESS_KINDS:
                    n = await self.push_button(parts[0], parts[1])
                    writer.write(f"ok {n}\n".encode())
                else:
                    writer.write(b"error: send 'left|right SinglePress|DoublePress|LongPress'\n")
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()


async def _main(a: argparse.Namespace) -> None:
    srv = FakeRcspServer(a.host, a.port, a.control_port, a.led_log, a.left_id, a.right_id)
    await srv.start()
    print(f"fake RCSP on {a.host}:{srv.port}, control on {a.host}:{srv.control_port}", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await srv.stop()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=45451)
    p.add_argument("--control-port", type=int, default=45452)
    p.add_argument("--led-log", type=Path, default=None, help="append each SetColorLed here as JSONL")
    p.add_argument("--left-id", type=int, default=LEFT_ID)
    p.add_argument("--right-id", type=int, default=RIGHT_ID)
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    try:
        asyncio.run(_main(a))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
