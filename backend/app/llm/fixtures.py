"""Deterministic mock output (AD-4). Each fixture returns the raw JSON-shaped dict a live model would,
and the gateway parses it through the same schema as live output."""

import re
from collections.abc import Sequence
from typing import Any

from app.llm.schemas import PROJECT_NAME_MAX

_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
NAME_WORDS = 6


def name_project(texts: Sequence[str]) -> dict[str, Any]:
    """The first Markdown heading of the first non-blank Section, else its first six words, cut to 100
    characters. Blank Sections (an empty PDF page or slide) are skipped."""
    first = next((text for text in texts if text.strip()), "")
    match = _HEADING.search(first)
    name = match.group(1) if match else " ".join(first.split()[:NAME_WORDS])
    return {"name": name.strip()[:PROJECT_NAME_MAX]}
