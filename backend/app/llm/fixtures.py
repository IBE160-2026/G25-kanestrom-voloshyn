"""Deterministic mock output (AD-4). Each fixture returns the raw JSON-shaped dict a live model would,
and the gateway parses it through the same schema as live output."""

import math
import posixpath
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


# Mock photo text (AD-4). Each readable or partial text is well over the 50-character minimum.
IMAGE_READABLE_TEXT = """# Photosynthesis

- Plants turn light energy into chemical energy in the chloroplasts.
- Light reactions: water is split, oxygen is released, ATP and NADPH are made.
- Calvin cycle: CO2 is fixed into sugar using ATP and NADPH.
"""
IMAGE_PARTIAL_TEXT = """# Cell respiration

- Glucose is broken down to release energy as ATP.
- Glycolysis happens in the cytoplasm; the rest of the page is hard to read.
"""
IMAGE_UNREADABLE_TEXT = "Cell"


def extract_image_text(file_name: str) -> dict[str, Any]:
    """The outcome comes from the file name only (AD-4): `*-partial.*` is partly legible,
    `*-unreadable.*` is not legible, and any other name is readable."""
    name = posixpath.basename(file_name.replace("\\", "/")).lower()
    if "-unreadable." in name:
        return {"legibility": "unreadable", "text": IMAGE_UNREADABLE_TEXT}
    if "-partial." in name:
        return {"legibility": "partial", "text": IMAGE_PARTIAL_TEXT}
    return {"legibility": "readable", "text": IMAGE_READABLE_TEXT}


# Words of a Section a mock answer quotes.
QUIZ_SNIPPET_WORDS = 12


def generate_quiz(labels: Sequence[str], texts: Sequence[str], count: int) -> dict[str, Any]:
    """`count` questions (the caller passes `min(requested, capacity)`, AD-4) cycling over the Sections:
    question k cites Section `(k - 1) % n + 1`. Its correct answer quotes the start of that Section, and
    the correct option sits at index `(k - 1) % 4`, so the service's shuffle is what places it."""
    sections = len(texts)
    questions = []
    for k in range(1, count + 1 if sections else 1):
        number = (k - 1) % sections + 1
        label = labels[number - 1] or f"Section {number}"
        snippet = " ".join(texts[number - 1].split()[:QUIZ_SNIPPET_WORDS]) or label
        wrong = [f"{label} doesn't say this (claim {k}.{n})" for n in range(1, 4)]
        correct_index = (k - 1) % 4
        options = wrong[:correct_index] + [snippet] + wrong[correct_index:]
        questions.append(
            {
                "question": f"Question {k}: Which statement comes from {label}?",
                "options": options,
                "correct_index": correct_index,
                "explanation": f"{label} says: {snippet}",
                "sections": [number],
            }
        )
    return {"questions": questions}


def generate_flashcards(labels: Sequence[str], texts: Sequence[str], count: int) -> dict[str, Any]:
    """`count` cards (the caller passes `min(requested, capacity)`, AD-4) cycling over the Sections:
    card k cites Section `(k - 1) % n + 1`, and its answer quotes the start of that Section."""
    sections = len(texts)
    cards = []
    for k in range(1, count + 1 if sections else 1):
        number = (k - 1) % sections + 1
        label = labels[number - 1] or f"Section {number}"
        snippet = " ".join(texts[number - 1].split()[:QUIZ_SNIPPET_WORDS]) or label
        cards.append(
            {
                "question": f"Card {k}: What does {label} say?",
                "answer": snippet,
                "sections": [number],
            }
        )
    return {"cards": cards}


def generate_practice(targets: Sequence[dict[str, Any]], labels: Sequence[str], texts: Sequence[str]) -> dict[str, Any]:
    """One item per target, in order (AD-4). Each target is `{mistake_id, question, correct_answer,
    sections}` with 1-based numbers into `labels`/`texts`. Item k asks again about the target's
    question, cites the target's Sections, keeps its correct answer at index `(k - 1) % 4`, and explains
    with the start of its first Section."""
    items = []
    for k, target in enumerate(targets, start=1):
        numbers = list(target["sections"])
        first = numbers[0] if numbers else None
        label = (labels[first - 1] if first else "") or (f"Section {first}" if first else "the material")
        snippet = " ".join(texts[first - 1].split()[:QUIZ_SNIPPET_WORDS]) if first else ""
        correct = target["correct_answer"].strip() or snippet or label
        wrong = [f"Not this one (practice {k}.{n})" for n in range(1, 4)]
        correct_index = (k - 1) % 4
        items.append(
            {
                "mistake_id": target["mistake_id"],
                "question": f"Practice {k}: {target['question']}",
                "options": wrong[:correct_index] + [correct] + wrong[correct_index:],
                "correct_index": correct_index,
                "explanation": f"{label} says: {snippet or correct}",
                "sections": numbers,
            }
        )
    return {"items": items}
