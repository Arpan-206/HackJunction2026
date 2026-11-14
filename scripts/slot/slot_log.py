"""Prompts and logs for the slot kit.

Verdicts a check gives (the machine's view):
  ok     the numbers say it works
  look   it ran; a person must look (an LED, the robot twin) or the data is fake
  bad    it ran and the numbers say it does not work
  error  it could not run (a process down, a timeout, a missing tool)
  skip   nothing to run (a tool not built yet, or no lesson to duel on)

Answers the person gives: pass, fail, skip, retry. In auto mode (the dry run)
the answer follows the verdict: ok and look give pass, skip gives skip, bad
and error give fail.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from slot_links import Trace

VERDICTS = ("ok", "look", "bad", "error", "skip")
AUTO_ANSWER = {"ok": "pass", "look": "pass", "skip": "skip", "bad": "fail", "error": "fail"}


@dataclass
class Result:
    verdict: str
    summary: str
    details: dict = field(default_factory=dict)
    fix: str = ""

    def __post_init__(self) -> None:
        if self.verdict not in VERDICTS:
            raise ValueError(f"verdict {self.verdict!r} not in {VERDICTS}")


@dataclass
class Record:
    step: int
    key: str
    title: str
    attempt: int
    started: str
    ended: str
    seconds: float
    verdict: str
    answer: str
    summary: str
    fix: str
    details: dict
    commands: list[dict]
    dry_run: bool
    note: str = ""


class Console:
    """Plain prompts. auto=True never waits: it is the dry run."""

    def __init__(self, auto: bool = False, out=None, inp=None, auto_pause: float = 0.0) -> None:
        self.auto = auto
        self.out = out or sys.stdout
        self.inp = inp or sys.stdin
        self.auto_pause = auto_pause

    def say(self, text: str = "") -> None:
        print(text, file=self.out, flush=True)

    def heading(self, text: str) -> None:
        self.say("")
        self.say("=" * 72)
        self.say(text)
        self.say("=" * 72)

    def _read(self) -> str:
        line = self.inp.readline()
        if line == "":
            raise EOFError("input closed")
        return line.strip()

    def enter(self, text: str = "Press Enter when ready.") -> None:
        if self.auto:
            self.say(f"{text} [dry run: continuing]")
            if self.auto_pause:
                time.sleep(self.auto_pause)
            return
        self.say(text)
        self._read()

    def ask(self, question: str, choices: dict[str, str], default: str) -> str:
        """choices maps a key ('p') to an answer ('pass'). Returns the answer."""
        keys = "/".join(k.upper() if choices[k] == default else k for k in choices)
        if self.auto:
            self.say(f"{question} [{keys}] -> {default} (dry run)")
            return default
        while True:
            self.say(f"{question} [{keys}]")
            got = self._read().lower()
            if got == "":
                return default
            if got in choices:
                return choices[got]
            for k, v in choices.items():
                if got == v:
                    return v
            self.say(f"Type one of: {', '.join(choices)}.")

    def text(self, question: str, default: str) -> str:
        """A typed answer; Enter keeps the default. The dry run takes the default."""
        if self.auto:
            self.say(f"{question} [{default}] -> {default} (dry run)")
            return default
        self.say(f"{question} [{default}]")
        return self._read() or default

    def yes(self, question: str, default: bool = True) -> bool:
        return self.ask(question, {"y": "yes", "n": "no"}, "yes" if default else "no") == "yes"

    def judge(self, result: Result) -> str:
        return self.ask(
            "Your call: pass, fail, skip or retry?",
            {"p": "pass", "f": "fail", "s": "skip", "r": "retry"},
            AUTO_ANSWER[result.verdict],
        )


class RunLog:
    """logs/slot/<time>/results.jsonl (one line per attempt) and summary.md (rewritten after each step)."""

    def __init__(self, run_dir: Path, dry_run: bool, meta: dict) -> None:
        self.dir = Path(run_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.dry_run = dry_run
        self.meta = meta
        self.records: list[Record] = []
        self.results = self.dir / "results.jsonl"
        self.summary = self.dir / "summary.md"
        (self.dir / "run.json").write_text(json.dumps(meta, indent=2, default=str) + "\n")

    def add(self, step: int, key: str, title: str, attempt: int, t0: float, result: Result,
            answer: str, trace: Trace, note: str = "") -> Record:
        t1 = time.time()
        rec = Record(
            step=step, key=key, title=title, attempt=attempt,
            started=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t0)),
            ended=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t1)),
            seconds=round(t1 - t0, 1), verdict=result.verdict, answer=answer,
            summary=result.summary, fix=result.fix, details=result.details,
            commands=list(trace.entries), dry_run=self.dry_run, note=note,
        )
        self.records.append(rec)
        with self.results.open("a") as f:
            f.write(json.dumps(asdict(rec), default=str) + "\n")
        self.write_summary()
        return rec

    def final(self) -> dict[int, Record]:
        """The last attempt of each step."""
        out: dict[int, Record] = {}
        for r in self.records:
            out[r.step] = r
        return out

    def write_summary(self) -> None:
        last = self.final()
        mode = "DRY RUN (fakes only, no gloves, no phone)" if self.dry_run else "Real glove slot"
        lines = [
            f"# Glove slot results, {self.meta.get('started', '')}",
            "",
            f"Mode: {mode}. Wearer: {self.meta.get('wearer', '')}.",
            "",
            "| Step | Title | Verdict | Answer | Attempts | Result |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for step in sorted(last):
            r = last[step]
            tries = sum(1 for x in self.records if x.step == step)
            text = r.summary.replace("|", "/").replace("\n", " ")
            lines.append(f"| {step} | {r.title} | {r.verdict} | {r.answer} | {tries} | {text} |")
        fixes = [(s, last[s]) for s in sorted(last) if last[s].fix and last[s].answer != "pass"]
        if fixes:
            lines += ["", "## Fixes to try", ""]
            for s, r in fixes:
                lines.append(f"- Step {s}, {r.title}: {r.fix}")
        lines += [
            "",
            "Verdicts: ok (the numbers say it works), look (a person must look, or the data is fake),",
            "bad (the numbers say it does not work), error (could not run), skip (nothing to run).",
            "",
            "Every command and its output is in results.jsonl in this folder.",
            "",
        ]
        self.summary.write_text("\n".join(lines))
