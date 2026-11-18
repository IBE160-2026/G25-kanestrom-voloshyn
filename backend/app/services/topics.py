"""Topics (FR-22, AD-21): the target count, detection with server-side repair, and the save.

`target_count` is the only place a Topic count is computed; the client never sends one. `detect` runs
in the processing job with no connection held (AD-18); `save` runs inside the job's save transaction,
with the Sections and `ready`, and never commits.

The model's reply is repaired here rather than retried (only output with the wrong shape fails, inside
the gateway): Section numbers the file doesn't have are dropped, a Topic left with none is dropped,
Topics are ordered by the first Section they cover and cut to 100, and every Section no Topic covers
joins the Topic before it (the first Topic, for Sections before any). A reply with fewer Topics than
the target is kept, never padded with made-up ones.

Logs carry counts only, never labels or text.
"""

import logging
import math
from dataclasses import dataclass
from uuid import UUID, uuid4

from psycopg import AsyncConnection

from app.db import topics as repo
from app.extraction import Extracted
from app.extraction.text import count_words
from app.llm import DetectedTopics, Gateway, LLMOutputError
from app.llm.schemas import TOPICS_MAX

logger = logging.getLogger(__name__)

TOPICS_MIN = 3
PAGES_PER_TOPIC = 5
WORDS_PER_PAGE = 500


@dataclass(frozen=True)
class TopicDraft:
    """A Topic before it is saved: its label, group, and the 0-based positions of its Sections."""

    label: str
    group_label: str | None
    sections: tuple[int, ...]


def page_count(extracted: Extracted) -> int:
    """Sections for paged files (a PDF page, a slide), else `ceil(words / 500)` (AD-21)."""
    if extracted.paged:
        return len(extracted.sections)
    words = sum(count_words(section.text) for section in extracted.sections)
    return math.ceil(words / WORDS_PER_PAGE)


def target_count(extracted: Extracted) -> int:
    """`clamp(ceil(pages / 5), 3, 100)` (AD-21)."""
    return min(TOPICS_MAX, max(TOPICS_MIN, math.ceil(page_count(extracted) / PAGES_PER_TOPIC)))


def repair(detected: DetectedTopics, section_count: int) -> list[TopicDraft]:
    """Drafts covering every one of `section_count` Sections, at most 100 (see the module docstring).
    Raises `LLMOutputError` when no Topic names a Section the file has."""
    kept: list[tuple[str, str | None, list[int]]] = []
    for topic in detected.topics:
        positions = sorted({number - 1 for number in topic.sections if 1 <= number <= section_count})
        if positions:
            kept.append((topic.label, topic.group_label, positions))
    if not kept:
        raise LLMOutputError("No Topic covers a Section of the file")
    # Ordered by the first Section covered; ties keep the model's order (the sort is stable).
    kept.sort(key=lambda topic: topic[2][0])
    kept = kept[:TOPICS_MAX]

    covered = {position for _, _, positions in kept for position in positions}
    owner = 0  # the Topic a skipped Section joins: the last one starting at or before it
    for position in range(section_count):
        while owner + 1 < len(kept) and kept[owner + 1][2][0] <= position:
            owner += 1
        if position not in covered:
            kept[owner][2].append(position)
    return [TopicDraft(label, group, tuple(sorted(positions))) for label, group, positions in kept]


async def detect(llm: Gateway, extracted: Extracted) -> list[TopicDraft]:
    """Detect the Topics of an extracted file (no connection held). Gateway errors propagate, which
    fails the job (the Material is then rejected as `processing_failed`)."""
    target = target_count(extracted)
    detected = await llm.detect_topics(extracted.sections, target)
    drafts = repair(detected, len(extracted.sections))
    logger.info("Topics: target=%d returned=%d saved=%d", target, len(detected.topics), len(drafts))
    return drafts


async def save(conn: AsyncConnection, material_id: UUID, drafts: list[TopicDraft], section_ids: list[UUID]) -> None:
    """Insert the drafts and their Section links in the caller's transaction. `section_ids[i]` is the
    id of the Section at position `i`."""
    if not drafts:
        raise ValueError("a Ready Material needs Topics")
    rows: list[tuple[UUID, str, str | None]] = []
    links: list[tuple[UUID, UUID]] = []
    for draft in drafts[:TOPICS_MAX]:
        topic_id = uuid4()
        rows.append((topic_id, draft.label, draft.group_label))
        links.extend((topic_id, section_ids[position]) for position in draft.sections)
    await repo.insert_many(conn, material_id, rows, links)


async def list_for_materials(conn: AsyncConnection, material_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """Each Material's Topics (`id`, `label`, `group_label`, `position`), in order."""
    grouped: dict[UUID, list[dict]] = {material_id: [] for material_id in material_ids}
    for row in await repo.list_for_materials(conn, material_ids):
        material_id = row.pop("material_id")
        grouped.setdefault(material_id, []).append(row)
    return grouped
