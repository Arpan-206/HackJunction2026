"""chords: one hold step per chord. task state names the current and next chord."""


def state(session) -> dict:
    lesson, idx = session.lesson, session.step_index
    if lesson is None or idx is None or not lesson.steps:
        chords = list(session.task_config.get("chords", []))
        return {
            "chord": chords[0] if chords else None,
            "next": chords[1] if len(chords) > 1 else None,
        }
    cur = lesson.steps[idx].name
    nxt = lesson.steps[idx + 1].name if idx + 1 < len(lesson.steps) else None
    return {"chord": cur, "next": nxt}
