"""What extraction returns (AD-5)."""

from dataclasses import dataclass


class Unparseable(Exception):
    """The file can't be opened: corrupt, encrypted, or not what its extension says (AD-6)."""


@dataclass(frozen=True)
class ExtractedSection:
    label: str  # e.g. "Page 4", "Slide 7: Mitosis", "Part 2"
    text: str  # Markdown


@dataclass(frozen=True)
class Extracted:
    # Paged files (PDF, .pptx) have one Section per page or slide, also an empty one, so the
    # integrity rules can count pages; non-paged files are judged on their characters (AD-6).
    paged: bool
    sections: tuple[ExtractedSection, ...]


def clean(value: str) -> str:
    """Postgres text can't hold NUL characters."""
    return value.replace("\x00", "")
