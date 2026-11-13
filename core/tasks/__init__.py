"""Task screens: each gives the live `frame.task` state for the current session."""
from __future__ import annotations

TASKS = ["general", "chords", "piano", "boxing"]


def task_state(session) -> dict:
    task = session.task
    if task == "chords":
        from .chords import state as chords_state
        out = chords_state(session)
    elif task == "piano":
        from .piano import state as piano_state
        out = piano_state(session)
    elif task == "boxing":
        from .boxing import state as boxing_state
        out = boxing_state(session)
    else:
        from .general import state as general_state
        out = general_state(session)
    if session.mode == "duel":
        out["duel"] = {"round": session.duel["round"], "rounds": session.duel["rounds"],
                       "wins": dict(session.duel["wins"])}
    return out
