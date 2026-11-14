"""Glove slot kit: walk through the next glove slot step by step and log every result.

Run it with scripts/slot/run.sh (see that file and docs/SLOT-KIT.md).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
for p in (str(HERE), str(REPO)):
    if p not in sys.path:
        sys.path.insert(0, p)

from slot_links import Trace, http, port_open  # noqa: E402
from slot_log import Console, Result, RunLog  # noqa: E402
from slot_steps import STEPS, Ctx, Options  # noqa: E402

DRY = {"depth_seconds": 6.0, "hold_seconds": 1.5, "mirror_seconds": 4.0, "duel_seconds": 8.0,
       "piano_cue_seconds": 1.0, "pose_seconds": 1.0, "freeze_seconds": 1.5, "move_seconds": 2.0}


def read_lessons(path: Path) -> list[str]:
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def parse_steps(spec: str) -> set[int]:
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        elif part:
            out.add(int(part))
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="scripts/slot/run.sh", description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="no gloves, no phone: start a fake core, backend, bridge and phone and run every step")
    p.add_argument("--wearer", default=os.environ.get("SLOT_WEARER", "arpan"), help="wearer name for calibration (default arpan)")
    p.add_argument("--only", default="", help="steps to run, e.g. 2,3 or 4-6 (step 0, the stack check, always runs)")
    p.add_argument("--from", dest="start", type=int, default=1, help="first step to run (default 1)")
    p.add_argument("--core-port", type=int, default=int(os.environ.get("GEPPETTO_CORE_PORT", "8765")))
    p.add_argument("--backend", default="http://127.0.0.1:8000", help="backend base URL")
    p.add_argument("--depth-host", default="", help="phone address; default 127.0.0.1 if forward.sh runs, else config.toml")
    p.add_argument("--depth-port", type=int, default=0, help="phone port; default config.toml [camera.geppetto_depth]")
    p.add_argument("--depth-seconds", type=float, default=None, help="depth clip length (default 40, dry run 6)")
    p.add_argument("--depth-check", default=os.environ.get("SLOT_DEPTH_CHECK", "python -m tools.depth_check {file}"),
                   help="command run on the clip; {file} is replaced; skipped cleanly if its module is missing")
    p.add_argument("--hold-seconds", type=float, default=None, help="each calibration hold (default 3, dry run 1.5)")
    p.add_argument("--takes", type=int, default=3)
    p.add_argument("--pose-seconds", type=float, default=3.0, help="step 8: time to get into the pose")
    p.add_argument("--freeze-seconds", type=float, default=2.0, help="step 8: the held step")
    p.add_argument("--move-seconds", type=float, default=4.0, help="step 8: the moving step")
    p.add_argument("--lessons", type=Path, default=HERE / "lessons.txt", help="demo lesson titles, one per line")
    p.add_argument("--duel-lesson", default="", help="lesson id for the duel (default: the newest real lesson)")
    p.add_argument("--data-dir", type=Path, default=None, help="backend data dir (default config.toml [calibration] data_dir)")
    p.add_argument("--run-dir", type=Path, default=None, help="log folder (default logs/slot/<time>)")
    p.add_argument("--backend-dir", type=Path, default=None, help="dry run: backend folder to start (default <repo>/backend)")
    p.add_argument("--keep-lessons", action="store_true", help="dry run: keep the fake lessons it records")
    return p


def run(argv: list[str] | None = None, console: Console | None = None) -> int:
    a = build_parser().parse_args(argv)
    from core.config import load_config
    from core.calibration import Calibrations

    cfg = load_config()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    slot_root = REPO / "logs" / "slot"
    run_dir = a.run_dir or (slot_root / (stamp + ("-dry" if a.dry_run else "")))
    slot_root.mkdir(parents=True, exist_ok=True)
    if not (slot_root / ".gitignore").exists():
        (slot_root / ".gitignore").write_text("*\n")
    run_dir.mkdir(parents=True, exist_ok=True)
    console = console or Console(auto=a.dry_run)
    py = sys.executable

    gd = cfg.camera.geppetto_depth
    opts = Options(
        depth_seconds=a.depth_seconds or (DRY["depth_seconds"] if a.dry_run else 40.0),
        depth_check=a.depth_check,
        hold_seconds=a.hold_seconds or (DRY["hold_seconds"] if a.dry_run else 3.0),
        mirror_seconds=DRY["mirror_seconds"] if a.dry_run else 15.0,
        duel_seconds=DRY["duel_seconds"] if a.dry_run else 30.0,
        piano_cue_seconds=DRY["piano_cue_seconds"] if a.dry_run else 4.0,
        takes=a.takes,
        lessons=read_lessons(a.lessons),
        pose_seconds=DRY["pose_seconds"] if a.dry_run else a.pose_seconds,
        freeze_seconds=DRY["freeze_seconds"] if a.dry_run else a.freeze_seconds,
        move_seconds=DRY["move_seconds"] if a.dry_run else a.move_seconds,
        duel_lesson=a.duel_lesson,
    )
    meta = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "wearer": a.wearer, "dry_run": a.dry_run,
            "argv": argv if argv is not None else sys.argv[1:], "repo": str(REPO), "python": py,
            "options": vars(opts)}
    log = RunLog(run_dir, a.dry_run, meta)

    stack = None
    trace0 = Trace()
    console.heading("Geppetto glove slot kit" + (" (DRY RUN: fakes only)" if a.dry_run else ""))
    console.say(f"Logs: {run_dir}")
    t_start = time.time()
    try:
        if a.dry_run:
            from slot_stack import DryStack
            console.say("Starting the fake stack: core --fake, backend, bridge, fake phone. The backend can take a minute.")
            stack = DryStack(REPO, py, run_dir, a.wearer, a.backend_dir)
            try:
                ep = stack.start(trace0)
            except Exception as e:
                log.add(0, "stack", "Live stack up", 1, t_start, Result("error", f"fake stack failed: {e}"), "fail", trace0)
                console.say(f"FAILED to start the fake stack: {e}")
                return 2
            core_port, backend_url, depth_host, depth_port, data_dir = (
                ep.core_port, ep.backend_url, ep.depth_host, ep.depth_port, ep.data_dir)
        else:
            core_port, backend_url = a.core_port, a.backend.rstrip("/")
            depth_port = a.depth_port or int(gd.port)
            depth_host = a.depth_host or ("127.0.0.1" if port_open(depth_port) else str(gd.host))
            data_dir = a.data_dir or Calibrations(cfg).data_dir()
        ctx = Ctx(console=console, repo=REPO, py=py, run_dir=run_dir, wearer=a.wearer, dry=a.dry_run, opts=opts,
                  core_port=core_port, backend_url=backend_url, depth_host=depth_host, depth_port=depth_port,
                  data_dir=Path(data_dir), cfg=cfg, stack=stack, trace=trace0)
        only = parse_steps(a.only) if a.only else None
        for num, key, title, fn in STEPS:
            if num != 0 and ((only is not None and num not in only) or num < a.start):
                continue
            if not run_step(ctx, log, num, key, title, fn, first_trace=trace0 if num == 0 else None):
                console.say("Stopped by request.")
                break
    except KeyboardInterrupt:
        console.say("\nInterrupted. Results so far are logged.")
    finally:
        if stack is not None:
            cleanup_dry(stack, log, console, keep=a.keep_lessons)
            stack.stop()
        log.write_summary()
    print_summary(console, log)
    final = log.final()
    if a.dry_run:
        # Fake-only quality checks already give "look"; "bad" here is a fault the fakes can show (button, LED, mirror).
        errors = [r for r in final.values() if r.verdict in ("error", "bad")]
        console.say("DRY RUN PASSED: every step ran end to end." if not errors and len(final) == len(STEPS)
                    else f"DRY RUN FAILED: steps {[r.step for r in errors]} gave error or bad; "
                         f"{len(final)}/{len(STEPS)} steps logged.")
        return 0 if not errors and len(final) == len(STEPS) else 1
    return 0 if all(r.answer in ("pass", "skip") for r in final.values()) else 1


def run_step(ctx: Ctx, log: RunLog, num: int, key: str, title: str, fn, first_trace: Trace | None = None) -> bool:
    c = ctx.console
    attempt = 0
    while True:
        attempt += 1
        c.heading(f"Step {num} of {len(STEPS) - 1}: {title}" + (f" (attempt {attempt})" if attempt > 1 else ""))
        if num != 0 and not c.auto:
            go = c.ask("Start this step?", {"y": "start", "s": "skip", "q": "quit"}, "start")
            if go == "quit":
                return False
            if go == "skip":
                log.add(num, key, title, attempt, time.time(), Result("skip", "skipped before it started"), "skip", Trace())
                return True
        t0 = time.time()
        trace = first_trace if (first_trace is not None and attempt == 1) else Trace()
        ctx.trace = trace
        try:
            result = fn(ctx)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            result = Result("error", f"{type(e).__name__}: {e}", {"traceback": traceback.format_exc()[-3000:]})
        c.say("")
        c.say(f"Result: {result.verdict.upper()}: {result.summary}")
        if result.fix:
            c.say(f"Fix to try: {result.fix}")
        answer = c.judge(result)
        log.add(num, key, title, attempt, t0, result, answer, trace)
        if answer != "retry":
            return True


def cleanup_dry(stack, log: RunLog, console: Console, keep: bool) -> None:
    """Delete the fake lessons the dry run recorded, so the repo's lessons/ folder is unchanged."""
    if keep or stack.ep is None:
        return
    made = []
    for r in log.records:
        if r.key == "demo_lessons":
            made += [t.get("lesson_id") for t in r.details.get("takes", []) if t.get("lesson_id")]
    if not made:
        return
    from slot_links import CoreLink
    try:
        c = CoreLink(f"ws://127.0.0.1:{stack.ep.core_port}/ws")
        for lid in made:
            c.cmd("lesson_delete", {"lesson_id": lid}, check=False)
        c.close()
        console.say(f"Deleted {len(made)} fake lessons recorded by the dry run.")
    except Exception as e:
        console.say(f"Could not delete the fake lessons: {e}")


def print_summary(console: Console, log: RunLog) -> None:
    console.heading("Summary")
    for step, r in sorted(log.final().items()):
        console.say(f"{step}. {r.title:44} {r.verdict:5} {r.answer:5}  {r.summary[:110]}")
    console.say(f"\nsummary.md and results.jsonl in {log.dir}")


def main() -> None:
    try:
        sys.exit(run())
    except EOFError:
        print("\nInput closed; results so far are logged.")
        sys.exit(1)


if __name__ == "__main__":
    main()
