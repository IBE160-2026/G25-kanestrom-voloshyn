"""Deterministic mock output (AD-4). Each fixture returns the raw JSON-shaped dict a live model would,
and the gateway parses it through the same schema as live output."""

import math
import re
from collections.abc import Sequence
from typing import Any

from app.llm.schemas import PROJECT_NAME_MAX, TOPIC_LABEL_MAX

_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
NAME_WORDS = 6


def name_project(texts: Sequence[str]) -> dict[str, Any]:
    """The first Markdown heading of the first non-blank Section, else its first six words, cut to 100
    characters. Blank Sections (an empty PDF page or slide) are skipped."""
    first = next((text for text in texts if text.strip()), "")
    match = _HEADING.search(first)
    name = match.group(1) if match else " ".join(first.split()[:NAME_WORDS])
    return {"name": name.strip()[:PROJECT_NAME_MAX]}


# Above this many Topics, mock Topics sit in groups of ten ("Part 1", "Part 2", ...).
GROUP_ABOVE = 20
GROUP_SIZE = 10


def detect_topics(labels: Sequence[str], target: int) -> dict[str, Any]:
    """`target` Topics derived from the Section count alone (AD-4, AD-21).

    With at least `target` Sections, Topic k covers the k-th of `target` contiguous runs, so every
    Section is covered once, in order. With fewer, the Topics cycle over the Sections, which then
    share Topics (a single-Section file still gets 3). Topic k is labelled "Topic k: {its first
    Section's label}" and, when `target` is over 20, grouped under "Part {ceil(k / 10)}".
    """
    count = len(labels)
    topics = []
    for k in range(1, target + 1):
        if count >= target:
            numbers = list(range((k - 1) * count // target + 1, k * count // target + 1))
        else:
            numbers = [(k - 1) % count + 1] if count else []
        first = labels[numbers[0] - 1] if numbers else ""
        topics.append(
            {
                "label": f"Topic {k}: {first}".strip().rstrip(":")[:TOPIC_LABEL_MAX],
                "group_label": f"Part {math.ceil(k / GROUP_SIZE)}" if target > GROUP_ABOVE else None,
                "sections": numbers,
            }
        )
    return {"topics": topics}
