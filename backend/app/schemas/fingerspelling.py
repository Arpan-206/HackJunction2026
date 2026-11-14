"""Fingerspelling packs: one alphabet per pack, each letter recorded or not recorded yet.

A pack is data (backend/app/data/fingerspelling_packs.json). A recorded letter says who recorded it, the reference
they held it against and when, and points at its pose: a move in the catalogue (`move_id`), a core lesson
(`lesson_id`) and/or the held curls (`pose`). A letter that is not recorded yet carries none of these: never a
placeholder pose, so nothing can score against a guess.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import FingerValues

LetterStatus = Literal["recorded", "not_recorded"]


class PackReference(BaseModel):
    """A chart or document the letters are held against."""

    label: str
    url: str


class PackLetter(BaseModel):
    """One letter slot of a pack."""

    letter: str = Field(min_length=1, max_length=1)
    status: LetterStatus
    recorded_by: str | None = None
    """The name typed at recording time, or "seeded from written sources" for the ASL letters."""
    reference: str | None = None
    """The URL or document name the letter was held against."""
    recorded_at: str | None = None
    move_id: str | None = None
    lesson_id: str | None = None
    pose: FingerValues | None = None
    """The held curls, 0 straight to 1 closed, as the recorder measured them."""

    @model_validator(mode="after")
    def _status_matches_fields(self) -> "PackLetter":
        if self.letter != self.letter.upper():
            raise ValueError(f"letter {self.letter!r} must be upper case")
        if self.status == "recorded":
            missing = [
                k
                for k in ("recorded_by", "reference", "recorded_at")
                if not getattr(self, k)
            ]
            if missing:
                raise ValueError(
                    f"recorded letter {self.letter} needs {', '.join(missing)}"
                )
            if not (self.move_id or self.lesson_id or self.pose):
                raise ValueError(
                    f"recorded letter {self.letter} needs a move_id, lesson_id or pose"
                )
        elif any(
            getattr(self, k) is not None
            for k in (
                "recorded_by",
                "reference",
                "recorded_at",
                "move_id",
                "lesson_id",
                "pose",
            )
        ):
            raise ValueError(
                f"letter {self.letter} is not recorded yet, so it must carry no pose and no recording fields"
            )
        return self


class FingerspellingPack(BaseModel):
    """One alphabet: its id, display name, language, where its shapes come from and its letters."""

    id: str
    name: str
    language: str
    description: str
    default_reference: PackReference
    sources: list[PackReference]
    letters: list[PackLetter]

    @model_validator(mode="after")
    def _letters_unique(self) -> "FingerspellingPack":
        seen = [x.letter for x in self.letters]
        if len(seen) != len(set(seen)):
            raise ValueError(f"pack {self.id} repeats a letter")
        return self


class PackFile(BaseModel):
    packs: list[FingerspellingPack]
